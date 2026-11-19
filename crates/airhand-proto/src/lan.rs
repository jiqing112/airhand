//! 局域网直连（没有服务器时的连接方式）。
//!
//! 中转模式里，服务器负责分配控制码、配对会话（[`crate::signal`]）。局域网直连不需要服务器：被控端在本机的
//! 指定地址上监听 QUIC，控制端直接连 `IP:端口`，自己生成会话号，把端到端握手的第一条消息放在
//! [`LanConnect`] 里直接写在控制通道上。被控端收下之后走的和 [`crate::signal::ServerMsg::Incoming`]
//! 之后完全一样：[`crate::handshake`] 的 Noise 握手、配对码的 SPAKE2、会话层，一行都不用改。
//!
//! # TLS 的角色
//!
//! 和中转一样，TLS 在这里只是传输层：被控端的证书是临时生成的自签名证书，两端都不用它认身份
//! （控制端连任意自签名的被控端都接受）。真正的认证是端到端的：身份公钥记住了就连（Noise IK），
//! 第一次连靠安全码人工比对（Noise XX），要配对码的靠 SPAKE2（Noise XXpsk3）——
//! 中间人冒充不了任何一边，和中转模式下"服务器也不可信"是同一个模型。

use minicbor::{Decode, Encode};

/// 局域网直连的默认端口（可配置）
pub const LAN_DEFAULT_PORT: u16 = 4433;

/// 局域网直连时当控制码用的哨兵值。
///
/// 配对码的 SPAKE2 密码里混着控制码（[`crate::handshake::pake_password`]），两端必须用同一个值。
/// 直连模式下控制端不知道（也不需要知道）被控端的控制码，两端就都用这个哨兵。它不在
/// [`crate::CODE_MIN`]..=[`crate::CODE_MAX`] 里，不会和真的控制码撞；配对的结果是身份公钥
/// （"配对过的控制端"），和从哪个码连上来的无关。
pub const LAN_CODE: u32 = 0;

/// 控制端 → 被控端：局域网直连连上之后，控制通道上的第一条消息（长度前缀 CBOR，明文——
/// 这时还没有共同的密钥）。被控端从这条流里读走它，剩下的字节就是端到端握手的后续消息。
#[derive(Encode, Decode, Debug, Clone)]
#[cbor(map)]
pub struct LanConnect {
    /// 控制端生成的会话号：这条直连上的所有通道和数据报都用它（代替服务器分配的那个）
    #[n(0)]
    pub session_id: u64,
    /// 端到端握手的第一条消息（[`crate::handshake::HandshakeInit`] 编码后的字节）
    #[cbor(n(1), with = "minicbor::bytes")]
    pub init: Vec<u8>,
    /// 控制端的设备名（被控端的审批界面、托盘里显示）
    #[n(2)]
    pub name: String,
    /// 控制端的操作系统
    #[n(3)]
    pub os: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_connect_roundtrip() {
        let msg = LanConnect {
            session_id: 0x0123456789abcdef,
            init: vec![1, 2, 3, 4],
            name: "My Laptop".into(),
            os: "windows".into(),
        };
        let bytes = minicbor::to_vec(&msg).unwrap();
        let back: LanConnect = minicbor::decode(&bytes).unwrap();
        assert_eq!(back.session_id, msg.session_id);
        assert_eq!(back.init, msg.init);
        assert_eq!(back.name, msg.name);
        assert_eq!(back.os, msg.os);
    }

    #[test]
    fn lan_connect_skips_unknown_fields() {
        // 未来的版本加了字段：不认识的跳过（见 crate 说明的兼容规则）
        let mut bytes = minicbor::to_vec(&LanConnect {
            session_id: 7,
            init: vec![9],
            name: "a".into(),
            os: "b".into(),
        })
        .unwrap();
        // 手工附加一个编号 10 的未知文本字段
        bytes.push(0x6a); // text(10)
        bytes.extend_from_slice(b"future");
        let back: LanConnect = minicbor::decode(&bytes).unwrap();
        assert_eq!(back.session_id, 7);
        assert_eq!(back.name, "a");
    }

    #[test]
    fn lan_code_is_outside_the_code_range() {
        assert!(LAN_CODE < crate::CODE_MIN || LAN_CODE > crate::CODE_MAX);
    }
}
