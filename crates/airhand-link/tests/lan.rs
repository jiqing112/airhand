//! 局域网直连的端到端测试：在本机回环上真的跑一遍被控端监听 + 控制端直连。
//!
//! 覆盖的是两处新机制的接缝：监听器的引导（[`airhand_proto::lan::LanConnect`]、`Router::prime`）和
//! 端到端握手（配对码的 SPAKE2 密码里两端都用 [`airhand_proto::lan::LAN_CODE`]）。会话从握手之后
//! 和中转模式走的是同一份代码（`serve`、配对、审批），那部分由 `secure.rs` 和客户端的 e2e 测试覆盖。

use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use airhand_link::controller::{
    ConnectOptions, ControllerService, Frontend, SessionEvent, SessionUi, UiClosed,
};
use airhand_link::host::{self, HostCmd, HostEvents, LanConfig};
use airhand_link::net::Trust;
use airhand_link::secure::{Access, Gate, Identity, PairingAttempt};
use airhand_link::{LinkConfig, Problem, ServerState};
use airhand_proto::handshake::PublicKey;
use airhand_proto::signal::Reclaim;
use tokio::runtime::Handle;
use tokio::sync::mpsc;

/// 被控端托盘（测试替身）：记下监听地址和结束的会话
#[derive(Default)]
struct Tray {
    lan: Mutex<Option<SocketAddr>>,
    ended: Mutex<Vec<u64>>,
}

impl Tray {
    async fn addr(&self) -> SocketAddr {
        for _ in 0..200 {
            if let Some(a) = *self.lan.lock().unwrap() {
                return a;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the lan listener didn't start");
    }
}

impl HostEvents for Tray {
    async fn registered(&self, _code: Reclaim, _changed: bool) {}
    async fn released(&self) {}
    fn server(&self, _state: ServerState) {}
    fn offline(&self) {}
    fn ended(&self, session_id: u64) {
        self.ended.lock().unwrap().push(session_id);
    }
    fn lan_listening(&self, addr: SocketAddr) {
        *self.lan.lock().unwrap() = Some(addr);
    }
}

/// 被控端的门（测试版）：配对码 `123456`，配对过的控制端记住
struct TestGate {
    me: Identity,
    known: Mutex<Vec<PublicKey>>,
}

impl TestGate {
    fn new() -> Self {
        Self {
            me: Identity::generate(),
            known: Mutex::default(),
        }
    }
}

impl Gate for TestGate {
    fn identity(&self) -> Identity {
        self.me.clone()
    }
    fn access(&self) -> Access {
        Access::Pairing
    }
    fn begin_pairing(&self) -> Option<Box<dyn PairingAttempt + '_>> {
        Some(Box::new(Attempt {
            gate: self,
            code: "123456".into(),
            completed: false,
        }))
    }
    fn is_known(&self, key: &PublicKey) -> bool {
        self.known.lock().unwrap().contains(key)
    }
}

struct Attempt<'a> {
    gate: &'a TestGate,
    code: String,
    completed: bool,
}

impl PairingAttempt for Attempt<'_> {
    fn code(&self) -> &str {
        &self.code
    }
    fn complete(mut self: Box<Self>, key: PublicKey, _: &str) -> bool {
        self.gate.known.lock().unwrap().push(key);
        self.completed = true;
        true
    }
}

impl Drop for Attempt<'_> {
    fn drop(&mut self) {
        // 丢弃 = 一次不成功的尝试（真实的实现在这里记账）。测试里不需要预算
    }
}

/// 握手做完的每个控制端（[`airhand_link::host::Admitted`]）：名字、安全码、怎么进来的
type Held = Arc<Mutex<Vec<airhand_link::host::Admitted>>>;

/// 被控端的一个"会话"：把端到端握手真正做完（[`airhand_link::host::HostStreams::open`]，
/// 和中转模式同一条路径），然后结束——测试只关心握手，画面那些由客户端的 e2e 测试覆盖。
/// 做完的 [`airhand_link::host::HostStreams`] 要握住不丢：会话活着连接才活着，
/// 控制端那边做完握手还要用这条连接（真实路径里 `serve` 会一直握着它）
fn session_closure(
    held: Held,
    gate: Arc<TestGate>,
) -> impl Fn(airhand_link::host::Incoming) -> Pin<Box<dyn std::future::Future<Output = ()> + Send>> + Send + Sync + 'static {
    move |inc| {
        let held = held.clone();
        let gate = gate.clone();
        Box::pin(async move {
            match airhand_link::host::HostStreams::open(&inc, 8, 8, gate.as_ref()).await {
                Ok((streams, admitted)) => {
                    held.lock().unwrap().push(admitted);
                    KEEP.get_or_init(|| Arc::new(Mutex::new(Vec::new()))).lock().unwrap().push(streams);
                }
                Err(e) => eprintln!("handshake failed as expected: {e:#}"),
            }
        })
    }
}

static KEEP: std::sync::OnceLock<Arc<Mutex<Vec<airhand_link::host::HostStreams>>>> = std::sync::OnceLock::new();

