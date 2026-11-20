//! 本机标识（计算机名 / 操作系统），仅用于展示。计算机名未知时为空字符串。

use std::sync::OnceLock;

pub fn host_identity() -> (String, String) {
    static CACHE: OnceLock<(String, String)> = OnceLock::new();
    CACHE.get_or_init(|| (hostname(), os_name())).clone()
}

fn hostname() -> String {
    // macOS："系统设置 → 通用 → 共享"里的电脑名称（例如"张三的 MacBook Pro"），比主机名好认
    #[cfg(target_os = "macos")]
    if let Some(name) = mac_computer_name() {
        return name;
    }
    for key in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(v) = std::env::var(key)
            && !v.trim().is_empty()
        {
            return v;
        }
    }
    #[cfg(unix)]
    for path in ["/proc/sys/kernel/hostname", "/etc/hostname"] {
        if let Ok(v) = std::fs::read_to_string(path)
            && !v.trim().is_empty()
        {
            return v.trim().to_string();
        }
    }
    // 不知道名称：发空字符串，由显示的一方按自己的语言显示"未知设备"
    String::new()
}

#[cfg(windows)]
fn os_name() -> String {
    use windows::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW};
    use windows::core::{HSTRING, PCWSTR};

    fn reg(name: &str) -> Option<String> {
        let key = HSTRING::from(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        let name = HSTRING::from(name);
        let mut buf = [0u16; 256];
        let mut len = (buf.len() * 2) as u32;
        let ok = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                PCWSTR(key.as_ptr()),
                PCWSTR(name.as_ptr()),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut len),
            )
        };
        if ok.is_err() {
            return None;
        }
        let n = (len as usize / 2).saturating_sub(1);
        Some(String::from_utf16_lossy(&buf[..n.min(buf.len())]))
    }

    let build: u32 = reg("CurrentBuild")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let product = reg("ProductName").unwrap_or_else(|| "Windows".into());
    // Windows 11 的注册表 ProductName 仍然写着 Windows 10
    let product = if build >= 22000 {
        product.replace("Windows 10", "Windows 11")
    } else {
        product
    };
    match reg("DisplayVersion") {
        Some(v) => format!("{product} {v}"),
        None => product,
    }
}

/// 发行版名称，例如 "Ubuntu 24.04.1 LTS"。
#[cfg(target_os = "linux")]
fn os_name() -> String {
    let release = std::fs::read_to_string("/etc/os-release")
        .or_else(|_| std::fs::read_to_string("/usr/lib/os-release"))
        .unwrap_or_default();
    parse_os_release(&release).unwrap_or_else(|| "Linux".into())
}

#[cfg(target_os = "linux")]
fn parse_os_release(text: &str) -> Option<String> {
    let field = |key: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(key)?.strip_prefix('='))
            .map(|v| v.trim().trim_matches(['"', '\'']).to_string())
            .filter(|v| !v.is_empty())
    };
    field("PRETTY_NAME").or_else(|| field("NAME"))
}

#[cfg(target_os = "macos")]
fn mac_computer_name() -> Option<String> {
    use objc2_core_foundation::{CFRetained, CFString};

    #[link(name = "SystemConfiguration", kind = "framework")]
    unsafe extern "C" {
        fn SCDynamicStoreCopyComputerName(
            store: *const std::ffi::c_void,
            encoding: *mut u32,
        ) -> *mut CFString;
    }
    // 返回 +1 引用
    let name = std::ptr::NonNull::new(unsafe {
        SCDynamicStoreCopyComputerName(std::ptr::null(), std::ptr::null_mut())
    })
    .map(|p| unsafe { CFRetained::from_raw(p) })?;
    let name = name.to_string();
    (!name.trim().is_empty()).then_some(name)
}

/// 例如 "macOS 15.3.1"
#[cfg(target_os = "macos")]
fn os_name() -> String {
    let v = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    if v.patchVersion > 0 {
        format!(
            "macOS {}.{}.{}",
            v.majorVersion, v.minorVersion, v.patchVersion
        )
    } else {
        format!("macOS {}.{}", v.majorVersion, v.minorVersion)
    }
}

// ───────────────────────────── 局域网地址 ─────────────────────────────

