import { useQuery } from "@tanstack/react-query";
import { Bot, Calculator, CandlestickChart, Ellipsis, LayoutDashboard, LogOut, Moon, Megaphone, PieChart, Search, ScrollText, ShieldCheck, Sun, Target, UserCog, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { Notifications } from "./Notifications";
import { QuickAdd } from "./QuickAdd";
import { Modal, cn } from "./ui";

const NAV = [
  { group: "Overview", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { group: "Money", items: [
    { to: "/budget", label: "Budget", icon: Wallet },
    { to: "/planner", label: "Planner", icon: Target },
    { to: "/tools", label: "Calculators", icon: Calculator },
    { to: "/will", label: "Will writing", icon: ScrollText },
  ] },
  { group: "Invest", items: [
    { to: "/funds", label: "Mutual funds", icon: PieChart },
    { to: "/stocks", label: "Stocks", icon: CandlestickChart },
  ] },
  { group: "Advice", items: [{ to: "/chat", label: "AI advisors", icon: Bot }] },
];

const TITLES: Record<string, string> = { "/dashboard": "Dashboard", "/budget": "Budget", "/planner": "Planner", "/tools": "Calculators", "/will": "Will writing", "/funds": "Mutual funds", "/stocks": "Stocks", "/chat": "AI advisors", "/profile": "Profile & settings", "/admin": "Admin" };
const BOTTOM = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard }, { to: "/budget", label: "Budget", icon: Wallet },
  { to: "/planner", label: "Plan", icon: Target }, { to: "/chat", label: "Advisors", icon: Bot },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const pub = useQuery({ queryKey: ["public"], queryFn: () => api.get<{ announcement: string }>("/public"), staleTime: 60_000 });
  const groups = user?.role === "admin" ? [...NAV, { group: "Administration", items: [{ to: "/admin", label: "Admin", icon: ShieldCheck }] }] : NAV;

  useEffect(() => { document.title = `${TITLES[loc.pathname] ?? "Finvara"} · Finvara`; }, [loc.pathname]);
  useEffect(() => { setMore(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setPalette(true); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="skip-link">Skip to content</a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block" aria-label="Sidebar">
        <div className="flex h-full flex-col bg-ink text-white/80">
          <div className="flex h-16 items-center px-5"><Logo light /></div>
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3" aria-label="Main">
            {groups.map((g) => (
              <div key={g.group}>
                <p className="px-3 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white/40">{g.group}</p>
                {g.items.map((it) => (
                  <NavLink key={it.to} to={it.to} className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-white/12 text-white" : "hover:bg-white/6 hover:text-white")}>
                    <it.icon className="size-[18px]" aria-hidden />{it.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="border-t border-white/10 p-3">
            <NavLink to="/profile" className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/6", isActive && "bg-white/12")}>
              <span className="grid size-8 place-items-center rounded-full bg-brand text-sm font-semibold text-white">{user?.name.charAt(0).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{user?.name}</span><span className="block truncate text-xs text-white/50">{user?.email}</span></span>
              <UserCog className="size-4 text-white/40" aria-hidden />
            </NavLink>
            <div className="mt-2 flex gap-2">
              <button onClick={toggle} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-white/8" aria-label="Toggle theme">
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}{theme === "dark" ? "Light" : "Dark"}
              </button>
              <button onClick={() => { logout(); nav("/"); }} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-white/8"><LogOut className="size-4" />Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6 lg:px-8">
        <span className="lg:hidden"><Logo size={24} /></span>
        <button onClick={() => setPalette(true)} className="hidden h-9 w-full max-w-sm cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-muted transition hover:border-brand/50 lg:flex" aria-label="Search or jump to…">
          <Search className="size-4" aria-hidden />Search or jump to…<span className="ml-auto flex gap-1"><kbd>⌘</kbd><kbd>K</kbd></span>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setPalette(true)} className="grid size-9 cursor-pointer place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-text lg:hidden" aria-label="Search"><Search className="size-[18px]" /></button>
          <QuickAdd />
          <Notifications />
        </div>
      </header>

      {pub.data?.announcement && (
        <div className="flex items-center gap-2 border-b border-brand/20 bg-brand-soft px-4 py-2 text-sm text-brand"><Megaphone className="size-4 shrink-0" />{pub.data.announcement}</div>
      )}
      <main id="main" tabIndex={-1} key={loc.pathname} className="fade-in mx-auto w-full max-w-[1280px] px-4 pb-28 pt-6 outline-none sm:px-6 lg:px-8 lg:pb-10 lg:pt-8"><Outlet /></main>

      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {BOTTOM.map((b) => (
            <li key={b.to}><NavLink to={b.to} className={({ isActive }) => cn("flex flex-col items-center gap-0.5 py-2 text-[0.68rem] font-medium", isActive ? "text-brand" : "text-muted")}><b.icon className="size-5" aria-hidden />{b.label}</NavLink></li>
          ))}
          <li><button onClick={() => setMore(true)} className="flex w-full cursor-pointer flex-col items-center gap-0.5 py-2 text-[0.68rem] font-medium text-muted" aria-haspopup="dialog"><Ellipsis className="size-5" aria-hidden />More</button></li>
        </ul>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title="More">
        <div className="grid grid-cols-3 gap-2">
          {[{ to: "/funds", label: "Funds", icon: PieChart }, { to: "/stocks", label: "Stocks", icon: CandlestickChart }, { to: "/tools", label: "Calculators", icon: Calculator }, { to: "/will", label: "Will", icon: ScrollText }, { to: "/profile", label: "Profile", icon: UserCog }, ...(user?.role === "admin" ? [{ to: "/admin", label: "Admin", icon: ShieldCheck }] : [])].map((l) => (
            <NavLink key={l.to} to={l.to} className="flex flex-col items-center gap-1.5 rounded-xl border border-line p-3 text-xs font-medium hover:bg-surface2"><l.icon className="size-5 text-brand" aria-hidden />{l.label}</NavLink>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={toggle} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-surface2">{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}{theme === "dark" ? "Light mode" : "Dark mode"}</button>
          <button onClick={() => { logout(); nav("/"); }} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-surface2"><LogOut className="size-4" />Sign out</button>
        </div>
      </Modal>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
