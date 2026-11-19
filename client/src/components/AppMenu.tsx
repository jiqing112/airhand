// 标签栏右侧的两个按钮：
// * 服务器状态（ServerIndicator）：一直写着在线 / 连接中 / 离线，点开是服务器的详情，弹出层就在它下面；
// * 设置（SettingsButton）：打开设置对话框（服务器地址 / 语言 / 快捷键 / 关于）。
import { useCallback, useState } from "react";
import { focusActive } from "../lib/actions";
import { useT } from "../lib/i18n";
import { problemText } from "../lib/messages";
import { serverStatus, useStore } from "../lib/store";
import { IconServer, IconSettings, IconWarn } from "./Icons";
import { Popover } from "./Popover";
import { store } from "../lib/store";

/** 弹出层的开关：关掉后键盘回到远程画面 */
function useMenu() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    focusActive();
  }, []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return { open, close, toggle };
}

// ───────────────────────── 设置 ─────────────────────────

export function SettingsButton() {
  const t = useT();
  return (
    <button
      className="title-btn"
      title={t("menu.title")}
      aria-label={t("menu.title")}
      onClick={() => store.setSettings(true)}
    >
      <IconSettings size={17} />
    </button>
  );
}

// ───────────────────────── 服务器状态 ─────────────────────────

/** 标签栏右侧的服务器状态：一直写着是什么状态；点一下在它下面打开服务器的详情 */
export function ServerIndicator() {
  const t = useT();
  const status = useStore(serverStatus);
  const server = useStore((s) => s.server);
  const app = useStore((s) => s.app);
  const { open, close, toggle } = useMenu();
  const label = t(`server.${server.state}`);
  return (
    <div className="menu-anchor">
      <button
        className={`server-ind ${status} ${server.state === "connecting" ? "trying" : ""} ${open ? "on" : ""}`}
        title={`${t("server.title")} · ${label}${app && server.state === "connected" ? ` · ${app.server}` : ""}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="dot" />
        <span className="server-ind-text">{t(`server.short.${status}`)}</span>
      </button>
      {open && <ServerPanel onClose={close} />}
    </div>
  );
}

function ServerPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const status = useStore(serverStatus);
  const server = useStore((s) => s.server);
  const problem = useStore((s) => s.serverProblem);
  const app = useStore((s) => s.app);
  return (
    <Popover className="server-panel" onClose={onClose}>
      <div className="sp-head">
        <span className={`sp-icon ${status}`}>
          <IconServer size={18} />
        </span>
        <div className="sp-head-text">
          <div className="pop-title">{t("server.title")}</div>
          <div className={`sp-state ${status}`}>
            <span className="dot" />
            {t(`server.${server.state}`)}
          </div>
        </div>
      </div>

      {problem && status !== "connected" && (
        <div className="error-box left" role="alert">
          <IconWarn size={15} />
          <span>
            {problemText(problem)}
            <span className="block sp-retry">{t(server.state === "connecting" ? "server.retrying" : "server.retryLater")}</span>
          </span>
        </div>
      )}

      {app && (
        <div className="sp-field">
          <div className="am-row-line">
            <span className="am-label">{t("server.address")}</span>
            {!app.pinned && (
              <span className="badge warn" title={t("server.unpinnedHint")}>
                {t("server.unpinned")}
              </span>
            )}
          </div>
          <div className="sp-addr mono">{app.server}</div>
          <button className="text-btn" onClick={() => store.setSettings(true)}>
            {t("settings.openSettings")}
          </button>
        </div>
      )}
    </Popover>
  );
}
