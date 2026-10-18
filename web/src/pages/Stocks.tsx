import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, Briefcase, Info, Search, Sparkles, Star, TrendingDown, TrendingUp, PieChart as PieIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Bars } from "../components/charts";
import { AddHoldingModal, AskAI, MatchBadge, PortfolioPanel, PriceChart, RangeTabs, RiskDots, WatchButton } from "../components/invest";
import { Badge, Button, Callout, Card, Empty, ErrorBox, Input, Modal, PageHeader, PageLoader, Select, Tabs, Td, Th, cn } from "../components/ui";
import { TableSkeleton } from "../components/skeletons";
import { Term } from "../components/Term";
import { api } from "../lib/api";
import { money, moneyCompact, pct, signedPct, tone } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import type { Rec, Stock } from "../lib/types";

type TabId = "market" | "sectors" | "recommended" | "watchlist" | "portfolio";

export default function Stocks() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>("market");
  const [sector, setSector] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  // deep links from the dashboard and command palette: /stocks?open=QNTR
  useEffect(() => { const o = params.get("open"); if (o) { setDetail(o.toUpperCase()); setParams({}, { replace: true }); } }, [params, setParams]);
  const [buy, setBuy] = useState<Stock | null>(null);
  const movers = useQuery({ queryKey: ["stocks", "movers"], queryFn: () => api.get<{ gainers: Stock[]; losers: Stock[] }>("/stocks/movers"), refetchInterval: 5000 });
  return (
    <div className="space-y-6">
      <PageHeader title="Stocks" subtitle="Screen the market, follow sectors, and see picks matched to your risk profile. All prices are simulated and tick every few seconds."
        actions={<span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-pos opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-pos" /></span>Simulated live feed</span>} />
      {movers.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {([["Top gainers", movers.data.gainers, TrendingUp], ["Top losers", movers.data.losers, TrendingDown]] as const).map(([title, rows, Icon]) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Icon className="size-3.5" />{title}</p>
              <div className="grid grid-cols-3 gap-2">{rows.slice(0, 3).map((s) => (
                <button key={s.symbol} onClick={() => setDetail(s.symbol)} className="cursor-pointer rounded-lg bg-surface2 p-2 text-left transition hover:ring-2 hover:ring-brand/30">
                  <div className="text-sm font-semibold">{s.symbol}</div><div className="tabular text-xs text-muted">{money(s.price, 2)}</div><div className={cn("tabular text-xs font-semibold", tone(s.changePct))}>{signedPct(s.changePct)}</div>
                </button>))}</div>
            </div>
          ))}
        </div>
      )}
      <Tabs<TabId> value={tab} onChange={setTab} tabs={[
        { id: "market", label: "Screener", icon: <Activity className="size-4" /> }, { id: "sectors", label: "Sectors", icon: <PieIcon className="size-4" /> },
        { id: "recommended", label: "For you", icon: <Sparkles className="size-4" /> }, { id: "watchlist", label: "Watchlist", icon: <Star className="size-4" /> },
        { id: "portfolio", label: "My portfolio", icon: <Briefcase className="size-4" /> },
      ]} />
      {tab === "market" && <Screener sector={sector} setSector={setSector} open={setDetail} />}
      {tab === "sectors" && <Sectors pick={(s) => { setSector(s); setTab("market"); }} />}
      {tab === "recommended" && <Recommended open={setDetail} />}
      {tab === "watchlist" && <WatchlistTab open={setDetail} />}
      {tab === "portfolio" && <PortfolioPanel />}
      <StockDetail symbol={detail} onClose={() => setDetail(null)} onBuy={setBuy} />
      <AddHoldingModal kind="stock" asset={buy ? { symbol: buy.symbol, name: buy.name, price: buy.price } : null} onClose={() => setBuy(null)} />
    </div>
  );
}

