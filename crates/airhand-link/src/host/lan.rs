//! 局域网直连监听（被控端）：没有服务器时，在本机的指定地址上接受控制端直接连进来。
//!
//! 中转模式里由服务器做的三件事，在这里各自有个对应物：接受 QUIC 连接（监听地址代替服务器的
//! 公开地址）、读出会话号和握手的第一条消息（[`airhand_proto::lan::LanConnect`] 代替
//! `ServerMsg::Incoming` 的转发）、把会话交给 [`super::run`] 的 `session` 闭包。从
//! [`Incoming`] 之后就是和中转模式完全相同的路径（端到端握手、配对码、本机同意、会话），
//! 配对、审批、托盘里显示谁连着，一行都不用改。
//!
//! TLS 在这里只是传输层（临时生成的自签名证书，谁都能连进来）：真正的认证是端到端的握手，
//! 见 [`airhand_proto::lan`]。监听任务独立于服务器的连接：服务器连不上、断线重连，都不影响它。

use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use airhand_proto::SessionHeader;
use airhand_proto::lan::{LAN_CODE, LanConnect};
use airhand_proto::session::ByeReason;
use airhand_proto::signal::Peer;
use airhand_proto::{MAX_CONTROL_MSG, SessionLane};
use anyhow::{Context, Result, bail};
use quinn::Endpoint;
use tokio::sync::watch;
use tokio::task::JoinSet;
use tracing::{info, warn};

use crate::direct::tls::{Cert, server_config};
use crate::lanes::Router;
use crate::tasks::OwnedTask;
use crate::wire::read_msg;

use super::HostEvents;
use super::Incoming;

/// 会话闭包（[`super::run`] 装好的）：中转连上的控制端和局域网直连的都用它
type SessionFn = Arc<dyn Fn(Incoming) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// 等控制端握手（QUIC + 引导消息）最多这么久
const BOOTSTRAP_TIMEOUT: Duration = Duration::from_secs(10);

/// 局域网直连监听的配置（config.toml 的 `[lan]`，交给 [`super::run`]）
#[derive(Debug, Clone)]
pub struct LanConfig {
    /// 监听的地址，例如 `0.0.0.0:4433`、`192.168.1.5:4433`
    pub bind: SocketAddr,
    /// 只允许这些网段连入；空 = 不限。进不进来还是端到端说了算（没配对过就要配对码），
    /// 这个名单挡住的是不认识的人的连接请求本身
    pub allow: Vec<Cidr>,
}

/// 一个网段（IPv4 / IPv6，例如 `192.168.1.0/24`、`fd00::/8`、`192.168.1.5`）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cidr {
    net: IpAddr,
    prefix: u8,
}

impl Cidr {
    /// `192.168.1.0/24`、`fd00::/8`；不带 `/` 时是单个地址
    pub fn parse(s: &str) -> Option<Self> {
        let (ip, prefix) = match s.trim().split_once('/') {
            Some((ip, prefix)) => {
                let ip = ip.trim().parse::<IpAddr>().ok()?;
                let prefix = prefix.trim().parse::<u8>().ok()?;
                let max = match ip {
                    IpAddr::V4(_) => 32,
                    IpAddr::V6(_) => 128,
                };
                if prefix > max {
                    return None;
                }
                (ip, prefix)
            }
            None => {
                let ip = s.trim().parse::<IpAddr>().ok()?;
                (ip, match ip {
                    IpAddr::V4(_) => 32,
                    IpAddr::V6(_) => 128,
                })
            }
        };
        Some(Self {
            net: Self::mask(ip, prefix),
            prefix,
        })
    }

    fn mask(ip: IpAddr, prefix: u8) -> IpAddr {
        match ip {
            IpAddr::V4(v4) => {
                let m = match prefix {
                    0 => 0,
                    32 => u32::MAX,
                    p => u32::MAX << (32 - u32::from(p)),
                };
                IpAddr::V4(std::net::Ipv4Addr::from(u32::from(v4) & m))
            }
            IpAddr::V6(v6) => {
                let m = match prefix {
                    0 => 0,
                    128 => u128::MAX,
                    p => u128::MAX << (128 - u32::from(p)),
                };
                IpAddr::V6(std::net::Ipv6Addr::from(u128::from(v6) & m))
            }
        }
    }

    /// `ip` 在不在网段里
    pub fn contains(&self, ip: IpAddr) -> bool {
        let same_kind = matches!(
            (self.net, ip),
            (IpAddr::V4(_), IpAddr::V4(_)) | (IpAddr::V6(_), IpAddr::V6(_))
        );
        same_kind && Self::mask(ip, self.prefix) == self.net
    }
}

/// 开始监听（独立任务，服务器连不连得上都一直跑）。返回的任务丢掉时停止监听、断开连着的会话
pub fn listen<E: HostEvents>(
    config: LanConfig,
    events: Arc<E>,
    session: SessionFn,
    kick: watch::Sender<ByeReason>,
) -> OwnedTask<()> {
    OwnedTask(tokio::spawn(async move {
        if let Err(e) = serve(config, events, session, kick).await {
            warn!("the lan listener stopped: {e:#}");
        }
    }))
}

