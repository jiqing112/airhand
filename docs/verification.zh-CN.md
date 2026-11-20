# 验证记录

[← 返回 README](../README.zh-CN.md)

对仓库做的端到端实测记录：每个版本发布前在本机完整跑一遍构建、运行、互连和测试，结论记在这里。

## 2026-11-20（协议 v9，v0.2.3）

环境：Windows 10 Pro for Workstations 22H2 x64，Rust 1.99.1（`stable-x86_64-pc-windows-gnu`，本机编译非 CI），Node 24。

### 结论

**程序能真正运行：服务端、桌面客户端、网页控制台，以及客户端互相连接建立远程会话，全链路实测通过。**

| 验证 | 结果 |
|---|---|
| `cargo check` 三个工作区（服务端 / 客户端 / 网页控制台） | ✅ |
| 服务端构建并启动：自签证书、SQLite、UDP 监听 | ✅ |
| 桌面客户端启动并连上服务器：首连记住证书指纹（`[server_trust]`）、DPAPI 加密身份密钥 | ✅ |
| 协议库 / 链路库测试（`cargo test -p airhand-proto -p airhand-link`） | ✅ 159 个全过 |
| 客户端单元测试（`cargo test --lib`：编码器含硬件探测、音频、采集、配置生命周期） | ✅ 63 个全过（`--test-threads=1`，见下面"遗留问题"） |
| e2e：被控端 ↔ 控制端完整会话（错误控制码拒绝、配对码、E2E 握手、硬件编码、100 帧真实画面、声音 301 包、光标、ping） | ✅ |
| e2e：杀掉服务器 → 12 s 检测掉线 → 重启后 0.6 s 重连且控制码保持不变 → 更换控制码 0.1 s 生效 | ✅ |
| 真实三方互连：GUI 被控端 ↔ 网页控制台（浏览器里输入控制码连接） | ✅ 30 fps · 4 Mbps · 2 ms · H.265/HEVC 硬件编码 · 直连（P2P 打洞成功，画面音频自动从中转切到直连） |
| 断开连接（控制端主动） | ✅ 三方日志一致（会话建立 / 结束、安全码两侧一致），"我的设备"自动保存 |
| 前端构建（`tsc --noEmit` + vite） | ✅ |

互连会话期间的关键日志（被控端）：

```text
host connected to the server code=266245
controller wants to connect  name=Airhand Web
end-to-end session established  admission=Open  safety=251-912  negotiated=version 1
desktop session starting  displays=1
direct path established
video and audio switch paths  to=Direct  relay_ms=1.07  direct_ms=0.857
direct path closed: closed by peer
```

### 本次发现并修复

- **`server/src/broker/tests.rs` 没跟上 API 演进**：`airhand_link::host::run` 加了 `lan` 参数、`SessionInfo::resume` 改成了 `Option<ResumeToken>`，`cargo test --workspace` 编译失败 → 已修复，根工作区 194 个测试全过
- **Windows 下测试 / 示例的可执行文件没有 manifest**：tauri-build 只给 bin 目标嵌资源，而测试同样链接 comctl32 v6 的入口点，进程一加载就报 `STATUS_ENTRYPOINT_NOT_FOUND`（0xC0000139）→ `client/src-tauri/build.rs` 现在在 GNU 工具链下用 embed-resource 把 `windows/tests.rc` 嵌进所有测试和示例的可执行文件（工具链要求见[构建文档](building.zh-CN.md#windows-上用-gnu-工具链开发--测试)；MSVC 不做叠加——它的链接器不接受重复的 manifest 资源，构建行为不变）
- 修复后客户端单元测试在**默认并行模式**下也全部通过（此前单线程才能跑完的并发崩溃未再复现，留观）

### 遗留问题

- 客户端测试并行运行时曾出现一个并发崩溃（单线程全过；嫌疑集中在同时初始化 Media Foundation / DXGI / COM 的测试）：manifest 修复后的复测在并行模式下全部通过，是否彻底解决留观