const BLANK = { q: "", minDividend: "", maxPe: "", maxBeta: "", minGrowth: "" };
/** Screens most people actually want, one click each. */
const IDEAS: { id: string; label: string; blurb: string; patch: Partial<typeof BLANK> }[] = [
  { id: "all", label: "All stocks", blurb: "Sorted by company size. Use the filters, or pick an idea.", patch: {} },
  { id: "income", label: "Dividend payers", blurb: "Companies paying 3%+ of their share price back each year — a source of income.", patch: { minDividend: "3" } },
  { id: "defensive", label: "Steady & defensive", blurb: "Beta of 0.8 or lower: tends to fall less than the market in a downturn (and rise less in a boom).", patch: { maxBeta: "0.8" } },
  { id: "value", label: "Reasonably priced", blurb: "P/E of 18 or lower: you pay less per dollar of profit. Cheap isn't always good — check why.", patch: { maxPe: "18" } },
  { id: "growth", label: "Fast growers", blurb: "Earnings growing 15%+ a year. Often pricier and more volatile.", patch: { minGrowth: "15" } },
];

function Screener({ sector, setSector, open }: { sector: string; setSector: (s: string) => void; open: (s: string) => void }) {
  const [f, setF] = useState({ ...BLANK, sort: "market_cap_bn", dir: "desc" as "asc" | "desc" });
  const [idea, setIdea] = useState("all");
  const d = useDebounced({ ...f, sector }, 250);
  const qs = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
  const q = useQuery({ queryKey: ["stocks", qs], queryFn: () => api.get<{ stocks: Stock[]; sectors: { sector: string; n: number }[]; asOf: string }>(`/stocks?${qs}`), placeholderData: keepPreviousData, refetchInterval: 5000 });

  // flash cells whose price moved since the last poll
  const prev = useRef<Record<string, number>>({});
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  useEffect(() => {
    if (!q.data) return;
    const next: Record<string, "up" | "down"> = {};
    for (const s of q.data.stocks) { const p = prev.current[s.symbol]; if (p != null && s.price !== p) next[s.symbol] = s.price > p ? "up" : "down"; prev.current[s.symbol] = s.price; }
    if (Object.keys(next).length) { setFlash(next); const t = setTimeout(() => setFlash({}), 900); return () => clearTimeout(t); }
  }, [q.data]);

  const sortBy = (k: string) => setF((p) => ({ ...p, sort: k, dir: p.sort === k && p.dir === "desc" ? "asc" : "desc" }));
  const th = (k: string, label: ReactNode) => <Th className="text-right" onClick={() => sortBy(k)} active={f.sort === k} dir={f.dir}>{label}</Th>;
  const manual = <K extends keyof typeof BLANK>(k: K, v: string) => { setIdea(""); setF({ ...f, [k]: v }); };
  const pick = (id: string, patch: Partial<typeof BLANK>) => { setIdea(id); setF({ ...f, ...BLANK, ...patch }); setSector(""); };
  return (
    <Card pad={false}>
      <div className="border-b border-line px-4 pt-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ideas">{IDEAS.map((i) => <button key={i.id} onClick={() => pick(i.id, i.patch)} aria-pressed={idea === i.id} className={cn("cursor-pointer rounded-full border px-3 py-1 text-sm transition", idea === i.id ? "border-brand bg-brand-soft font-medium text-brand" : "border-line hover:bg-surface2")}>{i.label}</button>)}</div>
        <p className="mt-2.5 flex items-start gap-1.5 pb-3 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{IDEAS.find((i) => i.id === idea)?.blurb ?? "Custom filters."}</p>
      </div>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="relative sm:col-span-2 lg:col-span-3 xl:col-span-2"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input aria-label="Search stocks" className="pl-9" placeholder="Search company or ticker" value={f.q} onChange={(e) => manual("q", e.target.value)} /></div>
        <Select aria-label="Sector" value={sector} onChange={(e) => { setIdea(""); setSector(e.target.value); }}><option value="">All sectors</option>{q.data?.sectors.map((s) => <option key={s.sector} value={s.sector}>{s.sector}</option>)}</Select>
        <Select aria-label="Minimum dividend" value={f.minDividend} onChange={(e) => manual("minDividend", e.target.value)}><option value="">Any yield</option><option value="1">Yield ≥ 1%</option><option value="2">Yield ≥ 2%</option><option value="3">Yield ≥ 3%</option></Select>
        <Select aria-label="Maximum P/E" value={f.maxPe} onChange={(e) => manual("maxPe", e.target.value)}><option value="">Any P/E</option><option value="15">P/E ≤ 15</option><option value="25">P/E ≤ 25</option><option value="35">P/E ≤ 35</option></Select>
        <Select aria-label="Maximum beta" value={f.maxBeta} onChange={(e) => manual("maxBeta", e.target.value)}><option value="">Any beta</option><option value="0.8">Beta ≤ 0.8 (defensive)</option><option value="1.1">Beta ≤ 1.1</option></Select>
      </div>
      {!q.data ? <div className="p-4"><TableSkeleton /></div> : q.data.stocks.length === 0 ? <Empty icon={<Search className="size-6" />} title="No stocks match" body="Try a different idea or loosen a filter." action={<Button size="sm" variant="secondary" onClick={() => pick("all", {})}>Reset filters</Button>} /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[860px]">
          <thead className="border-b border-line"><tr><Th onClick={() => sortBy("name")} active={f.sort === "name"} dir={f.dir}>Company</Th>{th("price", "Price")}{th("changePct", "Today")}{th("return3m", "3M")}{th("return1y", "1Y")}{th("pe", <Term k="pe" icon={false}>P/E</Term>)}{th("dividend_yield", <Term k="dividend" icon={false}>Div</Term>)}{th("beta", <Term k="beta" icon={false}>Beta</Term>)}{th("market_cap_bn", <Term k="marketcap" icon={false}>Mkt cap</Term>)}<Th /></tr></thead>
          <tbody>{q.data.stocks.map((s) => (
            <tr key={s.symbol} onClick={() => open(s.symbol)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface2/60">
              <Td><div className="flex items-center gap-2 font-medium">{s.symbol}{s.featured && <Badge tone="accent">Pick</Badge>}</div><div className="text-xs text-muted">{s.name} · {s.sector}</div></Td>
              <Td className={cn("tabular text-right font-medium transition-colors duration-700", flash[s.symbol] === "up" && "bg-pos/20", flash[s.symbol] === "down" && "bg-neg/20")}>{money(s.price, 2)}</Td>
              <Td className={cn("tabular text-right font-medium", tone(s.changePct))}>{signedPct(s.changePct)}</Td>
              <Td className={cn("tabular text-right", tone(s.return3m))}>{signedPct(s.return3m, 1)}</Td><Td className={cn("tabular text-right", tone(s.return1y))}>{signedPct(s.return1y, 1)}</Td>
              <Td className="tabular text-right">{s.pe.toFixed(1)}</Td><Td className="tabular text-right">{s.dividend_yield ? pct(s.dividend_yield) : "—"}</Td><Td className="tabular text-right">{s.beta.toFixed(2)}</Td>
              <Td className="tabular text-right">{moneyCompact(s.market_cap_bn * 1e9)}</Td>
              <Td className="text-right"><WatchButton kind="stock" symbol={s.symbol} on={s.watchlisted} /></Td>
            </tr>))}</tbody>
        </table></div>
      )}
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{q.data?.stocks.length ?? 0} stocks · simulated prices as of <span className="tabular">{q.data ? new Date(q.data.asOf).toLocaleTimeString("en-US") : "—"}</span>, refreshed every few seconds. Not investment advice; share prices can fall as well as rise.</p>
    </Card>
  );
}