async fn serve<E: HostEvents>(
    config: LanConfig,
    events: Arc<E>,
    session: SessionFn,
    kick: watch::Sender<ByeReason>,
) -> Result<()> {
    let cert = Cert::generate().context("can't generate the lan certificate")?;
    let endpoint = Endpoint::server(server_config(&cert)?, config.bind)
        .with_context(|| format!("can't listen on {}", config.bind))?;
    // 绑定的是 0.0.0.0 时，把本机在局域网里的真实地址报出去（托盘和主界面显示"连哪个 IP"）；
    // 绑定了具体网卡就原样报
    let local = match config.bind.ip() {
        IpAddr::V4(v4) if v4.is_unspecified() => {
            crate::direct::local_lan_ip().map_or(config.bind, |ip| SocketAddr::new(ip, config.bind.port()))
        }
        _ => endpoint.local_addr().unwrap_or(config.bind),
    };
    info!(addr = %local, "listening for lan connections");
    events.lan_listening(local);
    let mut sessions: JoinSet<()> = JoinSet::new();
    loop {
        tokio::select! {
            incoming = endpoint.accept() => {
                let Some(incoming) = incoming else {
                    bail!("the listener is closed");
                };
                let from = incoming.remote_address();
                if !config.allow.is_empty() && !config.allow.iter().any(|c| c.contains(from.ip())) {
                    info!(%from, "refusing a lan connection: the address isn't allowed");
                    incoming.refuse();
                    continue;
                }
                let events = events.clone();
                let kick = kick.clone();
                let session = session.clone();
                sessions.spawn(async move {
                    match accept(incoming, &session, kick).await {
                        Ok((session_id, run, keep)) => {
                            let _keep = keep;
                            run.await;
                            events.ended(session_id);
                        }
                        Err(e) => warn!(%from, "a lan connection didn't start a session: {e:#}"),
                    }
                });
            }
            Some(done) = sessions.join_next() => {
                if let Ok(()) = done {}
            }
        }
    }
}

/// 挂着不让会话的路由任务被丢掉的东西（会话活着就要一直收它的流和数据报）
type Keep = (Arc<Router>, OwnedTask<()>);

/// 接受一个控制端：QUIC 连上之后读引导消息，剩下的走和中转模式一样的会话路径。
/// 返回（会话号，会话，要一直拿在手里直到会话结束的东西）
async fn accept(
    incoming: quinn::Incoming,
    session: &SessionFn,
    kick: watch::Sender<ByeReason>,
) -> Result<(u64, Pin<Box<dyn Future<Output = ()> + Send>>, Keep)> {
    let conn = tokio::time::timeout(BOOTSTRAP_TIMEOUT, incoming.accept()?)
        .await
        .context("timed out accepting the connection")??;
    let from = conn.remote_address();
    // 控制通道上的第一条流：会话头 + LanConnect（握手的第一条消息在里面）。读完之后这条流
    // 的剩余部分就是端到端握手的后续消息：会话号在消息里，要读出来才知道登记哪个会话，
    // 所以这条流先交给 Router 存着（[`Router::prime`]），会话登记时取走
    let mut recv = tokio::time::timeout(BOOTSTRAP_TIMEOUT, conn.accept_uni())
        .await
        .context("timed out waiting for the control lane")??;
    let mut head = [0u8; SessionHeader::LEN];
    tokio::time::timeout(BOOTSTRAP_TIMEOUT, recv.read_exact(&mut head))
        .await
        .context("timed out reading the lane header")??;
    let header = SessionHeader::decode(&head).context("not a session lane")?;
    anyhow::ensure!(
        header.lane == SessionLane::Control,
        "the first lane isn't the control lane"
    );
    let mut buf = Vec::new();
    let received =
        tokio::time::timeout(BOOTSTRAP_TIMEOUT, read_msg(&mut recv, MAX_CONTROL_MSG, &mut buf))
            .await
            .with_context(|| format!("timed out reading the lan bootstrap from {from}"))?;
    let received = received.context("the controller hung up before the bootstrap")?;
    let lan: LanConnect = received.context("bad lan bootstrap")?;
    anyhow::ensure!(!lan.init.is_empty(), "the handshake init is empty");

    let (router, router_task) = Router::start(&conn);
    router.prime(lan.session_id, header.lane, recv);
    let run = session(Incoming {
        conn,
        router: router.clone(),
        session_id: lan.session_id,
        init: lan.init,
        code: LAN_CODE,
        peer: Peer {
            name: lan.name,
            ip: from.ip(),
        },
        kick: kick.subscribe(),
        direct: None,
        file_limit: None,
    });
    Ok((lan.session_id, run, (router, router_task)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cidr_parse_and_match() {
        let c = Cidr::parse("192.168.1.0/24").unwrap();
        assert!(c.contains("192.168.1.55".parse().unwrap()));
        assert!(!c.contains("192.168.2.55".parse().unwrap()));
        assert!(!c.contains("2001:db8::1".parse().unwrap()));

        let single = Cidr::parse("192.168.1.5").unwrap();
        assert!(single.contains("192.168.1.5".parse().unwrap()));
        assert!(!single.contains("192.168.1.6".parse().unwrap()));

        let v6 = Cidr::parse("fd00::/8").unwrap();
        assert!(v6.contains("fd12:3456::1".parse().unwrap()));
        assert!(!v6.contains("fe80::1".parse().unwrap()));
        assert!(!v6.contains("192.168.1.5".parse().unwrap()));

        assert!(Cidr::parse("192.168.1.0/33").is_none());
        assert!(Cidr::parse("not-an-ip").is_none());
        assert!(Cidr::parse("0.0.0.0/0").unwrap().contains("10.0.0.1".parse().unwrap()));
    }
}
