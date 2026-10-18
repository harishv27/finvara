import { useId, type ReactNode } from "react";
import { cn } from "./ui";

/**
 * A range slider paired with an exact-value box, for "what if I…?" inputs. Both stay in sync, and the filled
 * track makes the current position readable at a glance.
 */
export function SliderField({ label, value, onChange, min, max, step = 1, format, hint, prefix, suffix, className }: {
  label: ReactNode; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string; hint?: ReactNode; prefix?: string; suffix?: string; className?: string;
}) {
  const id = useId();
  const pct = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Number.isFinite(v) ? v : min)));
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="min-w-0 flex-1 text-xs font-medium leading-snug text-muted">{label}</label>
        <div className="relative w-24 shrink-0">
          {prefix && <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted">{prefix}</span>}
          <input type="number" inputMode="decimal" aria-label={typeof label === "string" ? `${label} (exact value)` : "Exact value"} value={Number.isFinite(value) ? value : ""} step={step} min={min} max={max}
            onFocus={(e) => e.currentTarget.select()} onChange={(e) => e.target.value !== "" && set(Number(e.target.value))}
            className={cn("tabular w-full rounded-lg border border-line bg-surface py-1 text-right text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25", prefix ? "pl-6 pr-2" : "px-2", suffix && "pr-6")} />
          {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted">{suffix}</span>}
        </div>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={(e) => set(Number(e.target.value))}
        aria-valuetext={format ? format(value) : String(value)}
        className="finvara-range w-full cursor-pointer" style={{ ["--fill" as string]: `${pct}%` }} />
      <div className="flex justify-between text-[0.7rem] text-muted"><span>{format ? format(min) : min}</span>{hint && <span className="text-center">{hint}</span>}<span>{format ? format(max) : max}</span></div>
    </div>
  );
}