/// 起一个被控端：局域网直连监听在回环的空闲端口上，门要配对码。返回（监听地址，被控端公钥，收进来的控制端）
async fn start_host(allow: &[&str]) -> (SocketAddr, PublicKey, Held) {
    let tray = Arc::new(Tray::default());
    let gate = Arc::new(TestGate::new());
    let held: Held = Arc::default();
    let host_key = *gate.identity().public();
    KEEP.get_or_init(|| Arc::new(Mutex::new(Vec::new())));
    let link = Arc::new(LinkConfig {
        // 故意连不上的服务器：局域网直连不依赖它（重连循环在后台安静地失败）
        server: "127.0.0.1:1".into(),
        trust: Trust::Pinned([0; 32]),
        name: "Test Host".into(),
        os: "linux".into(),
    });
    let lan = LanConfig {
        bind: SocketAddr::from(([127, 0, 0, 1], 0)),
        allow: allow
            .iter()
            .map(|s| host::Cidr::parse(s).unwrap())
            .collect(),
    };
    let (_cmd_tx, cmd_rx) = mpsc::unbounded_channel::<HostCmd>();
    tokio::spawn(host::run(
        link,
        Some(lan),
        false,
        None,
        tray.clone(),
        session_closure(held.clone(), gate),
        cmd_rx,
    ));
    // 配置里的 bind 是 :0：真实端口等监听开始的报告
    let addr = tray.addr().await;
    (addr, host_key, held)
}

fn controller() -> ControllerService {
    let link = Arc::new(LinkConfig {
        server: "127.0.0.1:1".into(),
        trust: Trust::Pinned([0; 32]),
        name: "Test Controller".into(),
        os: "linux".into(),
    });
    ControllerService::start(
        link,
        Handle::current(),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Identity::generate(),
    )
}

/// 最简单的界面（什么都不做，收着就行）
struct QuietUi;
impl SessionUi for QuietUi {
    fn packet(&self, _packet: Vec<u8>) -> Result<(), UiClosed> {
        Ok(())
    }
    fn event(&self, _event: SessionEvent) -> Result<(), UiClosed> {
        Ok(())
    }
}

#[tokio::test]
async fn pairing_is_required_then_works_then_remembers() {
    let (addr, host_key, held) = start_host(&[]).await;
    let svc = controller();
    let target = addr.to_string();

    // 没配对过：要配对码
    let r = svc
        .connect_addr(&target, opts(), Arc::new(QuietUi), Frontend::Browser)
        .await;
    assert_eq!(r.unwrap_err(), Problem::PairingRequired);

    // 配对码不对
    let r = svc
        .connect_addr(
            &target,
            ConnectOptions {
                pairing: Some("000000".into()),
                ..opts()
            },
            Arc::new(QuietUi),
            Frontend::Browser,
        )
        .await;
    assert_eq!(r.unwrap_err(), Problem::PairingFailed);

    // 配对码对：连上。SessionInfo 里没有控制码、没有重连凭证，地址就是连的地址
    let info = svc
        .connect_addr(
            &target,
            ConnectOptions {
                pairing: Some("123 456".into()),
                ..opts()
            },
            Arc::new(QuietUi),
            Frontend::Browser,
        )
        .await
        .unwrap();
    assert_eq!(info.addr.as_deref(), Some(target.as_str()));
    assert_eq!(info.code, "");
    assert!(info.resume.is_none());
    assert_eq!(info.host_key, airhand_link::secure::hex(&host_key));
    assert_eq!(info.safety.len(), 7); // 安全码写成 123-456
    drop(info);

    // 配对过之后：带着记下的公钥再连不用配对码（Noise IK）
    let info = svc
        .connect_addr(
            &target,
            ConnectOptions {
                host_key: Some(airhand_link::secure::hex(&host_key)),
                ..opts()
            },
            Arc::new(QuietUi),
            Frontend::Browser,
        )
        .await
        .unwrap();
    drop(info);

    // 被控端那边：握手做完的（最后一个）：名字来自端到端介绍、安全码两边一样、配对过的进来了
    let held = held.lock().unwrap();
    let last = held.last().expect("no admitted controller");
    assert_eq!(last.name, "Test Controller");
    assert_eq!(last.safety.len(), 7);
    assert_eq!(last.admission, airhand_link::secure::Admission::Known);
}

/// 被控端不允许的网段：连接直接被拒（连握手都到不了）
#[tokio::test]
async fn cidr_allowlist_refuses() {
    let (addr, _key, _held) = start_host(&["127.0.0.2/32"]).await;
    let svc = controller();
    let r = svc
        .connect_addr(&addr.to_string(), opts(), Arc::new(QuietUi), Frontend::Browser)
        .await;
    let Err(Problem::HostUnreachable { .. }) = r else {
        panic!("expected HostUnreachable, got {r:?}");
    };
}

/// 控制码模式不受影响：`addr` 不写就走服务器（这里服务器故意连不上，报的应该是没连上服务器）
#[tokio::test]
async fn code_path_still_goes_to_the_server() {
    let svc = controller();
    // 等一等服务连接失败（127.0.0.1:1 立刻被拒）
    tokio::time::sleep(Duration::from_millis(300)).await;
    let r = svc
        .connect("123456", opts(), Arc::new(QuietUi), Frontend::Browser)
        .await;
    assert!(matches!(
        r,
        Err(Problem::NotConnected) | Err(Problem::ServerUnreachable { .. })
    ));
}

fn opts() -> ConnectOptions {
    ConnectOptions::default()
}
