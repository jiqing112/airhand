// 设置对话框：标签栏的齿轮打开，左右结构——左边选节，右边是内容。
//
// * 服务器：中转服务器地址 + 证书指纹（桌面版才有——网页版的服务器就是当前页面的地址）；
//   保存进 config.toml（Windows 安装版经命名管道交给服务写），改完"立即重启"让两个进程都拿到新地址；
// * 局域网直连：监听开关 / 端口 / 连接密码（就是被控端的配对码）；
// * 通用：界面语言；快捷键说明（网页版没有）；
// * 关于：版本、本机名、配置文件路径（设置和我的设备都在里面）。
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { setLang, useLang, useT, type Lang } from "../lib/i18n";
import { store, useStore } from "../lib/store";
import { IconCheck, IconCopy } from "./Icons";
import { Logo } from "./Logo";

type Section = "server" | "lan" | "general" | "about";

export function SettingsDialog() {
  const t = useT();
  const open = useStore((s) => s.settings);
  const web = api.kind === "web";
  const close = () => store.setSettings(false);
  const [section, setSection] = useState<Section>("server");

  // Esc 关闭
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  // 只在齿轮打开时渲染：软件启动展示的是主页面
  if (!open) return null;

  const nav: { id: Section; label: string }[] = [
    ...(!web
      ? [
          { id: "server" as Section, label: t("settings.server") },
          { id: "lan" as Section, label: t("settings.lan") },
        ]
      : []),
    { id: "general" as Section, label: t("settings.general") },
    { id: "about" as Section, label: t("settings.about") },
  ];
  const current = nav.some((n) => n.id === section) ? section : nav[0].id;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal settings">
        <nav className="set-nav">
          <div className="set-nav-brand">
            <Logo size={24} />
            <span>{t("settings.title")}</span>
          </div>
          {nav.map((n) => (
            <button
              key={n.id}
              className={`set-nav-item ${current === n.id ? "active" : ""}`}
              onClick={() => setSection(n.id)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="set-body">
          <div className="set-body-head">
            <h3>{nav.find((n) => n.id === current)?.label}</h3>
            <button className="icon-btn subtle" aria-label={t("settings.close")} onClick={close}>
              <span aria-hidden>×</span>
            </button>
          </div>
          {current === "server" && !web && <ServerSection />}
          {current === "lan" && !web && <LanSection />}
          {current === "general" && <GeneralSection />}
          {current === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

/** 中转服务器：地址 + 指纹，保存进 config.toml（Windows 安装版经服务写）。改完要重启才生效 */
function ServerSection() {
  const t = useT();
  const app = useStore((s) => s.app);
  const [server, setServer] = useState("");
  const [fp, setFp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 最近一次成功保存的值：它就是磁盘上的现状（界面上显示的 app.server 要重启才更新） */
  const [saved, setSaved] = useState<{ s: string; f: string } | null>(null);

  // app 信息晚一点到达（启动时 appInfo 是异步的）：只回填一次
  useEffect(() => {
    if (app) {
      setServer((v) => v || app.server);
      setFp((v) => v || app.serverFp || "");
    }
  }, [app]);

  const baseline = saved ?? { s: app?.server ?? "", f: app?.serverFp ?? "" };
  const dirty = server.trim() !== baseline.s || fp.trim() !== baseline.f;
  const fpOk = fp.trim() === "" || /^[0-9a-fA-F:\s]{59,}$/.test(fp.trim());
  const ready = server.trim() !== "" && fpOk;

  const save = () => {
    if (!ready || !dirty || saving) return;
    setSaving(true);
    setError(null);
    void api
      .saveServer(server.trim(), fp.trim())
      .then(() => setSaved({ s: server.trim(), f: fp.trim() }))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setSaving(false));
  };

  const restart = () => void api.restartApp().catch(() => {});

  return (
    <div className="set-section">
      <div className="set-title">
        {t("settings.server")}
        {app && (
          <span className="badge warn" title={t("server.unpinnedHint")}>
            {t(app.pinned ? "server.pinned" : "server.unpinned")}
          </span>
        )}
      </div>
      <label className="nt-field">
        <span className="am-label">{t("settings.serverAddr")}</span>
        <input
          className={`set-input mono ${server.trim() === "" ? "invalid" : ""}`}
          value={server}
          spellCheck={false}
          autoComplete="off"
          placeholder="relay.example.com:4433"
          onChange={(e) => setServer(e.target.value)}
        />
      </label>
      <label className="nt-field">
        <span className="am-label">{t("settings.serverFp")}</span>
        <input
          className={`set-input mono ${fpOk ? "" : "invalid"}`}
          value={fp}
          spellCheck={false}
          autoComplete="off"
          placeholder={t("settings.serverFpPlaceholder")}
          onChange={(e) => setFp(e.target.value)}
        />
      </label>

      <div className="set-actions">
        <button className="primary-btn" disabled={!ready || !dirty || saving} onClick={save}>
          {saving ? <span className="spinner" /> : null}
          <span>{t("settings.save")}</span>
        </button>
        {saved && (
          <>
            <span className="set-saved">
              <IconCheck size={14} />
              {t("settings.saved")}
            </span>
            <button className="ghost-btn" onClick={restart}>
              {t("settings.restartNow")}
            </button>
          </>
        )}
      </div>
      {error && <div className="set-error">{error}</div>}
      {saved && <div className="set-note">{t("settings.restartHint")}</div>}
    </div>
  );
}

/** 局域网直连：监听开关 + 端口 + 连接密码（就是被控端的配对码，第一次连接要输入）。
 * 保存写 `[lan]` 和配对码，重启后被控端开始监听；托盘菜单会显示本机的局域网地址 */
function LanSection() {
  const t = useT();
  const app = useStore((s) => s.app);
  const [listen, setListen] = useState(false);
  const [port, setPort] = useState("4433");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ listen: boolean; port: number } | null>(null);

  // app 信息晚一点到达：只回填一次
  useEffect(() => {
    if (app) {
      setListen((v) => v || app.lanListen || false);
      setPort((v) => (v === "4433" && app.lanPort ? String(app.lanPort) : v));
    }
  }, [app]);

  const portNum = Number(port);
  const portOk = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;
  const pwOk = password.trim() === "" || /^\d{6}$/.test(password.trim());
  const baseline = saved ?? { listen: app?.lanListen ?? false, port: app?.lanPort ?? 4433 };
  const dirty = listen !== baseline.listen || portNum !== baseline.port || password.trim() !== "";
  const ready = portOk && pwOk;

  const save = () => {
    if (!ready || !dirty || saving) return;
    setSaving(true);
    setError(null);
    const pw = password.trim() === "" ? null : password.trim();
    void api
      .saveLan(listen, portNum, pw)
      .then(() => {
        setSaved({ listen, port: portNum });
        setPassword("");
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setSaving(false));
  };

  const restart = () => void api.restartApp().catch(() => {});

  return (
    <div className="set-section">
      <div className="set-row">
        <span className="am-label">{t("settings.lanListen")}</span>
        <input
          type="checkbox"
          className="switch"
          checked={listen}
          onChange={(e) => setListen(e.target.checked)}
        />
      </div>
      {listen && (
        <>
          <label className="nt-field">
            <span className="am-label">{t("settings.lanPort")}</span>
            <input
              className={`set-input mono ${portOk ? "" : "invalid"}`}
              value={port}
              inputMode="numeric"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
            />
          </label>
          <label className="nt-field">
            <span className="am-label">{t("settings.lanPassword")}</span>
            <input
              className={`set-input mono ${pwOk ? "" : "invalid"}`}
              value={password}
              inputMode="numeric"
              autoComplete="new-password"
              placeholder={t("settings.lanPasswordPlaceholder")}
              maxLength={6}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <span className="set-note">{t("settings.lanPasswordHint")}</span>
          </label>
        </>
      )}
      <div className="set-actions">
        <button className="primary-btn" disabled={!ready || !dirty || saving} onClick={save}>
          {saving ? <span className="spinner" /> : null}
          <span>{t("settings.save")}</span>
        </button>
        {saved && (
          <>
            <span className="set-saved">
              <IconCheck size={14} />
              {t("settings.saved")}
            </span>
            <button className="ghost-btn" onClick={restart}>
              {t("settings.restartNow")}
            </button>
          </>
        )}
      </div>
      {error && <div className="set-error">{error}</div>}
      {saved && <div className="set-note">{t("settings.lanHint")}</div>}
    </div>
  );
}

/** 通用：界面语言、快捷键（网页版没有快捷键——浏览器会拦） */
function GeneralSection() {
  const t = useT();
  const web = api.kind === "web";
  return (
    <div className="set-section">
      <div className="set-row">
        <span className="am-label">{t("settings.language")}</span>
        <LangSwitch />
      </div>
      {!web && (
        <details className="set-keys">
          <summary className="am-label">{t("settings.shortcuts")}</summary>
          <div className="am-keys">
            <Keys keys={["Ctrl", "T"]}>{t("shortcut.newTab")}</Keys>
            <Keys keys={["Ctrl", "W"]}>{t("shortcut.closeTab")}</Keys>
            <Keys keys={["Ctrl", "Tab"]}>{t("shortcut.nextTab")}</Keys>
            <Keys keys={["Ctrl", "1~9"]}>{t("shortcut.nthTab")}</Keys>
            <Keys keys={["Ctrl", "Shift", "T"]}>{t("shortcut.reopen")}</Keys>
          </div>
        </details>
      )}
    </div>
  );
}

/** 关于：版本、本机名、配置文件（设置和我的设备都在里面） */
function AboutSection() {
  const t = useT();
  const app = useStore((s) => s.app);
  return (
    <div className="set-section">
      <div className="set-about">
        <div className="set-row">
          <span>{t("settings.version")}</span>
          <span className="mono">{app?.version ?? "—"}</span>
        </div>
        <div className="set-row">
          <span>{t("settings.hostname")}</span>
          <span className="ellipsis" title={app?.hostname}>
            {app?.hostname || t("common.thisComputer")}
          </span>
        </div>
        {app?.configPath && (
          <div className="set-row">
            <span>{t("settings.config")}</span>
            <CopyButton text={app.configPath} />
          </div>
        )}
      </div>
    </div>
  );
}

function Keys({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <>
      <span className="keys">
        {keys.map((k) => (
          <kbd key={k}>{k}</kbd>
        ))}
      </span>
      <span>{children}</span>
    </>
  );
}

/** 每个选项都用它自己的语言书写，看不懂当前语言的人也能找到 */
const LANGS: { id: Lang; label: string }[] = [
  { id: "zh", label: "中文" },
  { id: "en", label: "EN" },
];

export function LangSwitch() {
  const lang = useLang();
  const choose = (l: Lang) => {
    setLang(l);
    // 同步给 Rust 端：托盘菜单、窗口标题、之后产生的提示与错误
    void api.setLanguage(l);
  };
  return (
    <div className="segmented lang-switch" role="group" aria-label="Language / 语言" title="Language / 语言">
      {LANGS.map((l) => (
        <button key={l.id} className={lang === l.id ? "active" : ""} aria-pressed={lang === l.id} onClick={() => choose(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** 复制配置文件的路径（复制不了就什么也不做，路径本身也可以选中复制） */
function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <button
      className={`chip-btn ${done ? "done" : ""}`}
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => {},
        )
      }
    >
      {done ? <IconCheck size={13} /> : <IconCopy size={13} />}
      <span>{t(done ? "menu.copied" : "menu.copy")}</span>
    </button>
  );
}