function Sectors({ pick }: { pick: (s: string) => void }) {
  const q = useQuery({ queryKey: ["stocks", "sectors"], queryFn: () => api.get<{ sectors: any[] }>("/stocks/sectors"), refetchInterval: 10_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  const s = q.data!.sectors;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3" title="Sector performance" subtitle="Average trailing 3-month and 1-year return">
        <Bars data={s.map((x) => ({ ...x, name: x.sector.replace("Consumer ", "Cons. ") }))} xKey="name" height={300} fmt={(n) => `${n}%`} series={[{ key: "return3m", label: "3M", color: "#0f766e" }, { key: "return1y", label: "1Y", color: "#4f46e5" }]} />
      </Card>
      <Card pad={false} className="lg:col-span-2" title="Heat map" subtitle="Tap a sector to screen it">
        <ul className="divide-y divide-line">{s.map((x) => (
          <li key={x.sector}><button onClick={() => pick(x.sector)} className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-2.5 text-left text-sm transition hover:bg-surface2/60">
            <span><span className="font-medium">{x.sector}</span><span className="block text-xs text-muted">{x.count} stocks · P/E {x.avgPe} · div {x.avgDividend}%</span></span>
            <span className="text-right"><span className={cn("tabular block rounded-md px-2 py-0.5 text-xs font-semibold", x.return3m >= 0 ? "bg-pos/12 text-pos" : "bg-neg/12 text-neg")}>{signedPct(x.return3m, 1)} 3M</span><span className={cn("tabular text-xs", tone(x.dayChangePct))}>{signedPct(x.dayChangePct)} today</span></span>
          </button></li>))}</ul>
      </Card>
    </div>
  );
}

function Recommended({ open }: { open: (s: string) => void }) {
  const q = useQuery({ queryKey: ["stocks", "recs"], queryFn: () => api.get<{ profile: { riskScore: number; horizonYears: number }; recommendations: Rec<Stock>[] }>("/stocks/recommendations") });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  const { profile, recommendations } = q.data!;
  return (
    <div className="space-y-5">
      <Callout tone="info" title={`Matched to risk ${profile.riskScore}/5 over ${profile.horizonYears} years`}>Single stocks carry company-specific risk — keep any one position to a small share of your portfolio.</Callout>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {recommendations.map((r, i) => (
          <Card key={r.item.symbol} className="flex flex-col">
            <div className="flex items-start justify-between gap-2"><div><span className="text-xs font-semibold text-muted">#{i + 1} · {r.item.sector}</span><h3 className="mt-0.5 font-semibold">{r.item.name} <span className="text-muted">({r.item.symbol})</span></h3></div><MatchBadge match={r.match} /></div>
            <div className="mt-3 flex items-end justify-between"><div className="tabular text-2xl font-semibold">{money(r.item.price, 2)}</div><span className={cn("tabular text-sm font-medium", tone(r.item.changePct))}>{signedPct(r.item.changePct)}</span></div>
            <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-xs">{[["P/E", r.item.pe.toFixed(1)], ["Div", pct(r.item.dividend_yield)], ["Beta", r.item.beta.toFixed(2)], ["EPS ↑", `${r.item.eps_growth}%`]].map(([k, v]) => <div key={k} className="rounded-lg bg-surface2 p-1.5"><div className="text-muted">{k}</div><div className="tabular font-semibold">{v}</div></div>)}</div>
            <ul className="mt-3 flex-1 space-y-1.5 text-sm">{r.reasons.map((x) => <li key={x} className="flex gap-2"><span className="text-pos">✓</span><span className="text-muted">{x}</span></li>)}</ul>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3"><Button size="sm" variant="secondary" onClick={() => open(r.item.symbol)}>View details</Button><WatchButton kind="stock" symbol={r.item.symbol} on={undefined} /></div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function WatchlistTab({ open }: { open: (s: string) => void }) {
  const q = useQuery({ queryKey: ["watchlist"], queryFn: () => api.get<{ items: { kind: string; symbol: string; asset: Stock }[] }>("/watchlist"), refetchInterval: 5000 });
  if (q.isLoading) return <PageLoader />;
  const items = q.data?.items.filter((i) => i.kind === "stock") ?? [];
  if (!items.length) return <Card><Empty icon={<Star className="size-6" />} title="No watched stocks" body="Tap the star next to a stock to follow it." /></Card>;
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(({ asset: s }) => (
    <Card key={s.symbol}><div className="flex items-start justify-between"><div><h3 className="font-semibold">{s.symbol}</h3><p className="text-xs text-muted">{s.name}</p></div><WatchButton kind="stock" symbol={s.symbol} on /></div>
      <div className="mt-3 flex items-end justify-between"><div><div className="tabular text-xl font-semibold">{money(s.price, 2)}</div><div className={cn("text-xs font-medium", tone(s.changePct))}>{signedPct(s.changePct)} today</div></div><Button size="sm" variant="secondary" onClick={() => open(s.symbol)}>Details</Button></div></Card>
  ))}</div>;
}

function StockDetail({ symbol, onClose, onBuy }: { symbol: string | null; onClose: () => void; onBuy: (s: Stock) => void }) {
  const [range, setRange] = useState("1Y");
  useEffect(() => { if (symbol) setRange("1Y"); }, [symbol]);
  const q = useQuery({ enabled: !!symbol, queryKey: ["stock", symbol, range], queryFn: () => api.get<{ stock: Stock; history: { date: string; close: number }[]; peers: Stock[] }>(`/stocks/${symbol}?range=${range}`), placeholderData: keepPreviousData, refetchInterval: 5000 });
  const watch = useQuery({ enabled: !!symbol, queryKey: ["watchlist"], queryFn: () => api.get<{ items: { symbol: string }[] }>("/watchlist") });
  const s = q.data?.stock;
  const pos = s ? ((s.price - s.week52_low) / Math.max(0.01, s.week52_high - s.week52_low)) * 100 : 0;
  return (
    <Modal open={!!symbol} onClose={onClose} wide title={s ? `${s.name} (${s.symbol})` : "Stock"} footer={s && <><AskAI q={`Tell me about ${s.name} (${s.symbol}) — does it fit my profile?`} /><Button onClick={() => { onBuy(s); onClose(); }}>Add to portfolio</Button></>}>
      {!s ? <PageLoader /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="tabular text-3xl font-semibold">{money(s.price, 2)}</div><div className={cn("text-sm font-medium", tone(s.changePct))}>{s.change >= 0 ? "+" : "−"}{money(Math.abs(s.change), 2)} ({signedPct(s.changePct)}) today</div></div>
            <div className="flex items-center gap-2"><Badge tone="brand">{s.sector}</Badge><RiskDots risk={s.beta < 0.7 ? 1 : s.beta < 0.95 ? 2 : s.beta < 1.2 ? 3 : s.beta < 1.5 ? 4 : 5} /><WatchButton kind="stock" symbol={s.symbol} on={watch.data?.items.some((i) => i.symbol === s.symbol)} /></div>
          </div>
          <div><div className="mb-2 flex justify-end"><RangeTabs value={range} onChange={setRange} /></div><PriceChart history={q.data!.history} /></div>
          <div><div className="mb-1 flex justify-between text-xs text-muted"><span>52-week low {money(s.week52_low, 2)}</span><span>high {money(s.week52_high, 2)}</span></div><div className="relative h-2 rounded-full bg-surface2"><span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand" style={{ left: `${Math.max(2, Math.min(98, pos))}%` }} /></div></div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[["Market cap", moneyCompact(s.market_cap_bn * 1e9)], ["P/E ratio", s.pe.toFixed(1)], ["Dividend yield", s.dividend_yield ? pct(s.dividend_yield) : "None"], ["Beta", s.beta.toFixed(2)], ["EPS growth", `${s.eps_growth}% / yr`], ["1M / 3M", `${signedPct(s.return1m, 1)} / ${signedPct(s.return3m, 1)}`], ["1-year", signedPct(s.return1y, 1)], ["Volatility", pct(s.volatility * 100, 0)]].map(([k, v]) => <div key={k} className="rounded-xl bg-surface2 p-3"><dt className="text-xs text-muted">{k}</dt><dd className="tabular mt-1 font-medium">{v}</dd></div>)}
          </dl>
          <p className="text-sm text-muted">{s.description}</p>
          <p className="flex items-start gap-2 rounded-xl bg-surface2 p-3 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />Capital at risk: share prices can fall as well as rise and you may get back less than you put in. Figures are simulated. See what <Term k="pe">P/E</Term>, <Term k="beta">beta</Term> and <Term k="dividend">dividend yield</Term> mean.</p>
          {q.data!.peers.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">Sector peers</h3><div className="flex flex-wrap gap-2">{q.data!.peers.map((p) => <span key={p.symbol} className="rounded-lg border border-line px-2.5 py-1.5 text-xs"><b>{p.symbol}</b> <span className="text-muted">P/E {p.pe.toFixed(1)} · </span><span className={tone(p.changePct)}>{signedPct(p.changePct)}</span></span>)}</div></div>}
        </div>
      )}
    </Modal>
  );
}
