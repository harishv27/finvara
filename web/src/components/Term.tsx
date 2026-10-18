import { Info } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY } from "../lib/glossary";
import { cn } from "./ui";

/**
 * Jargon with a plain-language explanation. Works on hover, keyboard focus and tap; the popover is portalled
 * and fixed-positioned so scrolling tables and modals never clip it.
 */
export function Term({ k, children, className, icon = true }: { k: keyof typeof GLOSSARY | string; children?: ReactNode; className?: string; icon?: boolean }) {
  const def = GLOSSARY[k];
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const hide = useCallback(() => setPos(null), []);
  const show = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 170 > window.innerHeight;
    setPos({ x: Math.min(Math.max(12, r.left + r.width / 2 - 140), window.innerWidth - 292), y: above ? r.top - 8 : r.bottom + 8, above });
  }, []);
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); document.removeEventListener("keydown", onKey); };
  }, [pos, hide]);
  if (!def) return <>{children}</>;
  return (
    <>
      <button ref={btn} type="button" aria-describedby={pos ? id : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={(e) => { e.stopPropagation(); pos ? hide() : show(); }}
        className={cn("inline-flex cursor-help items-center gap-1 rounded decoration-dotted decoration-muted/70 underline-offset-4 hover:underline focus-visible:underline", className)}>
        {children ?? def.title}{icon && <Info className="size-3 shrink-0 text-muted/80" aria-hidden />}
        <span className="sr-only"> — {def.title}: {def.body}</span>
      </button>
      {pos && createPortal(
        <div id={id} role="tooltip" style={{ left: pos.x, top: pos.y, transform: pos.above ? "translateY(-100%)" : undefined }}
          className="fade-up pointer-events-none fixed z-[70] w-72 rounded-xl border border-line bg-surface p-3 text-left text-xs font-normal normal-case tracking-normal text-text shadow-xl">
          <div className="mb-0.5 text-[0.8rem] font-semibold">{def.title}</div><div className="leading-relaxed text-muted">{def.body}</div>
        </div>, document.body)}
    </>
  );
}
