// 设置对话框：标签栏的齿轮打开。
//
// * 服务器：中转服务器地址 + 证书指纹（桌面版才有——网页版的服务器就是当前页面的地址）；
//   保存进 config.toml（Windows 安装版经命名管道交给服务写），改完"立即重启"让两个进程都拿到新地址；
// * 通用：界面语言；快捷键说明（网页版没有）；
// * 关于：版本、本机名、配置文件路径（设置和我的设备都在里面）。
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { setLang, useLang, useT, type Lang } from "../lib/i18n";
import { store, useStore } from "../lib/store";
import { IconCheck, IconCopy } from "./Icons";
import { Logo } from "./Logo";

export function SettingsDialog() {
  const t = useT();
  const app = useStore((s) => s.app);
  const web = api.kind === "web";
  const close = () => store.setSettings(false);

  // Esc 关闭
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="set-head">
          <div className="set-head-text">
            <Logo size={26} />
            <h3 id="settings-title">{t("settings.title")}</h3>
          </div>
          <button className="icon-btn subtle" aria-label={t("settings.close")} onClick={close}>
            <span aria-hidden>×</span>
          </button>
        </div>

        {!web && <ServerSection />}

        <div className="set-section">
          <div className="set-title">{t("settings.general")}</div>
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

        <div className="set-section">
          <div className="set-title">{t("settings.about")}</div>
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
