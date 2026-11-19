<p align="center"><img src="assets/icon.svg" width="96" alt="Airhand"></p>

<h1 align="center">Airhand</h1>

<p align="center"><b>High-performance, low-latency remote desktop</b><br>QUIC transport · hardware encoding and decoding · up to 120 fps<br>Windows · macOS · Linux · Android · browser</p>

<p align="center">
  <a href="https://github.com/jiqing112/airhand/releases"><img src="https://img.shields.io/github/v/release/jiqing112/airhand?include_prereleases&label=release" alt="Release"></a>
  <a href="https://github.com/jiqing112/airhand/actions/workflows/release.yml"><img src="https://github.com/jiqing112/airhand/actions/workflows/release.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

<p align="center"><a href="README.zh-CN.md">简体中文</a> · <b>English</b></p>

---

Airhand is a **high-performance, low-latency remote desktop**: frames are hardware-encoded on the GPU (AV1 / HEVC / H.264) at up to 120 fps and transported over QUIC; when the network slows down it jumps straight to the newest frame, so latency never piles up; the mouse pointer is drawn locally, so moving it feels instant.

This repository is a fork of [sqlpxc/airhand](https://github.com/sqlpxc/airhand), maintained as a **standalone project** (same protocol and codebase, MIT), with its own features and experience improvements — see [Changes in this fork](#changes-in-this-fork).

## Changes in this fork

- **LAN direct connections**: works without a relay server (isolated networks, ad-hoc setups) — the host enables a `[lan]` listener in `config.toml`, and the controller connects straight to `IP:port`. End-to-end encryption, pairing codes and identity memory are identical to the relayed flow; devices you've connected are remembered for one-click reconnect (see [LAN direct connections](docs/usage.md#局域网直连))
- **Light theme + five palettes**: graphite light by default (warm paper canvas + fine grid + white glass), with clay / celadon / mist / dusk palettes one switch away; the remote-video area stays black (see [UI guidelines](docs/ui.md))
- **Redesigned connect page**: one input for both targets (a 6-digit code goes through the server, `IP:port` connects directly), all secondary copy removed; pasting 12 digits splits code + pairing code automatically
- **Windows fix**: double-clicking the tray icon now opens the console (previously a left-click only worked in controller mode)
- **CI/CD**: GitHub Actions builds the Windows / macOS / Linux installers and the relay server binaries; pushing a `v*` tag publishes a Release automatically (see [.github/workflows/release.yml](.github/workflows/release.yml))
- **Design guidelines**: design tokens (radii, 4 px spacing scale, type) and component-semantics Do / Don'ts (see [UI guidelines](docs/ui.md))

## Download

Grab the latest build from [Releases](https://github.com/jiqing112/airhand/releases):

| File | What it is |
|---|---|
| `Airhand_…_windows-x64-setup.exe` | Windows installer (registers a system service; controllable right after boot) |
| `Airhand_…_macos-arm64.dmg` | macOS (Apple silicon); see the signing note under Build |
| `Airhand_…_linux-amd64.deb` / `…_linux-x64` | Linux package / single file |
| `airhand-server-….tar.gz` | Relay server binary |

The relay address baked into these installers is the code default (`127.0.0.1:4433`, empty fingerprint = trust on first use). After installing, point it at your own server in [`config.toml`](docs/usage.md#配置文件); to build an installer that connects out of the box, set the repository Variables (`AIRHAND_SERVER` / `AIRHAND_SERVER_FP`) and push a new tag.

> [!NOTE]
> Since protocol v9 the client↔server and host↔controller sides each have a version range: new features negotiate with capability bits and unknown messages are skipped, so versions can mix; versions before v9 are incompatible and are detected with a clear message (see [Protocol versions](docs/development.md#协议版本)).

## Performance

Every step from capture to display is designed for low latency:

- **Hardware encoding/decoding**: the host hardware-encodes on the GPU (NVENC / Quick Sync / AMF, VideoToolbox, MediaCodec) in low-latency mode with no B-frames; the controller hardware-decodes (WebCodecs / MediaCodec). Measured on an RTX card: hardware AV1 encodes a 1080p frame in about 7 ms (output of a 4K screen)
- **Best format**: automatically picks the highest-compression format both ends support, in AV1 > HEVC > H.264 order; scaling and color conversion use SIMD, buffers are fully reused
- **Latency never piles up**: the host caps bytes in flight (≈ bitrate × (RTT + 50 ms)) and skips to the newest frame when the network slows down; bitrate is adjusted on every acknowledgement from measured queuing delay and bandwidth — it drops within a few hundred milliseconds and climbs back gradually
- **Direct path**: the two ends punch a direct connection besides the relay (same LAN, or non-symmetric NAT), so video and audio stop detouring through the server; the lower-latency path wins, and a broken direct path falls back to the relay without dropping the session
- **QUIC + BBR**: BBR congestion control is steadier than Cubic on lossy Wi-Fi and cross-border links; control messages, audio and video queue separately, so mouse and pings never wait behind big frames; the relay only forwards bytes and never parses frames
- **Decode and show**: the decoder runs in low-latency mode and draws straight onto a desynchronized Canvas, skipping the compositor queue and vsync
- **Local pointer**: the remote cursor shape is synced locally; movement happens locally
- **Bandwidth-friendly**: no frame is sent while the screen doesn't change — an idle desktop costs almost nothing; sessions on hidden tabs drop to 5 fps

See [How it works → Video](docs/architecture.md#画面).

## Features

- **LAN direct connections**: no relay server needed — connect to `IP:port` on the same network (new in this fork, see [LAN direct connections](docs/usage.md#局域网直连))
- **Windows system service**: lock screen, sign-in screen and UAC prompts are all visible and operable; the machine is controllable right after boot, before anyone signs in
- **Fixed control code**: survives restarts and upgrades, even a server reboot, until you change it
- **Console**: browser-style tabs, control several machines at once, an overview grid shows every screen; devices you connected to are saved and reconnect with a click; when the peer is offline it reconnects automatically once it comes back
- **Web console**: the controller side can also be deployed with Docker — open a browser and go, nothing to install on the machine you operate
- **Android**: control a PC or another phone with touchpad or touch gestures, share your own screen for assistance (with your consent by default); watch the screen on a TV with a remote
- **Audio**: the host's system audio is synced to the controller (Opus + adaptive jitter buffer), with lip-sync for videos; conversely the controller's microphone shows up on the Windows host as a virtual microphone (Steam Streaming Microphone), so you can join meetings or dictate on the remote machine
- **Utilities**: two-way clipboard sync, typing the clipboard as keystrokes, system shortcuts (Win, Alt+Tab, Ctrl+Shift+Esc…), multiple monitors, keyboard lockdown in fullscreen, quality presets
- **Secure by default**: sessions are end-to-end encrypted — the relay never sees the screen or keystrokes; the first connection asks for the pairing code shown in the host's tray (never through the server), after which the host remembers the controller; TLS 1.3 + certificate pinning, control codes are protected against brute force; the host shows who is connected and can disconnect them at any time
- **Leaves no trace**: the host is a single tray icon with no WebView; everything it saves lives in one `config.toml`, runtime files are deleted on exit; after [uninstalling](docs/usage.md#卸载) nothing remains (Windows has an uninstaller, macOS uninstall from the menu, Linux is two commands)
- **Bilingual**: follows the system language (English / 简体中文); messages from the remote computer and the server are shown in **your** language too

## Supported platforms

| Platform | Host | Controller | Notes |
|---|:-:|:-:|---|
| Windows 10 / 11 | ✅ | ✅ | Install required; the host runs as a system service |
| macOS 13+ | ✅ | ✅ | The host needs Screen & System Audio recording and Accessibility permissions |
| Linux | ✅ | ✅ | Host supports X11 only, software encoding for now |
| Android 7+ phone / tablet | ✅ | ✅ | Accessibility service required to be operated, otherwise view-only; the controller connects to one machine at a time |
| Android TV / Google TV | — | Watch only | Everything with the remote |
| Browser (web console) | — | ✅ | Chrome / Edge, Safari 16.4+, Firefox 130+ |

Known issues per platform: [Known limitations](docs/limitations.md). LAN direct connections currently cover the three desktop platforms (host listener + controller dial); Android is not supported yet.

## How it works

```mermaid
flowchart LR
    host["Host<br>Windows / macOS / Linux / Android"]
    relay["Relay server<br>airhand-server (Docker)"]
    ctrl["Controller<br>Desktop console / Web console / Android"]
    host <-->|"QUIC · UDP 4433"| relay
    relay <-->|"QUIC · UDP 4433"| ctrl
    host -. "direct (when it works)" .- ctrl
```

The host connects to the relay server at startup and gets a 6-digit control code; the controller finds it by that code. The server only registers codes, matches sessions and forwards bytes; the session is end-to-end encrypted and the server can't see the content. Both ends dial the server outbound — no open ports, no public IP. After the session starts both ends also try to punch a direct connection; if it works, video stops detouring through the server. See [How it works](docs/architecture.md).

**Without a relay server** (new in this fork): the host listens for QUIC on a local port, the controller dials `IP:port`, and the end-to-end handshake, pairing and session run the exact same code as the relayed flow — see [LAN direct connections](docs/usage.md#局域网直连).

## Quick start

You need:

- A machine reachable from both ends with Docker, exposing **UDP 4433** (skip this for pure-LAN use, see [LAN direct connections](docs/usage.md#局域网直连))
- Rust, Node.js 20+ and CMake to build the client (per-platform dependencies under [Build](docs/building.md#dependencies))

### 1. Deploy the relay server

```bash
git clone https://github.com/jiqing112/airhand.git
cd airhand
docker compose up -d
docker compose logs airhand | grep fingerprint   # note the SHA-256 fingerprint
```

The certificate and the control-code database live in `data/` — **keep that directory**: if the certificate changes, existing clients can no longer connect. Server configuration: [Deploy](docs/deploy.md#the-relay-server).

### 2. Build the client

Bake the server address and the fingerprint from step 1 into the program (or skip this and edit `config.toml` after installing from Releases).

Windows (PowerShell):

```powershell
cd client
npm install
$env:AIRHAND_SERVER    = "relay.example.com:4433"
$env:AIRHAND_SERVER_FP = "<the fingerprint from step 1>"
npm run tauri build
```

macOS / Linux:

```bash
cd client
npm install
export AIRHAND_SERVER=relay.example.com:4433
export AIRHAND_SERVER_FP=<the fingerprint from step 1>
npm run tauri build
```

Output lands in `client/src-tauri/target/release/bundle/`:

| System | Installer |
|---|---|
| Windows | `nsis/Airhand_<version>_x64-setup.exe` |
| macOS | `macos/Airhand.app`, `dmg/Airhand_<version>_<arch>.dmg` |
| Linux | `deb/Airhand_<version>_amd64.deb` |

Alternatively push a `v*` tag and let [CI/CD](.github/workflows/release.yml) build all three platforms and publish the Release. The server address and fingerprint can also be changed later in [`config.toml`](docs/usage.md#配置文件). For the Android APK see [Build → Android](docs/building.md#androidapk).

### 3. Connect

1. Install Airhand on both machines (run the installer on Windows — admin required; grant permissions on macOS at first launch)
2. On the machine you want to **control**, right-click the tray icon (macOS: click the menu bar icon) and read the 6-digit **control code**
3. On **your** machine, open the console from the tray menu (macOS / Linux: **Switch to controller**) or just **double-click the tray icon**, and type the control code. The first time you connect to that machine you also type the 6-digit **pairing code** from its tray menu — after that you're remembered

**LAN direct connection**: enable the `[lan]` listener in the host's `config.toml` and restart it; on the controller, type the peer's `IP:port` in the connect page — see [LAN direct connections](docs/usage.md#局域网直连).

Full usage guide: [Usage](docs/usage.md).

### No install: the web console

Run the web console on any Docker machine and control from a browser:

```bash
cd web
AIRHAND_SERVER=relay.example.com:4433 AIRHAND_SERVER_FP=<fingerprint> docker compose up -d
```

Open `http://localhost:8080` on that machine, or `https://<that machine's address>:8080` from others. Password, HTTPS certificates and reverse proxy: [Deploy → Web console](docs/deploy.md#web-consolenedocker).

## Documentation

| Document | Content |
|---|---|
| [Usage](docs/usage.md) | Host, Windows install, config file, **LAN direct connections**, uninstall, console, quality, UI language |
| [UI guidelines](docs/ui.md) | Design tokens (color / radius / spacing / type), component-semantics Do / Don'ts |
| [Deploy](docs/deploy.md) | Relay server configuration, web console, reverse proxy |
| [Android](docs/android.md) | Controlling from a phone, sharing the phone, gestures, TV |
| [Build](docs/building.md) | Dependencies and installers per platform, signing, APK |
| [How it works](docs/architecture.md) | Architecture, code layout, Windows service, video and audio, A/V sync, files on disk |
| [Security](docs/security.md) | Encryption and certificate pinning, brute-force protection, control code and reconnect tokens |
| [Known limitations](docs/limitations.md) | Known issues by platform |
| [Development](docs/development.md) | Tests, debugging tools, project conventions |

## Security notes

- TLS 1.3 (QUIC) throughout; clients verify the server by certificate fingerprint. Without a fingerprint baked in, the client remembers the server's certificate on first connect and refuses to connect when it changes — that only protects the first connection, so pin the fingerprint for real deployments
- **End-to-end encryption**: screen, audio, keyboard, mouse and clipboard are encrypted between host and controller; the relay can't see or alter them — it only knows who connected to whom and how much traffic. The web console is one end of the E2E encryption, so its machine can see the screen. LAN direct connections skip the server entirely; E2E encryption and pairing apply as usual
- **Control code + pairing code**: the server knows all control codes, so the first connection also asks for the pairing code from the host's tray (it never passes through the server; five wrong tries pause pairing), and the host remembers the controller afterwards. The Windows host runs as SYSTEM — anyone who can connect operates the machine as admin; the tray shows who is connected at all times and can disconnect them, change the control code or the pairing code. LAN mode has no control code "gate": the pairing code is the only threshold, and the `[lan]` `allow` network list keeps unknown machines out before they even connect

See [Security](docs/security.md).

## Contributing

| Directory | Content |
|---|---|
| `crates/` | Protocol (`airhand-proto`) and the client↔server link (`airhand-link`); the LAN-direct protocol messages (`airhand-proto/src/lan.rs`) and listener / dialer implementations (`host/lan.rs`, `controller`) live here too |
| `server/` | Relay server |
| `web/` | Web console service |
| `client/` | Desktop client: Tauri (Rust) + React UI, shared with the web console |
| `android/` | Android app (Kotlin + Jetpack Compose) and its Rust core |

Tests, debugging tools and project conventions (protocol versions, UI copy, [UI guidelines](docs/ui.md)): [Development](docs/development.md).

## License

[MIT](LICENSE). Built on [sqlpxc/airhand](https://github.com/sqlpxc/airhand) — thanks to the original author.
