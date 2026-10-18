import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { GitCompare, Info, Layers, Plus, Search, Sparkles, Star, Trash2, Briefcase, List } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Donut, Legend2, MultiLine, PALETTE } from "../components/charts";
import { AddHoldingModal, AskAI, MatchBadge, PortfolioPanel, PriceChart, RangeTabs, RiskDots, WatchButton } from "../components/invest";
import { Badge, Button, Callout, Card, Empty, ErrorBox, Field, Input, Modal, NumInput, PageHeader, PageLoader, Select, Tabs, Td, Th, cn, useToast } from "../components/ui";
import { TableSkeleton } from "../components/skeletons";
import { Term } from "../components/Term";
import { api } from "../lib/api";
import { money, pct, signedPct, tone } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import type { Fund, Rec } from "../lib/types";

type TabId = "explore" | "recommended" | "compare" | "builder" | "watchlist" | "portfolio";

/** Curated starting points — most people don't know what to filter by, so offer a few sensible doors. */
const COLLECTIONS: Record<string, { label: string; blurb: string; test: (f: Fund) => boolean }> = {
  all: { label: "All funds", blurb: "Everything we cover. Sort by any column, or pick a collection.", test: () => true },
  starter: { label: "Beginner-friendly", blurb: "Index, target-date and balanced funds: diversified in a single purchase, with few decisions to make.", test: (f) => /Index|Target Date|Balanced/.test(f.category) && f.risk <= 4 },
  cheap: { label: "Low cost", blurb: "Expense ratio of 0.20% or less. Fees compound against you, so cheap is a real edge.", test: (f) => f.expense_ratio <= 0.2 },
  income: { label: "Steady income", blurb: "Dividend, bond and cash-like funds that pay out regularly.", test: (f) => /Dividend|Bond|Money Market/.test(f.category) },
  safe: { label: "Safety first", blurb: "Risk 1–2: smaller swings and smaller upside — suits money you'll need within a few years.", test: (f) => f.risk <= 2 },
  growth: { label: "Growth", blurb: "Risk 4–5: bigger swings for higher potential — best with a 10+ year horizon.", test: (f) => f.risk >= 4 },
  winners: { label: "Top 3-year returns", blurb: "Strongest recent record (12%+ a year). Past performance doesn't predict future results.", test: (f) => f.return_3y >= 12 },
};

export default function Funds() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>("explore");
  const [compare, setCompare] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [buy, setBuy] = useState<Fund | null>(null);
  // deep links from the dashboard and command palette: /funds?open=MRIDX
  useEffect(() => { const o = params.get("open"); if (o) { setDetail(o.toUpperCase()); setParams({}, { replace: true }); } }, [params, setParams]);
  const toggleCompare = (s: string) => setCompare((c) => (c.includes(s) ? c.filter((x) => x !== s) : c.length >= 4 ? c : [...c, s]));
  return (
    <div className="space-y-6">
      <PageHeader title="Mutual funds" subtitle="Research, compare and assemble funds. Recommendations are scored against your risk profile and horizon." />
      <Tabs<TabId> value={tab} onChange={setTab} className="max-w-full" tabs={[
        { id: "explore", label: "Explore", icon: <List className="size-4" /> },
        { id: "recommended", label: "For you", icon: <Sparkles className="size-4" /> },
        { id: "compare", label: <>Compare{compare.length > 0 && <Badge tone="brand">{compare.length}</Badge>}</>, icon: <GitCompare className="size-4" /> },
        { id: "builder", label: "Portfolio builder", icon: <Layers className="size-4" /> },
        { id: "watchlist", label: "Watchlist", icon: <Star className="size-4" /> },
        { id: "portfolio", label: "My portfolio", icon: <Briefcase className="size-4" /> },
      ]} />
      {tab === "explore" && <Explore initialQ={params.get("q") ?? ""} compare={compare} toggleCompare={toggleCompare} open={setDetail} />}
      {tab === "recommended" && <Recommended open={setDetail} />}
      {tab === "compare" && <Compare symbols={compare} setSymbols={setCompare} />}
      {tab === "builder" && <Builder />}
      {tab === "watchlist" && <WatchlistTab open={setDetail} />}
      {tab === "portfolio" && <PortfolioPanel />}
      <FundDetail symbol={detail} onClose={() => setDetail(null)} onBuy={setBuy} />
      <AddHoldingModal kind="fund" asset={buy ? { symbol: buy.symbol, name: buy.name, price: buy.nav } : null} onClose={() => setBuy(null)} />
    </div>
  );
}

