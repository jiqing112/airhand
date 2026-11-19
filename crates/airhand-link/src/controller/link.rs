//! 控制端一个会话的链路：服务器批准（或者局域网直连连上）之后，在控制通道上做完端到端握手、开好本端的通道、建好接收端。
//! [`super::ControllerService`] 用它，测试和调试工具也可以直接用（自己决定发什么、怎么处理收到的）。

use std::sync::Arc;

use airhand_proto::SessionLane;
use airhand_proto::handshake::Negotiated;
use airhand_proto::handshake::PublicKey;
use airhand_proto::lan::LanConnect;
use anyhow::Result;
use quinn::{Connection, RecvStream, SendStream};

use super::receiver::HostReceiver;
use crate::lanes::{Inbox, Registration, Router, Via, first_stream, open_lane};
use crate::merge::{Merge, Policy};
use crate::paths::{DatagramSender, Paths};
use crate::secure::{Initiated, Initiator, STEP_TIMEOUT, Sealer};
use crate::wire;

/// 握手做完了、本端的通道开好了的会话（见模块说明）
pub struct Established {
    pub session_id: u64,
    /// 被控端的公钥、安全码（见 `airhand_proto::handshake`）
    pub peer: PublicKey,
    pub safety: String,
    /// 选定的会话版本和双方都支持的能力位
    pub negotiated: Negotiated,
    /// 本端的控制通道（写的一半）和它的加密端（已经发出了确认，计数接着往下数）
    pub control: (SendStream, Sealer),
    /// 本端的大块通道
    pub bulk: (SendStream, Sealer),
    /// 会话的两条路：现在只有中转（或者局域网直连），直连通了由直连任务接上（见 [`crate::direct`]）
    pub paths: Paths,
    /// 发控制数据报（Ping、画面确认）
    pub datagrams: DatagramSender,
    /// 麦克风的声音数据报的加密端（双方都支持 `airhand_proto::features::session::MIC` 时才用，
    /// 见 `airhand_proto::session` 的"麦克风"）
    pub mic: Sealer,
    /// 被控端发来的东西（被控端的探测在里面就弹回去了）
    pub receiver: HostReceiver,
    /// 直连上来的流、数据报交给这个会话
    pub feed: crate::lanes::Feed,
    /// 在中转连接上的登记：丢掉之后不再收这个会话的东西
    pub registration: Registration,
}

/// 服务器批准了会话 `session_id`（发起时的握手是 `initiator`）：等被控端在控制通道上回答、做完握手、开好通道。
/// 失败时的错误是 [`crate::Problem`]（对方身份变了、要配对码……，见 [`Initiator::finish`]）或者网络错误
pub async fn establish(
    router: &Arc<Router>,
    conn: &Connection,
    session_id: u64,
    initiator: Initiator,
) -> Result<Established> {
    let (mut inbox, registration) = router.register(session_id);
    let mut control_in = first_stream(&mut inbox.control, STEP_TIMEOUT).await?;
    let mut control = open_lane(conn, session_id, SessionLane::Control).await?;
    let done = initiator.finish(&mut control_in, &mut control).await?;
    build(conn, session_id, inbox, registration, control, control_in, done).await
}

/// 局域网直连（见 `airhand_proto::lan`）：没有服务器派发会话，控制端自己挑会话号、在控制通道上先写
/// 引导消息（里面是握手的第一条消息），被控端读了它才开始会话；之后的握手和 [`establish`] 完全一样
pub async fn establish_lan(
    router: &Arc<Router>,
    conn: &Connection,
    initiator: Initiator,
    lan: &LanConnect,
) -> Result<Established> {
    let session_id = lan.session_id;
    let (mut inbox, registration) = router.register(session_id);
    let mut control = open_lane(conn, session_id, SessionLane::Control).await?;
    // 先写引导消息（被控端连会话号都还不知道，要读它），再做握手
    wire::write_msg(&mut control, lan).await?;
    let mut control_in = first_stream(&mut inbox.control, STEP_TIMEOUT).await?;
    let done = initiator.finish(&mut control_in, &mut control).await?;
    build(conn, session_id, inbox, registration, control, control_in, done).await
}

/// 握手做完之后的共同部分（中转和局域网直连一样）：开大块通道、建好两条路、接收端
async fn build(
    conn: &Connection,
    session_id: u64,
    inbox: Inbox,
    registration: Registration,
    control: SendStream,
    control_in: RecvStream,
    done: Initiated,
) -> Result<Established> {
    let bulk = open_lane(conn, session_id, SessionLane::Bulk).await?;
    let secured = done.secured;
    let paths = Paths::new(conn.clone());
    let datagrams = DatagramSender::new(session_id, paths.clone(), secured.datagrams.sealer);
    let mut control_merge = Merge::new(
        SessionLane::Control,
        Policy::Complete,
        done.opener,
        inbox.control,
    );
    control_merge.add(control_in, Via::Relay)?;
    let receiver = HostReceiver::new(
        control_merge,
        Merge::new(
            SessionLane::Bulk,
            Policy::Complete,
            secured.bulk.opener,
            inbox.bulk,
        ),
        Merge::new(
            SessionLane::Video,
            Policy::Video,
            secured.video.opener,
            inbox.video,
        ),
        (inbox.audio, secured.audio.opener),
        (inbox.datagrams, secured.datagrams.opener),
        datagrams.clone(),
    );
    Ok(Established {
        session_id,
        peer: secured.peer,
        safety: secured.safety,
        negotiated: done.negotiated,
        control: (control, done.sealer),
        bulk: (bulk, secured.bulk.sealer),
        paths,
        datagrams,
        mic: secured.audio.sealer,
        receiver,
        feed: inbox.feed,
        registration,
    })
}
