import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TooltipSide = "right" | "left" | "top" | "bottom";

export default function Tooltip({ text, side = "right" }: { text: string; side?: TooltipSide }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  const compute = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const gap = 10;

    let top = r.top;
    let left = r.left;

    if (side === "right") {
      top = r.top + r.height / 2;
      left = r.right + gap;
    } else if (side === "left") {
      top = r.top + r.height / 2;
      left = r.left - gap;
    } else if (side === "top") {
      top = r.top - gap;
      left = r.left + r.width / 2;
    } else {
      top = r.bottom + gap;
      left = r.left + r.width / 2;
    }

    setPos({ top, left });
  }, [side]);

  useLayoutEffect(() => {
    if (!open) return;
    compute();
  }, [open, compute]);

  useEffect(() => {
    if (!open) return;
    const onAny = () => compute();
    window.addEventListener("scroll", onAny, true);
    window.addEventListener("resize", onAny);
    return () => {
      window.removeEventListener("scroll", onAny, true);
      window.removeEventListener("resize", onAny);
    };
  }, [open, compute]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="tipIcon"
        aria-label="Подсказка"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>

      {open
        ? createPortal(
            <div className={`tipBubble tip-${side}`} style={{ top: pos.top, left: pos.left }}>
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
