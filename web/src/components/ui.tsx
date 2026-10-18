import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ApiError } from "../lib/api";

export const cn = clsx;

// ------------------------------------------------------------------ Button
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};
export function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer whitespace-nowrap",
        size === "sm" && "px-2.5 py-1.5 text-xs",
        size === "md" && "px-3.5 py-2 text-sm",
        size === "lg" && "px-5 py-3 text-base",
        variant === "primary" && "bg-brand text-white hover:bg-brand-strong [[data-theme=dark]_&]:text-ink",
        variant === "accent" && "bg-accent text-white hover:opacity-90 [[data-theme=dark]_&]:text-ink",
        variant === "secondary" && "border border-line bg-surface text-text hover:bg-surface2",
        variant === "ghost" && "text-muted hover:bg-surface2 hover:text-text",
        variant === "danger" && "bg-neg text-white hover:opacity-90 [[data-theme=dark]_&]:text-ink",
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

// -------------------------------------------------------------------- Card
export function Card({ title, subtitle, action, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {(title || action) && (
        <header className={cn("flex items-start justify-between gap-3", pad ? "px-5 pt-4" : "px-5 pt-4 pb-2")}>
          <div className="min-w-0">
            {title && <h2 className="text-[0.95rem] font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn(pad && "p-5", title && pad && "pt-3")}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Forms
export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <label htmlFor={id} className="block text-xs font-medium text-muted">{label}</label>}
      <FieldCtx.Provider value={id}>{children}</FieldCtx.Provider>
      {error ? <p className="text-xs text-neg" role="alert">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
const FieldCtx = createContext<string | undefined>(undefined);
const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text placeholder:text-muted/60 transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-60";

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  const id = useContext(FieldCtx);
  return <input id={id} {...p} className={cn(inputCls, p.className)} />;
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useContext(FieldCtx);
  return <select id={id} {...p} className={cn(inputCls, "pr-8", p.className)} />;
}
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useContext(FieldCtx);
  return <textarea id={id} {...p} className={cn(inputCls, "min-h-20 resize-y", p.className)} />;
}

/** Number input that keeps a free-form string while typing and reports `number | undefined`. */
export function NumInput({ value, onChange, prefix, suffix, step = "any", min, max, placeholder, className, disabled }: {
  value: number | undefined | null; onChange: (v: number | undefined) => void; prefix?: string; suffix?: string; step?: string; min?: number; max?: number; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const id = useContext(FieldCtx);
  const [text, setText] = useState(value == null ? "" : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current && !(value == null && text === "") && Number(text) !== value) setText(value == null ? "" : String(value));
    last.current = value;
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">{prefix}</span>}
      <input
        id={id} type="number" inputMode="decimal" step={step} min={min} max={max} placeholder={placeholder} disabled={disabled}
        // select the existing value on focus so typing replaces it instead of appending ("65" + "62" → 6562)
        onFocus={(e) => e.currentTarget.select()}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value === "" ? undefined : Number(e.target.value);
          last.current = n;
          onChange(n !== undefined && Number.isFinite(n) ? n : undefined);
        }}
        className={cn(inputCls, prefix && "pl-7", suffix && "pr-9", className)}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{suffix}</span>}
    </div>
  );
}

