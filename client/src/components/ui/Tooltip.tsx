// 延迟出现的小提示：散落的 title 属性换成它（样式统一、出现有节奏、贴近边缘自动翻转）。
//
// 包着触发元素（包一个 span，不改变布局），悬停或者键盘聚焦后延迟浮出；用 Portal 挂到 body 上，
// 不会被弹出层、overflow 裁掉。说明文字按使用频率折叠的方式之一：不常驻、不打断布局（见 docs/ui.zh-CN.md）。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 悬停多久才出现：太短了到处乱跳，太长了像坏了 */
const DELAY = 400;
/** 和触发元素的距离、离视口边缘多远时翻转 */
const GAP = 8;
const EDGE = 12;

export function Tooltip({
  text,
  children,
  side = "bottom",
}: {
  text: string;
  children: ReactNode;
  /** 优先出现在哪一侧；贴边时自动翻到另一侧 */
  side?: "top" | "bottom";
}) {
  const [pos, setPos] = useState<{ x: number; y: number; side: "top" | "bottom" } | null>(null);
  const timer = useRef<number>(0);
  const anchor = useRef<HTMLSpanElement | null>(null);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const flip = side === "bottom" && window.innerHeight - r.bottom < 64 + EDGE;
      setPos({
        x: r.left + r.width / 2,
        y: flip ? r.top - GAP : r.bottom + GAP,
        side: flip ? "top" : side,
      });
    }, DELAY);
  }, [side]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setPos(null);
  }, []);

  useEffect(() => hide, [hide]);

  return (
    <span
      ref={anchor}
      className="tip-anchor"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onPointerDown={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className={`tip tip-${pos.side}`}
            style={{ left: pos.x, top: pos.y }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
