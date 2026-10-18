import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Bot, CalendarClock, Gauge, Landmark, PiggyBank, Star, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bars, Donut, Legend2, PALETTE, TrendArea } from "../components/charts";
import { Checklist } from "../components/Checklist";
import { PageSkeleton } from "../components/skeletons";
import { Term } from "../components/Term";
import { Badge, Button, Callout, Card, ErrorBox, PageHeader, Progress, Stat, cn } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateLong, dateShort, money, moneyCompact, monthLabel, monthLong, signedMoney, signedPct, tone } from "../lib/format";

const STARTERS = [
  { agent: "personal", q: "Where is my money going this month?" },
  { agent: "investment", q: "Review my portfolio — is it diversified?" },
  { agent: "wealth", q: "Am I on track to retire at 62?" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { data: d, error, refetch, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<any>("/dashboard"), refetchInterval: 30_000 });
  const bills = useQuery({ queryKey: ["budget", "recurring"], queryFn: () => api.get<any>("/budget/recurring") });
  const [range, setRange] = useState<"3M" | "6M" | "1Y">("1Y");
  const nwq = useQuery({ queryKey: ["networth", range], queryFn: () => api.get<any>(`/dashboard/networth?range=${range}`), placeholderData: keepPreviousData });
  if (isLoading) return <PageSkeleton />;
  if (error || !d) return <ErrorBox error={error} onRetry={refetch} />;

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const m = d.month;
  const nw = d.netWorth;
  const cats = m.topCategories.filter((c: any) => c.actual > 0);
  const hist = nwq.data?.points ?? nw.history;
  const change = nwq.data?.change;
  const comp = [{ name: "Cash & savings", value: nw.cash, color: "#0f766e" }, { name: "Investments", value: nw.invested, color: "#4f46e5" }, { name: "Goal funds", value: nw.goals, color: "#d97706" }].filter((c) => c.value > 0);
  const assets = comp.reduce((a, c) => a + c.value, 0);
  const upcoming = (bills.data?.upcoming ?? []).filter((u: any) => u.kind === "expense").slice(0, 5);
  const asOf = new Date(d.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <PageHeader title={`${greet}, ${user?.name.split(" ")[0]}`} subtitle={`Your financial picture for ${monthLong(m.month)} · updated ${asOf}`}
        actions={d.risk.profile ? <Badge tone="brand"><Gauge className="size-3" />{d.risk.profile} investor ({d.risk.score}/5)</Badge> : <Link to="/profile"><Badge tone="warn">Take the risk quiz →</Badge></Link>} />

      <Checklist items={d.checklist} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={<Term k="netWorth" icon={false}>Net worth</Term>} icon={<Landmark className="size-4" />} value={<span title={`$${nw.total.toLocaleString()}`}>{money(nw.total)}</span>}
          sub={nw.change ? <span className={tone(nw.change.amount)}>{signedMoney(nw.change.amount)} ({signedPct(nw.change.pct, 1)}) since {dateShort(nw.change.since)}</span> : `${money(nw.cash)} cash · ${money(nw.invested)} invested · −${money(nw.debt)} debt`} />
        {m.hasSpending ? (
          <Stat label={<Term k="savingsRate" icon={false}>Saved this month</Term>} icon={<PiggyBank className="size-4" />} value={money(m.saved)} tone={m.saved > 0 ? "pos" : "neg"} sub={`${Math.round(m.savingsRate * 100)}% of ${money(m.income)} income`} />
        ) : (
          <Stat label="Saved this month" icon={<PiggyBank className="size-4" />} value="—" sub={<Link to="/budget?add=1" className="font-medium text-brand hover:underline">Record your first transaction →</Link>} />
        )}
        <Stat label="Budget used" icon={<Wallet className="size-4" />} value={`${Math.round(m.budgetUsedPct)}%`}
          sub={<><Progress value={m.budgetUsedPct} tone={m.budgetUsedPct > 100 ? "neg" : m.budgetUsedPct > 85 ? "warn" : "brand"} className="mt-1.5" label="Budget used" /><span className="mt-1 block">{money(m.spent)} of {money(m.plannedExpenses)}</span></>} />
        <Stat label="Investments" icon={d.portfolio.empty || d.portfolio.totalGain >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          value={d.portfolio.empty ? "—" : money(d.portfolio.totalValue)} tone={!d.portfolio.empty && d.portfolio.totalGain < 0 ? "neg" : undefined}
          sub={d.portfolio.empty ? <Link to="/funds" className="font-medium text-brand hover:underline">Browse funds to get started →</Link> : <span className={tone(d.portfolio.totalGain)}>{signedPct(d.portfolio.totalGainPct)} · {d.portfolio.totalGain >= 0 ? "+" : "−"}{money(Math.abs(d.portfolio.totalGain))} all-time</span>} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Net worth over time" subtitle={change ? <span>{signedMoney(change.amount)} ({signedPct(change.pct, 1)}) over this period</span> : "Snapshots are saved each day you visit"}
          action={<div className="inline-flex rounded-lg border border-line p-0.5 text-xs" role="group" aria-label="Range">{(["3M", "6M", "1Y"] as const).map((r) => <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={cn("cursor-pointer rounded-md px-2.5 py-1 font-medium", range === r ? "bg-brand text-white [[data-theme=dark]_&]:text-ink" : "text-muted hover:text-text")}>{r}</button>)}</div>}>
          {hist.length < 3 ? (
            <div className="grid h-52 place-items-center text-center text-sm text-muted"><div><div className="tabular text-3xl font-semibold text-text">{money(nw.total)}</div><p className="mt-1">Your history builds up as you use Finvara.</p></div></div>
          ) : (
            <TrendArea zoom data={hist} xKey="date" height={220} series={[{ key: "total", label: "Net worth", color: "#0f766e" }]} xFmt={(v) => new Date(v + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: range === "3M" ? "numeric" : undefined })} tipFmt={(n) => money(n)} />
          )}
          {assets > 0 && (
            <div className="mt-4"><div className="flex h-2.5 overflow-hidden rounded-full bg-surface2" role="img" aria-label="Asset mix">{comp.map((c) => <div key={c.name} style={{ width: `${(c.value / assets) * 100}%`, background: c.color }} />)}</div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">{comp.map((c) => <span key={c.name} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c.color }} />{c.name} <b className="tabular text-text">{money(c.value)}</b></span>)}{nw.debt > 0 && <span>Debt <b className="tabular text-neg">−{money(nw.debt)}</b></span>}</div></div>
          )}
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card title="Insights">
            <div className="space-y-2.5">
              {m.insights.length === 0 && <p className="py-4 text-center text-sm text-muted">Add transactions to unlock insights.</p>}
              {m.insights.map((i: any) => <Callout key={i.title} tone={i.level === "good" ? "good" : i.level === "danger" ? "danger" : i.level === "warning" ? "warn" : "info"} title={i.title}>{i.detail}</Callout>)}
            </div>
          </Card>
          <Card title="Upcoming bills" subtitle="Detected from your recurring payments" action={<Link to="/budget?tab=recurring" className="text-xs font-medium text-brand hover:underline">All bills</Link>}>
            {upcoming.length === 0 ? <p className="py-4 text-center text-sm text-muted">No bills due in the next 30 days.</p> : (
              <ul className="divide-y divide-line">{upcoming.map((u: any) => (
                <li key={u.name} className="flex items-center gap-3 py-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface2 text-muted"><CalendarClock className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{u.name}</span><span className="block text-xs text-muted">{u.daysUntil <= 0 ? "Due today" : u.daysUntil === 1 ? "Tomorrow" : `In ${u.daysUntil} days`} · {dateShort(u.nextDate)}</span></span>
                  <span className="tabular text-sm font-medium">{money(u.amount, u.amount % 1 ? 2 : 0)}</span>
                </li>))}</ul>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Cash flow" subtitle="Income vs. spending, last 6 months" action={<Link to="/budget" className="text-xs font-medium text-brand hover:underline">Open budget</Link>}>
          <Bars data={d.trend} xKey="month" xFmt={monthLabel} series={[{ key: "income", label: "Income", color: "#0f766e" }, { key: "spent", label: "Spent", color: "#d97706" }]} />
        </Card>
        <Card className="lg:col-span-2" title="Where it went" subtitle="Top spending categories this month">
          {cats.length ? (
            <div className="grid items-center gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Donut data={cats.map((c: any, i: number) => ({ name: c.name, value: c.actual, color: c.color ?? PALETTE[i] }))} height={170} fmt={(n) => money(n)} center={<><span className="text-xs text-muted">Spent</span><span className="tabular text-lg font-semibold">{moneyCompact(m.spent)}</span></>} />
              <Legend2 items={cats.map((c: any, i: number) => ({ name: c.name, color: c.color ?? PALETTE[i], value: money(c.actual) }))} />
            </div>
          ) : <div className="py-8 text-center text-sm text-muted">No spending recorded yet this month.<div className="mt-3"><Link to="/budget?add=1"><Button size="sm" variant="secondary">Add a transaction</Button></Link></div></div>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Goals on the horizon" action={<Link to="/planner" className="text-xs font-medium text-brand hover:underline">Planner</Link>}>
          {d.milestones.length === 0 && d.savingsGoals.length === 0 ? <p className="py-6 text-center text-sm text-muted">No goals yet — <Link to="/planner?new=1" className="text-brand hover:underline">plan your first milestone</Link>.</p> : (
            <ul className="space-y-4">
              {d.milestones.map((g: any) => (
                <li key={g.id}>
                  <div className="flex items-center justify-between gap-2 text-sm"><span className="font-medium">{g.name}</span><span className="flex items-center gap-2"><span className="tabular text-xs text-muted">{money(g.currentSavings)} / {money(g.targetAmount)}</span><Badge tone={g.onTrack ? "pos" : "warn"}>{g.onTrack ? "On track" : `Need ${money(g.requiredMonthly)}/mo`}</Badge></span></div>
                  <Progress value={g.progressPct} className="mt-1.5" tone={g.onTrack ? "pos" : "warn"} label={g.name} />
                  <p className="mt-1 text-xs text-muted">Target {dateLong(g.targetDate)}</p>
                </li>
              ))}
              {d.savingsGoals.map((g: any) => (
                <li key={`s${g.id}`}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{g.name}</span><span className="tabular text-xs text-muted">{money(g.current)} / {money(g.target)}</span></div>
                  <Progress value={(g.current / g.target) * 100} className="mt-1.5" label={g.name} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2" title="Ask an advisor" subtitle="Answers use your real numbers" action={<Bot className="size-4 text-brand" />}>
          <div className="space-y-2">
            {STARTERS.map((s) => (
              <Link key={s.q} to={`/chat?agent=${s.agent}&q=${encodeURIComponent(s.q)}`} className="group flex items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm transition hover:border-brand hover:bg-brand-soft/50">
                <span>{s.q}</span><ArrowUpRight className="size-4 shrink-0 text-muted transition group-hover:text-brand" />
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Your portfolio" action={<Link to="/funds" className="text-xs font-medium text-brand hover:underline">Manage</Link>}>
          {d.portfolio.empty ? <p className="py-6 text-center text-sm text-muted">Nothing invested yet. Browse <Link to="/funds" className="text-brand hover:underline">funds</Link> or <Link to="/stocks" className="text-brand hover:underline">stocks</Link>.</p> : (
            <>
              <div className="overflow-x-auto"><table className="w-full text-sm"><tbody>
                {d.portfolio.holdings.map((h: any) => (
                  <tr key={h.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2"><div className="font-medium">{h.symbol}</div><div className="text-xs text-muted">{h.name}</div></td>
                    <td className="tabular py-2 text-right">{money(h.value)}<div className="text-xs text-muted">{h.weight}%</div></td>
                    <td className={cn("tabular py-2 pl-3 text-right text-xs font-medium", tone(h.gainPct))}>{signedPct(h.gainPct)}</td>
                  </tr>))}
              </tbody></table></div>
              <ul className="mt-3 space-y-1.5 text-sm text-muted">{d.portfolio.findings.map((f: any) => <li key={f.text} className="flex gap-2"><span aria-hidden>{f.level === "good" ? "✅" : f.level === "warning" ? "⚠️" : "ℹ️"}</span>{f.text}</li>)}</ul>
            </>
          )}
        </Card>
        <Card className="lg:col-span-2" title="Picked for you" subtitle="Matched to your risk profile — see why on each page">
          <div className="space-y-3">
            {[...d.picks.funds.map((p: any) => ({ ...p, kind: "Fund", sub: p.category })), ...d.picks.stocks.map((p: any) => ({ ...p, kind: "Stock", sub: p.sector }))].map((p: any) => (
              <Link key={p.kind + p.symbol} to={`${p.kind === "Fund" ? "/funds" : "/stocks"}?open=${p.symbol}`} className="flex items-center gap-3 rounded-lg p-1.5 transition hover:bg-surface2">
                <span className={cn("grid size-9 place-items-center rounded-lg text-xs font-bold", p.kind === "Fund" ? "bg-brand-soft text-brand" : "bg-accent/14 text-accent")}>{p.symbol.slice(0, 2)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted">{p.reason ?? p.sub}</span></span>
                <Badge tone="brand">{p.match}%</Badge>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Market movers" subtitle="Simulated prices, refreshed every few seconds">
        <div className="grid gap-5 sm:grid-cols-3">
          {([["Top gainers", d.movers.gainers], ["Top losers", d.movers.losers]] as const).map(([t, rows]) => (
            <div key={t}><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t}</p>
              {rows.map((s: any) => <Link key={s.symbol} to={`/stocks?open=${s.symbol}`} className="flex items-center justify-between rounded-md px-1 py-1.5 text-sm hover:bg-surface2"><span><b>{s.symbol}</b> <span className="text-xs text-muted">{money(s.price, 2)}</span></span><span className={cn("tabular font-medium", tone(s.changePct))}>{signedPct(s.changePct)}</span></Link>)}
            </div>
          ))}
          <div><p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Star className="size-3" />Watchlist</p>
            {d.watchlist.length === 0 ? <p className="text-sm text-muted">Tap ☆ on a fund or stock to follow it here.</p> : d.watchlist.map((w: any) => <Link key={w.kind + w.symbol} to={`/${w.kind === "fund" ? "funds" : "stocks"}?open=${w.symbol}`} className="flex items-center justify-between rounded-md px-1 py-1.5 text-sm hover:bg-surface2"><b>{w.symbol}</b><span className={cn("tabular font-medium", tone(w.asset.changePct))}>{signedPct(w.asset.changePct)}</span></Link>)}</div>
        </div>
      </Card>
    </div>
  );
}
