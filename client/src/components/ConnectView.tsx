// 新建连接标签：一个输入框连两种目标——6 位控制码（走服务器）或者局域网地址 IP:端口（直连，
// 见 airhand_proto::lan）；下面是"我的设备"（连接过的电脑，保存在 config.toml 里），点一下就连。
//
// 输入的内容放在 store 里（Draft），切到别的标签再回来时还在。
import { useEffect, useRef, useState } from "react";
import { api, type SavedDevice } from "../lib/api";
import { fmtCode, forgetDevice, isLanTarget, openSession, renameDevice, resetDraft, restoreDevice } from "../lib/actions";
import { deviceKey, deviceTitle, matchDevice, relativeTime } from "../lib/devices";
import { getLang, useT } from "../lib/i18n";
import { problemText, sessionStateText } from "../lib/messages";
import { bestCodec } from "../lib/codec";
import { PRESETS, matchPreset, presetDesc, presetName, presetSettings } from "../lib/presets";
import type { RemoteSession } from "../lib/session";
import { store, useSession, useStore } from "../lib/store";

/** 这些问题要用户输入配对码（对方的身份变了也是：重新配对才认新的身份） */
const PAIRING_PROBLEMS = new Set(["pairingRequired", "pairingFailed", "pairingUnavailable", "hostKeyChanged"]);
import { IconBolt, IconCheck, IconClose, IconCopy, IconEye, IconEyeOff, IconMonitor, IconPencil, IconRefresh, IconSearch, IconWarn } from "./Icons";
import { Logo } from "./Logo";