// ------------------------------------------------------------- Display bits
export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "pos" | "neg" | "warn" | "accent"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
      tone === "neutral" && "bg-surface2 text-muted", tone === "brand" && "bg-brand-soft text-brand",
      tone === "pos" && "bg-pos/12 text-pos", tone === "neg" && "bg-neg/12 text-neg", tone === "warn" && "bg-warn/14 text-warn", tone === "accent" && "bg-accent/14 text-accent", className)}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, icon, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted"><span>{label}</span>{icon}</div>
      <div className={cn("tabular mt-2 text-2xl font-semibold tracking-tight", tone === "pos" && "text-pos", tone === "neg" && "text-neg")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Progress({ value, tone = "brand", className, label }: { value: number; tone?: "brand" | "pos" | "neg" | "warn"; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface2", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-all duration-500", tone === "brand" && "bg-brand", tone === "pos" && "bg-pos", tone === "neg" && "bg-neg", tone === "warn" && "bg-warn")} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; icon?: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface2/60 p-1", className)}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn("flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition", value === t.id ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text")}>
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-brand", className)} aria-label="Loading" />;
}
export const PageLoader = () => <div className="flex h-64 items-center justify-center"><Spinner className="size-7" /></div>;
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("animate-pulse rounded-lg bg-surface2", className)} />;

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {icon && <div className="rounded-full bg-surface2 p-3 text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neg/30 bg-neg/8 p-4 text-sm text-neg" role="alert">
      <AlertTriangle className="size-5 shrink-0" /><span className="flex-1">{msg}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "good" | "warn" | "danger"; title?: ReactNode; children?: ReactNode }) {
  const Icon = tone === "good" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3.5 text-sm",
      tone === "info" && "border-brand/25 bg-brand-soft/60", tone === "good" && "border-pos/30 bg-pos/8",
      tone === "warn" && "border-warn/35 bg-warn/10", tone === "danger" && "border-neg/30 bg-neg/8")}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "info" && "text-brand", tone === "good" && "text-pos", tone === "warn" && "text-warn", tone === "danger" && "text-neg")} />
      <div className="min-w-0"><div className="font-medium">{title}</div>{children && <div className="mt-0.5 text-muted">{children}</div>}</div>
    </div>
  );
}

// ------------------------------------------------------------------- Modal
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  // Portalled to <body> so no transformed/animated ancestor can re-anchor `position: fixed`.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        className={cn("fade-up flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-xl outline-none sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1 text-muted hover:bg-surface2"><X className="size-5" /></button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------ Toasts/Confirm
interface Toast { id: number; tone: "ok" | "err" | "info"; text: string }
const ToastCtx = createContext<{ toast: (text: string, tone?: Toast["tone"]) => void; confirm: (o: { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>; error: (e: unknown) => void }>(null as any);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<{ title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "err" ? 6000 : 3200);
  }, []);
  const error = useCallback((e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong", "err"), [toast]);
  const confirm = useCallback((o: { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }) => new Promise<boolean>((resolve) => setDlg({ ...o, resolve })), []);
  return (
    <ToastCtx.Provider value={{ toast, confirm, error }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("fade-up pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border px-4 py-2.5 text-sm shadow-lg",
            t.tone === "err" ? "border-neg/40 bg-surface text-neg" : "border-line bg-surface text-text")}>
            {t.tone === "ok" ? <CheckCircle2 className="size-4 text-pos" /> : t.tone === "err" ? <AlertTriangle className="size-4" /> : <Info className="size-4 text-brand" />}
            {t.text}
          </div>
        ))}
      </div>
      <Modal open={!!dlg} onClose={() => { dlg?.resolve(false); setDlg(null); }} title={dlg?.title ?? ""}
        footer={<><Button variant="secondary" onClick={() => { dlg?.resolve(false); setDlg(null); }}>Cancel</Button>
          <Button variant={dlg?.danger ? "danger" : "primary"} onClick={() => { dlg?.resolve(true); setDlg(null); }}>{dlg?.confirmLabel ?? "Confirm"}</Button></>}>
        <div className="text-sm text-muted">{dlg?.body}</div>
      </Modal>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ Table
export const Th = ({ children, className, onClick, active, dir }: { children?: ReactNode; className?: string; onClick?: () => void; active?: boolean; dir?: "asc" | "desc" }) => (
  <th onClick={onClick} className={cn("whitespace-nowrap px-3 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-muted", onClick && "cursor-pointer select-none hover:text-text", className)}>
    {children}{active && <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>}
  </th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cn("px-3 py-2.5 text-sm", className)}>{children}</td>;