/// 本机所有能被别的设备连的局域网 IPv4，按网卡顺序。虚拟网卡（VMware / Hyper-V / WSL 的
/// 网段）也在里面——虚拟机往往就是从那些网段连过来的。环回（127）、链路本地（169.254）
/// 和未指定的地址不算。主界面信息条点倒三角列出来的就是它们。
pub fn lan_ips() -> Vec<std::net::Ipv4Addr> {
    #[cfg(windows)]
    let list = lan_ips_windows();
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let list = lan_ips_getifaddrs();
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    let list = Vec::new();
    let mut out: Vec<std::net::Ipv4Addr> = Vec::new();
    for ip in list {
        if !out.contains(&ip) {
            out.push(ip);
        }
    }
    out
}

fn usable_lan_ip(ip: std::net::Ipv4Addr) -> bool {
    !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified()
}

#[cfg(windows)]
fn lan_ips_windows() -> Vec<std::net::Ipv4Addr> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
        GetAdaptersAddresses, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows::Win32::Networking::WinSock::{AF_INET, SOCKADDR_INET};

    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size: u32 = 0;
    // 第一次调用拿需要的大小；网卡会变，失败就加大缓冲再试
    let _ = unsafe { GetAdaptersAddresses(AF_INET.0 as u32, flags, None, None, &mut size) };
    for _ in 0..4 {
        let mut buf = vec![0u8; size.max(16 * 1024) as usize];
        let mut len = buf.len() as u32;
        let err = unsafe {
            GetAdaptersAddresses(
                AF_INET.0 as u32,
                flags,
                None,
                Some(buf.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>()),
                &mut len,
            )
        };
        if err != 0 {
            size = (len.max(size)) * 2;
            continue;
        }
        let mut out = Vec::new();
        let mut cur = buf.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        while !cur.is_null() {
            let adapter = unsafe { &*cur };
            let mut unicast = adapter.FirstUnicastAddress;
            while !unicast.is_null() {
                let u = unsafe { &*unicast };
                let sa: &SOCKADDR_INET =
                    unsafe { &*(u.Address.lpSockaddr as *const SOCKADDR_INET) };
                let (family, b) = unsafe { (sa.si_family, sa.Ipv4.sin_addr.S_un.S_un_b) };
                if family == AF_INET {
                    let ip = std::net::Ipv4Addr::new(b.s_b1, b.s_b2, b.s_b3, b.s_b4);
                    if usable_lan_ip(ip) {
                        out.push(ip);
                    }
                }
                unicast = u.Next;
            }
            cur = adapter.Next;
        }
        return out;
    }
    Vec::new()
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn lan_ips_getifaddrs() -> Vec<std::net::Ipv4Addr> {
    let mut out = Vec::new();
    unsafe {
        let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut list) != 0 {
            return out;
        }
        let mut cur = list;
        while !cur.is_null() {
            let it = &*cur;
            if let Some(addr) = unsafe { it.ifa_addr.as_ref() }
                && addr.sa_family as i32 == libc::AF_INET
                && it.ifa_flags & libc::IFF_UP as u32 != 0
                && it.ifa_flags & libc::IFF_LOOPBACK as u32 == 0
            {
                let sa = addr as *const libc::sockaddr as *const libc::sockaddr_in;
                let ip = std::net::Ipv4Addr::from(u32::from_be(unsafe { (*sa).sin_addr.s_addr }));
                if usable_lan_ip(ip) {
                    out.push(ip);
                }
            }
            cur = it.ifa_next;
        }
        libc::freeifaddrs(list);
    }
    out
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn os_name() -> String {
    std::env::consts::OS.to_string()
}

#[cfg(all(test, target_os = "macos"))]
mod mac_tests {
    #[test]
    fn identity() {
        let (name, os) = super::host_identity();
        println!("{name:?} / {os:?}");
        assert!(!name.is_empty());
        assert!(os.starts_with("macOS "), "{os}");
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    #[test]
    fn os_release() {
        let ubuntu = "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\n";
        assert_eq!(
            super::parse_os_release(ubuntu).as_deref(),
            Some("Ubuntu 24.04.1 LTS")
        );
        assert_eq!(
            super::parse_os_release("NAME=Fedora\nVERSION=40").as_deref(),
            Some("Fedora")
        );
        assert_eq!(
            super::parse_os_release("NAME='Arch Linux'").as_deref(),
            Some("Arch Linux")
        );
        assert_eq!(super::parse_os_release(""), None);
    }
}

#[cfg(test)]
mod lan_tests {
    #[test]
    fn lists_lan_ips() {
        let ips = super::lan_ips();
        println!("本机局域网地址: {ips:?}");
        assert!(!ips.is_empty(), "至少应该枚举出一块网卡的地址");
    }
}
