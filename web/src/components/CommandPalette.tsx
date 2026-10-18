import { useQuery } from "@tanstack/react-query";
import { Bot, CandlestickChart, Calculator, CornerDownLeft, FilePlus2, LayoutDashboard, LogOut, Moon, PieChart, Plus, Receipt, ScrollText, Search, ShieldCheck, Target, UserCog, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "./ui";

interface Item { id: string; group: string; label: string; hint?: string; icon: ComponentType<{ className?: string }>; keywords?: string; run: () => void }

/** ⌘K / Ctrl+K: jump to any page, run common actions, or find a fund or stock by name or ticker. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const { toggle } = useTheme();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const funds = useQuery({ enabled: open, queryKey: ["palette", "funds"], queryFn: () => api.get<{ funds: { symbol: string; name: string; category: string }[] }>("/funds?sort=name&dir=asc"), staleTime: 5 * 60_000 });
  const stocks = useQuery({ enabled: open, queryKey: ["palette", "stocks"], queryFn: () => api.get<{ stocks: { symbol: string; name: string; sector: string }[] }>("/stocks?sort=name&dir=asc"), staleTime: 5 * 60_000 });

  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);

  const go = (path: string) => () => { onClose(); nav(path); };
  const base: Item[] = useMemo(() => [
    { id: "p-dash", group: "Go to", label: "Dashboard", icon: LayoutDashboard, keywords: "home overview net worth", run: go("/dashboard") },
    { id: "p-budget", group: "Go to", label: "Budget", icon: Wallet, keywords: "spending transactions categories recurring bills subscriptions reports", run: go("/budget") },
    { id: "p-planner", group: "Go to", label: "Planner", icon: Target, keywords: "goals retirement milestones", run: go("/planner") },
    { id: "p-tools", group: "Go to", label: "Calculators", icon: Calculator, keywords: "sip lumpsum debt payoff loan compound", run: go("/tools") },
    { id: "p-will", group: "Go to", label: "Will writing", icon: ScrollText, keywords: "estate beneficiaries testament", run: go("/will") },
    { id: "p-funds", group: "Go to", label: "Mutual funds", icon: PieChart, keywords: "invest compare portfolio", run: go("/funds") },
    { id: "p-stocks", group: "Go to", label: "Stocks", icon: CandlestickChart, keywords: "invest screener market sectors", run: go("/stocks") },
    { id: "p-chat", group: "Go to", label: "AI advisors", icon: Bot, keywords: "chat assistant ask", run: go("/chat") },
    { id: "p-profile", group: "Go to", label: "Profile & settings", icon: UserCog, keywords: "account risk password", run: go("/profile") },
    ...(user?.role === "admin" ? [{ id: "p-admin", group: "Go to", label: "Admin", icon: ShieldCheck, keywords: "users content settings", run: go("/admin") } as Item] : []),
    { id: "a-tx", group: "Actions", label: "Add a transaction", hint: "Budget", icon: Plus, keywords: "expense income spend record", run: go("/budget?add=1") },
    { id: "a-import", group: "Actions", label: "Import transactions from CSV", hint: "Budget", icon: FilePlus2, keywords: "bank upload statement", run: go("/budget?import=1") },
    { id: "a-goal", group: "Actions", label: "Plan a new goal", hint: "Planner", icon: Target, keywords: "milestone house save", run: go("/planner?new=1") },
    { id: "a-bills", group: "Actions", label: "See recurring bills & subscriptions", hint: "Budget", icon: Receipt, keywords: "netflix upcoming due", run: go("/budget?tab=recurring") },
    { id: "a-ask", group: "Actions", label: "Ask an AI advisor", icon: Bot, keywords: "question help", run: go("/chat") },
    { id: "a-theme", group: "Actions", label: "Toggle light / dark theme", icon: Moon, keywords: "appearance mode", run: () => { toggle(); onClose(); } },
    { id: "a-out", group: "Actions", label: "Sign out", icon: LogOut, run: () => { onClose(); logout(); nav("/"); } },
  ], [user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const score = (hay: string) => { const i = hay.indexOf(t); return i < 0 ? -1 : i === 0 ? 3 : hay.includes(" " + t) ? 2 : 1; };
    if (!t) return base.slice(0, 14);
    const matched = base.map((it) => ({ it, s: score(`${it.label} ${it.keywords ?? ""}`.toLowerCase()) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it);
    const fund = (funds.data?.funds ?? []).map((f) => ({ f, s: score(`${f.symbol} ${f.name} ${f.category}`.toLowerCase()) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5)
      .map(({ f }): Item => ({ id: `f-${f.symbol}`, group: "Mutual funds", label: f.name, hint: f.symbol, icon: PieChart, run: go(`/funds?open=${f.symbol}`) }));
    const stock = (stocks.data?.stocks ?? []).map((x) => ({ x, s: score(`${x.symbol} ${x.name} ${x.sector}`.toLowerCase()) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5)
      .map(({ x }): Item => ({ id: `s-${x.symbol}`, group: "Stocks", label: x.name, hint: x.symbol, icon: CandlestickChart, run: go(`/stocks?open=${x.symbol}`) }));
    return [...matched, ...fund, ...stock];
  }, [q, base, funds.data, stocks.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setActive(0), [q]);
  useEffect(() => { list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };
  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="fade-up w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined} aria-label="Search pages, actions, funds and stocks"
            placeholder="Search pages, actions, funds, stocks…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70" />
          <kbd>Esc</kbd>
        </div>
        <ul ref={list} id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {header && <div className="px-3 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">{header}</div>}
                <div id={`pal-${it.id}`} data-idx={i} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={it.run}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm", i === active ? "bg-brand-soft text-brand" : "hover:bg-surface2")}>
                  <it.icon className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="shrink-0 text-xs text-muted">{it.hint}</span>}
                  {i === active && <CornerDownLeft className="size-3.5 shrink-0 opacity-60" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[0.7rem] text-muted"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span className="ml-auto hidden sm:inline">Tip: press <kbd>/</kbd> anywhere to search</span></div>
      </div>
    </div>, document.body);
}
