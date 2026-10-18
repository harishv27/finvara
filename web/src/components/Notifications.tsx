import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCircle2, Info, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useDismiss } from "../lib/hooks";
import { cn } from "./ui";

interface Notice { id: string; level: "info" | "warning" | "danger" | "good"; title: string; body: string; link: string }

/** Bell + popover. Alerts are derived server-side from the user's data; dismissals are remembered. */
export function Notifications({ align = "right" }: { align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ notifications: Notice[] }>("/notifications"), refetchInterval: 60_000 });
  const dismiss = useMutation({ mutationFn: (ids: string[]) => api.post("/notifications/dismiss", { ids }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const items = q.data?.notifications ?? [];
  const urgent = items.filter((n) => n.level === "danger" || n.level === "warning").length;

  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications${items.length ? `, ${items.length} unread` : ""}`} aria-expanded={open} aria-haspopup="true"
        className="relative grid size-9 cursor-pointer place-items-center rounded-lg text-muted transition hover:bg-surface2 hover:text-text">
        <Bell className="size-[18px]" />
        {items.length > 0 && <span className={cn("absolute right-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-[0.6rem] font-bold leading-4 text-white", urgent ? "bg-neg" : "bg-brand")}>{items.length}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className={cn("fade-up absolute top-11 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-surface text-text shadow-2xl", align === "left" ? "left-0" : "right-0")}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5"><span className="text-sm font-semibold">Notifications</span>{items.length > 0 && <button className="cursor-pointer text-xs font-medium text-brand hover:underline" onClick={() => dismiss.mutate(items.map((n) => n.id))}>Clear all</button>}</div>
          <ul className="max-h-[26rem] divide-y divide-line overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">You're all caught up ✨</li>}
            {items.map((n) => {
              const Icon = n.level === "good" ? CheckCircle2 : n.level === "info" ? Info : AlertTriangle;
              return (
                <li key={n.id} className="group relative flex gap-3 px-4 py-3 hover:bg-surface2/60">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", n.level === "danger" && "text-neg", n.level === "warning" && "text-warn", n.level === "info" && "text-brand", n.level === "good" && "text-pos")} />
                  <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => { setOpen(false); nav(n.link); }}>
                    <span className="block text-sm font-medium leading-snug">{n.title}</span><span className="mt-0.5 block text-xs text-muted">{n.body}</span>
                  </button>
                  <button aria-label={`Dismiss ${n.title}`} onClick={() => dismiss.mutate([n.id])} className="cursor-pointer self-start rounded p-1 text-muted opacity-60 hover:bg-surface2 hover:opacity-100"><X className="size-3.5" /></button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