// ----------------------------------------------------------------- explore
function Explore({ initialQ, compare, toggleCompare, open }: { initialQ: string; compare: string[]; toggleCompare: (s: string) => void; open: (s: string) => void }) {
  const [f, setF] = useState({ q: initialQ, category: "", maxRisk: "", maxExpense: "", sort: "return_3y", dir: "desc" as "asc" | "desc" });
  const [col, setCol] = useState("all");
  const d = useDebounced(f, 250);
  const qs = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
  const q = useQuery({ queryKey: ["funds", qs], queryFn: () => api.get<{ funds: Fund[]; categories: { category: string; n: number }[] }>(`/funds?${qs}`), placeholderData: keepPreviousData });
  const sortBy = (k: string) => setF((p) => ({ ...p, sort: k, dir: p.sort === k && p.dir === "desc" ? "asc" : "desc" }));
  const th = (k: string, label: ReactNode, right = true) => <Th className={right ? "text-right" : ""} onClick={() => sortBy(k)} active={f.sort === k} dir={f.dir}>{label}</Th>;
  const funds = (q.data?.funds ?? []).filter(COLLECTIONS[col].test);
  return (
    <Card pad={false}>
      <div className="border-b border-line px-4 pt-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Collections">
          {Object.entries(COLLECTIONS).map(([id, c]) => <button key={id} onClick={() => setCol(id)} aria-pressed={col === id} className={cn("cursor-pointer rounded-full border px-3 py-1 text-sm transition", col === id ? "border-brand bg-brand-soft font-medium text-brand" : "border-line hover:bg-surface2")}>{c.label}</button>)}
        </div>
        <p className="mt-2.5 flex items-start gap-1.5 pb-3 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{COLLECTIONS[col].blurb}</p>
      </div>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-3 xl:col-span-2"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input aria-label="Search funds" className="pl-9" placeholder="Search name, symbol or fund house" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <Select aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All categories</option>{q.data?.categories.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.n})</option>)}</Select>
        <Select aria-label="Maximum risk" value={f.maxRisk} onChange={(e) => setF({ ...f, maxRisk: e.target.value })}><option value="">Any risk</option>{[1, 2, 3, 4].map((r) => <option key={r} value={r}>Risk ≤ {r}</option>)}</Select>
        <Select aria-label="Maximum expense ratio" value={f.maxExpense} onChange={(e) => setF({ ...f, maxExpense: e.target.value })}><option value="">Any cost</option><option value="0.1">Expense ≤ 0.10%</option><option value="0.5">Expense ≤ 0.50%</option><option value="1">Expense ≤ 1.00%</option></Select>
      </div>
      {!q.data ? <div className="p-4"><TableSkeleton /></div> : funds.length === 0 ? <Empty icon={<Search className="size-6" />} title="No funds match" body="Try a different collection or loosen a filter." action={<Button size="sm" variant="secondary" onClick={() => { setCol("all"); setF({ ...f, q: "", category: "", maxRisk: "", maxExpense: "" }); }}>Reset filters</Button>} /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
          <thead className="border-b border-line"><tr><Th /><Th onClick={() => sortBy("name")} active={f.sort === "name"} dir={f.dir}>Fund</Th>{th("risk", <Term k="risk" icon={false}>Risk</Term>)}{th("expense_ratio", <Term k="expense" icon={false}>Cost</Term>)}{th("return_1y", "1Y")}{th("return_3y", "3Y / yr")}{th("return_5y", "5Y / yr")}{th("nav", <Term k="nav" icon={false}>NAV</Term>)}<Th /></tr></thead>
          <tbody>{funds.map((x) => (
            <tr key={x.symbol} onClick={() => open(x.symbol)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface2/60">
              <Td className="w-8 pr-0" ><input type="checkbox" aria-label={`Compare ${x.symbol}`} checked={compare.includes(x.symbol)} onClick={(e) => e.stopPropagation()} onChange={() => toggleCompare(x.symbol)} className="size-4 cursor-pointer accent-[var(--c-brand)]" /></Td>
              <Td><div className="flex items-center gap-2 font-medium">{x.name}{x.featured && <Badge tone="accent">Pick</Badge>}</div><div className="text-xs text-muted">{x.symbol} · {x.category} · {x.fund_house}</div></Td>
              <Td className="text-right"><RiskDots risk={x.risk} /></Td>
              <Td className="tabular text-right">{pct(x.expense_ratio, 2)}</Td>
              <Td className={cn("tabular text-right font-medium", tone(x.return_1y))}>{signedPct(x.return_1y, 1)}</Td>
              <Td className="tabular text-right">{pct(x.return_3y)}</Td><Td className="tabular text-right">{pct(x.return_5y)}</Td>
              <Td className="tabular text-right">{money(x.nav, 2)}</Td>
              <Td className="text-right"><WatchButton kind="fund" symbol={x.symbol} on={x.watchlisted} /></Td>
            </tr>))}</tbody>
        </table></div>
      )}
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{funds.length} fund{funds.length === 1 ? "" : "s"} · NAV as of {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Tick up to four to compare side by side. Simulated data; past performance doesn't predict future results — you can lose money.</p>
    </Card>
  );
}

// ------------------------------------------------------------- recommended
function Recommended({ open }: { open: (s: string) => void }) {
  const q = useQuery({ queryKey: ["funds", "recs"], queryFn: () => api.get<{ profile: { riskScore: number; horizonYears: number; goals: string[] }; recommendations: Rec<Fund>[] }>("/funds/recommendations") });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  const { profile, recommendations } = q.data!;
  return (
    <div className="space-y-5">
      <Callout tone="info" title={`Scored for risk ${profile.riskScore}/5 and a ${profile.horizonYears}-year horizon`}>Each <Term k="match">match score</Term> blends risk fit, returns, cost and quality, and every card says why. Retake the risk quiz on your Profile and these re-rank.</Callout>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {recommendations.map((r, i) => (
          <Card key={r.item.symbol} className="flex flex-col">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><span className="text-xs font-semibold text-muted">#{i + 1} · {r.item.category}</span><h3 className="mt-0.5 font-semibold leading-snug">{r.item.name}</h3><p className="text-xs text-muted">{r.item.symbol} · {r.item.fund_house}</p></div><MatchBadge match={r.match} /></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-surface2 p-2"><div className="text-muted">3Y / yr</div><div className="tabular text-sm font-semibold">{pct(r.item.return_3y)}</div></div>
              <div className="rounded-lg bg-surface2 p-2"><div className="text-muted">Cost</div><div className="tabular text-sm font-semibold">{pct(r.item.expense_ratio, 2)}</div></div>
              <div className="rounded-lg bg-surface2 p-2"><div className="text-muted">Risk</div><div className="mt-1.5 flex justify-center"><RiskDots risk={r.item.risk} /></div></div>
            </div>
            <ul className="mt-4 flex-1 space-y-1.5 text-sm">{r.reasons.map((x) => <li key={x} className="flex gap-2"><span className="text-pos">✓</span><span className="text-muted">{x}</span></li>)}</ul>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3"><Button size="sm" variant="secondary" onClick={() => open(r.item.symbol)}>View details</Button><WatchButton kind="fund" symbol={r.item.symbol} on={undefined} /></div>
          </Card>
        ))}
      </div>
      {recommendations.length === 0 && <Card><Empty title="No matches" body="No funds cleared the minimum match score. An admin can lower it." /></Card>}
    </div>
  );
}

// ----------------------------------------------------------------- compare
function Compare({ symbols, setSymbols }: { symbols: string[]; setSymbols: (s: string[]) => void }) {
  const all = useQuery({ queryKey: ["funds", ""], queryFn: () => api.get<{ funds: Fund[] }>("/funds?sort=name&dir=asc") });
  const q = useQuery({ enabled: symbols.length >= 2, queryKey: ["compare", symbols], queryFn: () => api.get<{ funds: Fund[]; performance: any[] }>(`/funds/compare?symbols=${symbols.join(",")}`) });
  type Row = { label: string; render: (f: Fund) => React.ReactNode; num?: (f: Fund) => number; best?: "high" | "low" };
  const rows: Row[] = [
    { label: "Category", render: (f) => f.category }, { label: "Fund house", render: (f) => f.fund_house },
    { label: "Risk", render: (f) => <RiskDots risk={f.risk} />, num: (f) => f.risk, best: "low" },
    { label: "Expense ratio", render: (f) => pct(f.expense_ratio, 2), num: (f) => f.expense_ratio, best: "low" },
    { label: "1-year return", render: (f) => signedPct(f.return_1y, 1), num: (f) => f.return_1y, best: "high" },
    { label: "3-year / yr", render: (f) => pct(f.return_3y), num: (f) => f.return_3y, best: "high" },
    { label: "5-year / yr", render: (f) => pct(f.return_5y), num: (f) => f.return_5y, best: "high" },
    { label: "Volatility (swings)", render: (f) => pct(f.volatility * 100, 0), num: (f) => f.volatility, best: "low" },
    { label: "Risk-adjusted return (Sharpe)", render: (f) => f.sharpe.toFixed(2), num: (f) => f.sharpe, best: "high" },
    { label: "Assets", render: (f) => `$${f.aum_bn}B` }, { label: "Minimum", render: (f) => money(f.min_investment) }, { label: "NAV", render: (f) => money(f.nav, 2) },
  ];
  return (
    <div className="space-y-5">
      <Card title="Choose 2–4 funds" subtitle="You can also tick funds in the Explore tab.">
        <div className="flex flex-wrap items-center gap-2">
          {symbols.map((s) => <Badge key={s} tone="brand" className="!px-2.5 !py-1 !text-xs">{s}<button className="ml-1 cursor-pointer" aria-label={`Remove ${s}`} onClick={() => setSymbols(symbols.filter((x) => x !== s))}>×</button></Badge>)}
          {symbols.length < 4 && <Select aria-label="Add fund to compare" className="!w-64" value="" onChange={(e) => e.target.value && setSymbols([...symbols, e.target.value])}><option value="">+ Add a fund…</option>{all.data?.funds.filter((f) => !symbols.includes(f.symbol)).map((f) => <option key={f.symbol} value={f.symbol}>{f.symbol} — {f.name}</option>)}</Select>}
        </div>
      </Card>
      {symbols.length < 2 ? <Card><Empty icon={<GitCompare className="size-6" />} title="Pick at least two funds" /></Card> : !q.data ? <PageLoader /> : (
        <>
          <Card pad={false} title="Side by side"><div className="overflow-x-auto"><table className="w-full">
            <thead className="border-b border-line"><tr><Th /> {q.data.funds.map((f) => <Th key={f.symbol} className="!normal-case !text-sm !text-text">{f.name}<div className="text-xs font-normal text-muted">{f.symbol}</div></Th>)}</tr></thead>
            <tbody>{rows.map(({ label, render, num, best }) => {
              const vals = num ? q.data!.funds.map(num) : [];
              const target = best === "high" ? Math.max(...vals) : Math.min(...vals);
              return <tr key={label} className="border-b border-line last:border-0"><Td className="text-muted">{label}</Td>{q.data!.funds.map((f) => <Td key={f.symbol} className={cn("tabular", num && best && num(f) === target && vals.filter((v) => v === target).length < vals.length && "font-semibold text-pos")}>{render(f)}</Td>)}</tr>;
            })}</tbody>
          </table></div><p className="px-4 pb-3 text-xs text-muted">Green marks the best value in each row.</p></Card>
          <Card title="Growth of 100" subtitle="Trailing year, each fund rebased to 100">
            <MultiLine data={q.data.performance} xKey="date" series={q.data.funds.map((f, i) => ({ key: f.symbol, label: f.symbol, color: PALETTE[i] }))} fmt={(n) => n.toFixed(0)} xFmt={(d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short" })} />
          </Card>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- builder
const PRESETS: Record<string, { label: string; picks: [string, number][] }> = {
  balanced: { label: "60/40 balanced", picks: [["MRIDX", 6000], ["MRBDX", 4000]] },
  growth: { label: "Growth", picks: [["MRIDX", 4000], ["NWGRX", 3000], ["ORBIX", 2000], ["MRBDX", 1000]] },
  income: { label: "Income", picks: [["VRDVX", 4000], ["MRBDX", 4000], ["VRRIX", 2000]] },
};
function Builder() {
  const qc = useQuery({ queryKey: ["funds", "all"], queryFn: () => api.get<{ funds: Fund[] }>("/funds?sort=name&dir=asc") });
  const { toast, error } = useToast();
  const [picks, setPicks] = useState<{ symbol: string; amount?: number }[]>(PRESETS.balanced.picks.map(([symbol, amount]) => ({ symbol, amount })));
  const [saving, setSaving] = useState(false);
  const body = useDebounced(useMemo(() => ({ picks: picks.filter((p) => p.symbol && p.amount && p.amount > 0).map((p) => ({ symbol: p.symbol, amount: p.amount! })) }), [picks]), 350);
  const blend = useQuery({ enabled: body.picks.length > 0, queryKey: ["blend", body], queryFn: () => api.post<{ blend: any }>("/funds/builder", body), placeholderData: keepPreviousData });
  const b = blend.data?.blend;
  const save = async () => {
    setSaving(true);
    try { for (const p of b.positions) await api.post("/portfolio/holdings", { kind: "fund", symbol: p.symbol, units: p.units }); toast("Saved to your portfolio"); }
    catch (e) { error(e); } finally { setSaving(false); }
  };
  const used = new Set(picks.map((p) => p.symbol));
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2" title="Build a portfolio" subtitle="Allocate an amount to each fund">
        <div className="mb-4 flex flex-wrap gap-2">{Object.entries(PRESETS).map(([k, p]) => <Button key={k} size="sm" variant="secondary" onClick={() => setPicks(p.picks.map(([symbol, amount]) => ({ symbol, amount })))}>{p.label}</Button>)}</div>
        <div className="space-y-3">
          {picks.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_7.5rem_auto] items-end gap-2">
              <Field label={i === 0 ? "Fund" : undefined}><Select aria-label="Fund" value={p.symbol} onChange={(e) => setPicks(picks.map((x, j) => (j === i ? { ...x, symbol: e.target.value } : x)))}><option value="">Choose…</option>{qc.data?.funds.filter((f) => f.symbol === p.symbol || !used.has(f.symbol)).map((f) => <option key={f.symbol} value={f.symbol}>{f.symbol} — {f.name}</option>)}</Select></Field>
              <Field label={i === 0 ? "Amount" : undefined}><NumInput prefix="$" value={p.amount} min={0} onChange={(v) => setPicks(picks.map((x, j) => (j === i ? { ...x, amount: v } : x)))} /></Field>
              <Button variant="ghost" size="sm" aria-label="Remove fund" onClick={() => setPicks(picks.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-3" icon={<Plus className="size-4" />} disabled={picks.length >= 12} onClick={() => setPicks([...picks, { symbol: "" }])}>Add fund</Button>
      </Card>
      <div className="space-y-6 lg:col-span-3">
        {!b ? <Card><Empty icon={<Layers className="size-6" />} title="Add amounts to see your blend" /></Card> : (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              {[["Invested", money(b.total)], ["Expected return", `${b.expectedReturn}% / yr`], ["Avg. risk", `${b.risk} / 5`], ["Annual fees", `${money(b.annualFees, 2)} (${b.expenseRatio}%)`]].map(([k, v]) => <div key={k} className="rounded-2xl border border-line bg-surface p-4"><div className="text-xs text-muted">{k}</div><div className="tabular mt-1 text-lg font-semibold">{v}</div></div>)}
            </div>
            <Card title="Look-through allocation" subtitle="Weighted by amount across the underlying holdings">
              <div className="grid items-center gap-4 sm:grid-cols-2"><Donut data={b.allocation.map((a: any, i: number) => ({ name: a.name, value: a.value, color: PALETTE[i % PALETTE.length] }))} fmt={(n) => `${n.toFixed(1)}%`} height={200} /><Legend2 items={b.allocation.map((a: any, i: number) => ({ name: a.name, color: PALETTE[i % PALETTE.length], value: `${a.value}%` }))} /></div>
            </Card>
            <Card pad={false} title="Positions" action={<Button size="sm" loading={saving} onClick={save}>Save to my portfolio</Button>}>
              <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-line"><tr><Th>Fund</Th><Th className="text-right">Amount</Th><Th className="text-right">Weight</Th><Th className="text-right">Units</Th></tr></thead>
                <tbody>{b.positions.map((p: any) => <tr key={p.symbol} className="border-b border-line last:border-0"><Td><b>{p.symbol}</b> <span className="text-muted">{p.name}</span></Td><Td className="tabular text-right">{money(p.amount)}</Td><Td className="tabular text-right">{p.weight}%</Td><Td className="tabular text-right">{p.units}</Td></tr>)}</tbody></table></div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- watchlist
function WatchlistTab({ open }: { open: (s: string) => void }) {
  const q = useQuery({ queryKey: ["watchlist"], queryFn: () => api.get<{ items: { kind: string; symbol: string; asset: Fund }[] }>("/watchlist") });
  if (q.isLoading) return <PageLoader />;
  const items = q.data?.items.filter((i) => i.kind === "fund") ?? [];
  if (!items.length) return <Card><Empty icon={<Star className="size-6" />} title="No watched funds" body="Tap the star next to a fund to keep an eye on it." /></Card>;
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(({ asset: f }) => (
    <Card key={f.symbol}><div className="flex items-start justify-between"><div><h3 className="font-semibold">{f.name}</h3><p className="text-xs text-muted">{f.symbol} · {f.category}</p></div><WatchButton kind="fund" symbol={f.symbol} on /></div>
      <div className="mt-3 flex items-end justify-between"><div><div className="tabular text-xl font-semibold">{money(f.nav, 2)}</div><div className={cn("text-xs font-medium", tone(f.changePct))}>{signedPct(f.changePct)} today</div></div><Button size="sm" variant="secondary" onClick={() => open(f.symbol)}>Details</Button></div></Card>
  ))}</div>;
}

// ------------------------------------------------------------------ detail
function FundDetail({ symbol, onClose, onBuy }: { symbol: string | null; onClose: () => void; onBuy: (f: Fund) => void }) {
  const [range, setRange] = useState("1Y");
  useEffect(() => { if (symbol) setRange("1Y"); }, [symbol]);
  const q = useQuery({ enabled: !!symbol, queryKey: ["fund", symbol, range], queryFn: () => api.get<{ fund: Fund; history: { date: string; close: number }[]; peers: Fund[] }>(`/funds/${symbol}?range=${range}`), placeholderData: keepPreviousData });
  const f = q.data?.fund;
  const watch = useQuery({ enabled: !!symbol, queryKey: ["watchlist"], queryFn: () => api.get<{ items: { symbol: string }[] }>("/watchlist") });
  return (
    <Modal open={!!symbol} onClose={onClose} wide title={f ? `${f.name} (${f.symbol})` : "Fund"} footer={f && <><AskAI q={`Is ${f.name} (${f.symbol}) a good fit for me?`} /><Button onClick={() => { onBuy(f); onClose(); }}>Add to portfolio</Button></>}>
      {!f ? <PageLoader /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="tabular text-3xl font-semibold">{money(f.nav, 2)}</div><div className={cn("text-sm font-medium", tone(f.changePct))}>{signedPct(f.changePct)} today · {signedPct(f.return1m)} 1M · {signedPct(f.return3m)} 3M</div></div>
            <div className="flex items-center gap-2"><Badge tone="brand">{f.category}</Badge><WatchButton kind="fund" symbol={f.symbol} on={watch.data?.items.some((i) => i.symbol === f.symbol)} /></div>
          </div>
          <div><div className="mb-2 flex justify-end"><RangeTabs value={range} onChange={setRange} /></div><PriceChart history={q.data!.history} /></div>
          <p className="text-sm text-muted">{f.description}</p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[["Risk", <RiskDots key="r" risk={f.risk} />], ["Expense ratio", pct(f.expense_ratio, 2)], ["1Y / 3Y / 5Y", `${f.return_1y}% / ${f.return_3y}% / ${f.return_5y}%`], ["Volatility", pct(f.volatility * 100, 0)], ["Sharpe", f.sharpe.toFixed(2)], ["Assets", `$${f.aum_bn}B`], ["Minimum", money(f.min_investment)], ["Fund house", f.fund_house]].map(([k, v]) => <div key={k as string} className="rounded-xl bg-surface2 p-3"><dt className="text-xs text-muted">{k}</dt><dd className="tabular mt-1 font-medium">{v}</dd></div>)}
          </dl>
          <p className="flex items-start gap-2 rounded-xl bg-surface2 p-3 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />Capital at risk: the value can fall as well as rise. Returns shown are historical and simulated, and are not a guide to the future. Lower fees keep more of your return — see <Term k="expense">expense ratio</Term>, <Term k="sharpe">Sharpe</Term> and <Term k="volatility">volatility</Term>.</p>
          <div className="grid items-center gap-4 sm:grid-cols-2"><div><h3 className="mb-2 text-sm font-semibold">What's inside</h3><Donut data={Object.entries(f.allocation).map(([name, value], i) => ({ name, value, color: PALETTE[i % PALETTE.length] }))} height={170} fmt={(n) => `${n}%`} /></div>
            <Legend2 items={Object.entries(f.allocation).map(([name, v], i) => ({ name, color: PALETTE[i % PALETTE.length], value: `${v}%` }))} /></div>
          {q.data!.peers.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">Similar funds</h3><div className="flex flex-wrap gap-2">{q.data!.peers.map((p) => <span key={p.symbol} className="rounded-lg border border-line px-2.5 py-1.5 text-xs"><b>{p.symbol}</b> <span className="text-muted">{pct(p.expense_ratio, 2)} · {pct(p.return_3y)}/yr</span></span>)}</div></div>}
        </div>
      )}
    </Modal>
  );
}