export function ConnectView() {
  const t = useT();
  const draft = useStore((s) => s.draft);
  const server = useStore((s) => s.server);
  const serverProblem = useStore((s) => s.serverProblem);
  const decoders = useStore((s) => s.decoders);
  const devices = useStore((s) => s.devices);
  const app = useStore((s) => s.app);
  const targetInput = useRef<HTMLInputElement | null>(null);
  /** 本机连接密码默认打码（像向日葵 / ToDesk）：点眼睛显示；随机生成后本地先更新 */
  const [showPw, setShowPw] = useState(false);
  const [regenerated, setRegenerated] = useState<string | null>(null);
  /** 本机的控制码（连接后从后端事件流更新） */
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => api.onControlCode(setCode), []);

  // 新建连接标签总是有的时候才显示这一页；万一没有（例如状态不一致），补一个
  useEffect(() => {
    if (!draft) store.newTab();
  }, [draft]);

  const busy = draft?.busy ?? false;
  const error = draft?.error ?? null;

  // 打开这一页时光标就在输入框里
  useEffect(() => {
    targetInput.current?.focus();
  }, []);
  useEffect(() => {
    // 要配对码时光标留在配对码里
    if (!busy && error && !PAIRING_PROBLEMS.has(error.kind)) targetInput.current?.focus();
  }, [busy, error]);

  if (!draft) return null;
  const { target, preset, pairing } = draft;
  // 还不知道对方支持什么：先按本机能解码的选，连上后会按双方都支持的重新选（见 RemoteSession.fitCodec）
  const codec = bestCodec(decoders);
  const value = target.trim();
  // 6 位数字 = 控制码（走服务器）；其余像样的写法 = 局域网直连的地址（端口可以省，连接时补默认端口）
  const lan = isLanTarget(value);
  const codeReady = /^\d{6}$/.test(value) && value[0] !== "0";
  const lanReady = /^[\w.:[\]-]+$/.test(value) && !value.endsWith(":");
  const readyToConnect = lan ? lanReady : codeReady;
  const online = server.state === "connected";
  // 输入的是我的设备里的：告诉用户是哪台
  const known = !lan && codeReady ? devices.find((d) => d.code === value) : undefined;

  // 对方要配对码（或者已经粘贴 / 输入了配对码）：显示配对码一栏
  const pairingProblem = error && PAIRING_PROBLEMS.has(error.kind);
  const showPairing = pairingProblem || pairing.length > 0;
  const pairingReady = /^\d{6}$/.test(pairing);

  /** 一次粘贴了控制码和配对码（12 位）：后面 6 位是配对码 */
  const onPaste = (text: string) => {
    const only = text.replace(/\D/g, "");
    if (only.length === 12) {
      store.patchDraft({ target: only.slice(0, 6), pairing: only.slice(6), error: null });
      return true;
    }
    return false;
  };

  const connect = () => {
    if (!readyToConnect || busy || (!online && !lan)) return;
    void openSession(value, presetSettings(preset, codec), {
      pairing: pairingReady ? pairing : null,
    });
  };

  /** 本机连接密码：设置里改过之后以它为准，否则用后控端发布过来的那个 */
  const localPw = regenerated ?? app?.pairingCode ?? null;

  /** 随机生成新的连接密码：后控端立刻生效，本界面马上显示新的（默认展开给用户核对） */
  const regenerate = () => {
    void api
      .regenerateLanPassword()
      .then((code: string) => {
        setRegenerated(code);
        setShowPw(true);
      })
      .catch(() => {});
  };

  /** 我的设备：用上次的画质连（没记下画质的用默认预设）。局域网直连的设备不用等服务器 */
  const openDevice = (d: SavedDevice) => void openSession(d.code || d.addr || "", d.quality ?? presetSettings(preset, codec));

  return (
    <div className="newtab">
      <div className="nt-wrap">
        <section className="nt-card">
          <div className="nt-head">
            <div className="hero-icon">
              <Logo size={30} />
            </div>
            <h1>{t("connect.title")}</h1>
          </div>

          <div className="nt-field">
            <input
              ref={targetInput}
              className={`nt-target ${error ? "invalid" : ""}`}
              value={target}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("connect.target")}
              disabled={busy}
              aria-label={t("connect.target")}
              onPaste={(e) => {
                if (onPaste(e.clipboardData.getData("text"))) e.preventDefault();
              }}
              onChange={(e) => store.patchDraft({ target: e.target.value, error: null })}
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <div className="nt-under">
              {known && (
                <span className="nt-known">{t("devices.known", { name: deviceTitle(known) })}</span>
              )}
              {target && !busy && (
                <button className="text-btn" onClick={() => (resetDraft(), targetInput.current?.focus())}>
                  {t("connect.clear")}
                </button>
              )}
            </div>
          </div>

          {showPairing && (
            <div className="nt-field">
              <div className="nt-label">
                <span>{t("connect.pairing")}</span>
              </div>
              <input
                className={`pairing-input ${pairingProblem && !pairingReady ? "invalid" : ""}`}
                value={pairing}
                inputMode="numeric"
                autoComplete="off"
                maxLength={7}
                placeholder="000 000"
                disabled={busy}
                aria-label={t("connect.pairing")}
                autoFocus={!!pairingProblem}
                onChange={(e) => store.patchDraft({ pairing: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") connect();
                }}
              />
            </div>
          )}

          <div className="nt-field">
            <div className="segmented presets">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={preset === p.id ? "active" : ""}
                  title={presetDesc(p.id)}
                  onClick={() => store.patchDraft({ preset: p.id })}
                  disabled={busy}
                >
                  {presetName(p.id)}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="error-box" role="alert">
              <IconWarn size={15} />
              <span>{problemText(error)}</span>
            </div>
          )}
          {/* 连不上服务器：说明为什么连接按钮不能点（会自动重试，重试期间也留着） */}
          {!online && serverProblem && (
            <div className="error-box soft" role="status">
              <span className={`dot ${server.state === "connecting" ? "connecting" : "closed"}`} />
              <span>
                {problemText(serverProblem)}
                <span className="muted small block">
                  {t(server.state === "connecting" ? "server.retrying" : "server.retryLater")}
                </span>
              </span>
            </div>
          )}

          <button className="primary-btn" disabled={!readyToConnect || busy || (!online && !lan)} onClick={connect}>
            {busy ? <span className="spinner" /> : <IconBolt size={18} />}
            <span>{busy ? t("connect.busy") : !online && !lan ? t("connect.waitServer") : t("connect.go")}</span>
          </button>
        </section>

        <MyDevices onOpen={openDevice} disabled={busy || (!online && !lan)} />
      </div>

      {app?.lanAddr && (
        <div className="nt-local">
          <div className="nt-local-row">
            <span className="set-title">{t("connect.local")}</span>
            <span className="mono">{app.lanAddr}</span>
            <LocalCopy text={app.lanAddr} />
          </div>
          {localPw && (
            <div className="nt-local-row">
              <span className="set-title">{t("connect.localPw")}</span>
              <span className="mono">{showPw ? localPw : "••••••"}</span>
              <button
                className="icon-btn subtle"
                title={t(showPw ? "connect.localHide" : "connect.localShow")}
                aria-label={t(showPw ? "connect.localHide" : "connect.localShow")}
                onClick={() => setShowPw((v) => !v)}
              >
                {showPw ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              </button>
              <LocalCopy text={localPw} />
              <button
                className="icon-btn subtle"
                title={t("connect.localRandom")}
                aria-label={t("connect.localRandom")}
                disabled={busy}
                onClick={regenerate}
              >
                <IconRefresh size={14} />
              </button>
              <button
                className="icon-btn subtle"
                title={t("connect.localEdit")}
                aria-label={t("connect.localEdit")}
                onClick={() => store.setSettings("lan")}
              >
                <IconPencil size={14} />
              </button>
            </div>
          )}
          {code && (
            <div className="nt-local-row">
              <span className="set-title">{t("connect.localCode")}</span>
              <span className="mono">{code}</span>
              <LocalCopy text={code} />
              <button
                className="icon-btn subtle"
                title={t("connect.localCodeChange")}
                aria-label={t("connect.localCodeChange")}
                disabled={busy}
                onClick={() => void api.changeControlCode().catch(() => {})}
              >
                <IconRefresh size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 本机信息条里的复制按钮：点一下变成对勾，一会儿恢复 */
function LocalCopy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <button
      className={`icon-btn subtle ${done ? "done" : ""}`}
      aria-label="copy"
      onClick={() => void navigator.clipboard?.writeText(text).then(() => setDone(true), () => {})}
    >
      {done ? <IconCheck size={13} /> : <IconCopy size={13} />}
    </button>
  );
}

/** 超过这么多台时显示搜索框 */
const SEARCH_FROM = 7;

/** 我的设备：连接过的电脑，最近连过的在前面。点一下就连；可以重命名、移除（能撤销） */
function MyDevices({ onOpen, disabled }: { onOpen: (d: SavedDevice) => void; disabled: boolean }) {
  const t = useT();
  const devices = useStore((s) => s.devices);
  const saved = useStore((s) => s.devicesSaved);
  const sessions = useStore((s) => s.sessions);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [removed, setRemoved] = useState<SavedDevice | null>(null);

  // 撤销的机会只保留一会儿
  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), 6000);
    return () => clearTimeout(timer);
  }, [removed]);

  if (devices.length === 0 && !removed) {
    // 第一次用：告诉用户连过的电脑会出现在这里
    return saved ? <p className="nt-empty muted small">{t("devices.empty")}</p> : null;
  }
  const open = new Map(sessions.map((s) => [s.code || s.addr || "", s]));
  const shown = devices.filter((d) => matchDevice(d, query));

  return (
    <section className="nt-devices">
      <div className="section-title">
        <span>
          <IconMonitor size={14} />
          {t("devices.title")}
          <span className="count">{devices.length}</span>
        </span>
        {devices.length >= SEARCH_FROM ? (
          <label className="nt-search">
            <IconSearch size={14} />
            <input
              value={query}
              placeholder={t("devices.search")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
          </label>
        ) : null}
      </div>

      {removed && (
        <div className="undo-bar" role="status">
          <span>{t("devices.removed", { name: deviceTitle(removed) })}</span>
          <button
            className="text-btn"
            onClick={() => {
              restoreDevice(removed);
              setRemoved(null);
            }}
          >
            {t("devices.undo")}
          </button>
        </div>
      )}

      <div className="device-list">
        {shown.map((d) => (
          <DeviceItem
            key={deviceKey(d)}
            d={d}
            session={open.get(deviceKey(d))}
            disabled={disabled}
            editing={editing === deviceKey(d)}
            onOpen={() => onOpen(d)}
            onEdit={(on) => setEditing(on ? deviceKey(d) : null)}
            onForget={() => {
              forgetDevice(deviceKey(d));
              setRemoved(d);
            }}
          />
        ))}
      </div>
      {shown.length === 0 && <p className="nt-empty muted small">{t("devices.noMatch")}</p>}
    </section>
  );
}

