// "我的设备"的列表操作（纯函数）。保存在 config.toml 的 [[device]] 里（见 Rust 端 devices.rs），
// 每次变化都把整个列表交给 api.saveDevices（见 actions.ts）。
import type { MouseMode, QualitySettings, ResumeToken, SavedDevice } from "./api";

/** 最多保存多少台（与 Rust 端 devices::MAX 相同） */
export const MAX_DEVICES = 50;

/** 控制码显示成 "123 456" */
export const fmtCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

/** 显示的名字：自己起的名字 > 对方的设备名 > 控制码（局域网直连的设备：地址） */
export const deviceTitle = (d: SavedDevice) =>
  d.alias?.trim() || d.name.trim() || (d.code ? fmtCode(d.code) : d.addr || "");

/** 一台设备的键：控制码（走服务器）或者地址（局域网直连，code 是空的） */
export const deviceKey = (d: Pick<SavedDevice, "code" | "addr">) => d.code || d.addr || "";

/** 最近连过的在前面 */
export const sortDevices = (list: SavedDevice[]) => [...list].sort((a, b) => b.lastUsed - a.lastUsed);

/** 连上了：记下（或更新）这台电脑。自己起的名字保留，对方的名字、系统、凭证、画质、鼠标模式用这次的 */
export function remember(
  list: SavedDevice[],
  seen: {
    code: string;
    /** 局域网直连的目标地址（code 是空的设备靠它区分） */
    addr?: string | null;
    name: string;
    os: string;
    resume: ResumeToken | null;
    quality: QualitySettings | null;
    hostKey?: string | null;
    mouse?: MouseMode | null;
    swapCtrlCommand?: boolean;
  },
  now: number,
): SavedDevice[] {
  const key = seen.code || seen.addr || "";
  const old = list.find((d) => deviceKey(d) === key);
  const d: SavedDevice = {
    code: seen.code,
    addr: seen.addr ?? old?.addr ?? null,
    alias: old?.alias ?? null,
    name: seen.name.trim() || old?.name || "",
    os: seen.os.trim() || old?.os || "",
    resume: seen.resume ?? old?.resume ?? null,
    lastUsed: now,
    quality: seen.quality ?? old?.quality ?? null,
    mouse: seen.mouse ?? old?.mouse ?? null,
    swapCtrlCommand: seen.swapCtrlCommand ?? old?.swapCtrlCommand ?? false,
    // 对方的公钥：连上时确认过的（第一次连上、或者用户信任了新的身份）代替旧的
    hostKey: seen.hostKey ?? old?.hostKey ?? null,
  };
  return sortDevices([d, ...list.filter((x) => deviceKey(x) !== key)]).slice(0, MAX_DEVICES);
}

/** 更新设备名或会话偏好（列表里没有就什么也不变）。键：控制码，或者局域网直连的地址 */
export function patchDevice(
  list: SavedDevice[],
  key: string,
  patch: Partial<Pick<SavedDevice, "alias" | "quality" | "mouse" | "swapCtrlCommand">>,
) {
  if (!list.some((d) => deviceKey(d) === key)) return list;
  return list.map((d) => (deviceKey(d) === key ? { ...d, ...patch } : d));
}

/** 重命名：和对方的设备名一样、或者清空，就是不另起名字 */
export function renameDevice(list: SavedDevice[], key: string, name: string) {
  const d = list.find((x) => deviceKey(x) === key);
  if (!d) return list;
  const n = name.trim();
  return patchDevice(list, key, { alias: n && n !== d.name ? n : null });
}

export const forgetDevice = (list: SavedDevice[], key: string) =>
  list.filter((d) => deviceKey(d) !== key);

/** 撤销移除：放回原来的位置（按最后连接时间） */
export const restoreDevice = (list: SavedDevice[], d: SavedDevice) =>
  sortDevices([d, ...list.filter((x) => x.code !== d.code)]).slice(0, MAX_DEVICES);

/** 搜索：名字（不分大小写）或控制码（可以带空格） */
export function matchDevice(d: SavedDevice, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\s/g, "");
  return (
    deviceTitle(d).toLowerCase().includes(q) ||
    d.name.toLowerCase().includes(q) ||
    d.addr?.toLowerCase().includes(q) ||
    (/^\d+$/.test(digits) && d.code.includes(digits))
  );
}

/** "刚刚" / "5 分钟前" / "3 天前" / 很久以前的写日期 */
export function relativeTime(ms: number, now: number, locale: string): string {
  if (!ms) return "";
  const s = Math.max(0, (now - ms) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (s < 60) return rtf.format(0, "second");
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  if (s < 86400 * 30) return rtf.format(-Math.floor(s / 86400), "day");
  return new Date(ms).toLocaleDateString(locale);
}