function DeviceItem({
  d,
  session,
  disabled,
  editing,
  onOpen,
  onEdit,
  onForget,
}: {
  d: SavedDevice;
  /** 已经打开的标签（点一下就切过去） */
  session: RemoteSession | undefined;
  disabled: boolean;
  editing: boolean;
  onOpen: () => void;
  onEdit: (on: boolean) => void;
  onForget: () => void;
}) {
  const t = useT();
  useSession(session);
  const title = deviceTitle(d);
  // 打开着的可以随时切过去；其余的要等服务器连上、没有正在进行的连接
  const off = disabled && !session;
  const status = session
    ? session.state === "live"
      ? t("devices.open")
      : sessionStateText(session)
    : relativeTime(d.lastUsed, Date.now(), getLang() === "zh" ? "zh-CN" : "en");
  const p = d.quality ? matchPreset(d.quality) : null;
  const finish = (value: string | null) => {
    if (value !== null) renameDevice(deviceKey(d), value);
    onEdit(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`device-item ${session ? "open" : ""} ${off ? "disabled" : ""} ${editing ? "editing" : ""}`}
      title={[title !== d.name && d.name, d.os, d.code ? fmtCode(d.code) : d.addr].filter(Boolean).join(" · ")}
      onClick={() => !off && !editing && onOpen()}
      onKeyDown={(e) => e.key === "Enter" && !off && !editing && onOpen()}
    >
      <span className="avatar">{title.slice(0, 1).toUpperCase()}</span>
      <span className="device-meta">
        {editing ? (
          <input
            className="device-rename"
            autoFocus
            defaultValue={title}
            maxLength={60}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") finish(e.currentTarget.value);
              else if (e.key === "Escape") finish(null);
            }}
            onBlur={(e) => finish(e.currentTarget.value)}
          />
        ) : (
          <span className="device-name">{title}</span>
        )}
        <span className="device-sub">
          {session && <span className={`dot ${session.state}`} />}
          {d.code ? fmtCode(d.code) : d.addr}
          {status && ` · ${status}`}
          {!session && d.quality && ` · ${p ? presetName(p) : t("connect.customQuality")}`}
        </span>
      </span>
      {!editing && (
        <span className="device-actions">
          <button
            className="icon-btn subtle"
            title={t("devices.rename")}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(true);
            }}
          >
            <IconPencil size={13} />
          </button>
          <button
            className="icon-btn subtle"
            title={t("devices.forget")}
            onClick={(e) => {
              e.stopPropagation();
              onForget();
            }}
          >
            <IconClose size={13} />
          </button>
        </span>
      )}
    </div>
  );
}
