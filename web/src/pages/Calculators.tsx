import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Landmark, PiggyBank, TrendingUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MultiLine, TrendArea } from "../components/charts";
import { Logo } from "../components/Logo";
import { SliderField } from "../components/Slider";
import { Term } from "../components/Term";
import { Button, Callout, Card, PageHeader, Tabs, cn } from "../components/ui";
import { api } from "../lib/api";
import { useDebounced } from "../lib/hooks";
import { money, moneyCompact } from "../lib/format";

type TabId = "sip" | "lumpsum" | "debt";
const duration = (months: number | null) => (months == null ? "never" : `${Math.floor(months / 12) ? `${Math.floor(months / 12)} yr ` : ""}${months % 12 ? `${months % 12} mo` : ""}`.trim() || "0 mo");

function Result({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" }) {
  return <div className="rounded-xl bg-surface2 p-3.5"><div className="text-xs text-muted">{label}</div><div className={cn("tabular mt-0.5 text-xl font-semibold", tone === "pos" && "text-pos", tone === "neg" && "text-neg")}>{value}</div>{sub && <div className="text-xs text-muted">{sub}</div>}</div>;
}

/** Public, no-login calculators (value first, sign-up later). The same page also lives inside the app. */
export default function Calculators({ standalone = false }: { standalone?: boolean }) {
  const [tab, setTab] = useState<TabId>("sip");
  useEffect(() => { if (standalone) document.title = "Free investment & debt calculators · Finvara"; }, [standalone]);
  const body = (
    <div className="space-y-6">
      {standalone ? (
        <div><h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Free calculators</h1><p className="mt-2 max-w-2xl text-muted">See what a monthly investment could grow into, or how fast extra payments clear a debt. No sign-up, nothing is stored.</p></div>
      ) : <PageHeader title="Calculators" subtitle="Quick what-if tools for investing and debt. Nothing here changes your plan or data." />}
      <Tabs<TabId> value={tab} onChange={setTab} tabs={[{ id: "sip", label: "SIP / monthly investing", icon: <TrendingUp className="size-4" /> }, { id: "lumpsum", label: "Lump sum", icon: <PiggyBank className="size-4" /> }, { id: "debt", label: "Debt payoff", icon: <Landmark className="size-4" /> }]} />
      {tab === "sip" && <Sip />}
      {tab === "lumpsum" && <Lump />}
      {tab === "debt" && <Debt />}
      <p className="text-xs text-muted">Projections use a constant return and are illustrative only — real markets go up and down, and returns are never guaranteed. Not financial advice.</p>
      {standalone && <Card className="bg-brand-soft/50"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">Turn these numbers into a plan</h2><p className="text-sm text-muted">Finvara connects your budget, goals and investments — and shows the chance your plan actually works.</p></div><Link to="/signup"><Button>Create a free account</Button></Link></div></Card>}
    </div>
  );
  if (!standalone) return body;
  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5"><Link to="/"><Logo /></Link><nav className="flex items-center gap-2 text-sm"><Link to="/login" className="px-3 py-2 font-medium hover:text-brand">Sign in</Link><Link to="/signup"><Button size="sm">Get started</Button></Link></nav></header>
      <main className="mx-auto max-w-5xl px-5 pb-16 pt-4">{body}</main>
    </div>
  );
}

function usePost<T>(path: string, body: unknown, ok = true) {
  const d = useDebounced(body, 250);
  return useQuery({ enabled: ok, queryKey: ["calc", path, d], queryFn: () => api.post<T>(path, d), placeholderData: keepPreviousData, retry: false });
}

function Sip() {
  const [f, setF] = useState({ monthly: 500, years: 15, returnPct: 12, stepUpPct: 0 });
  const q = usePost<any>("/calc/sip", f);
  const r = q.data;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2" title="Your investment" subtitle={<>Invest a fixed amount every month (a <Term k="sip">SIP</Term>)</>}>
        <div className="space-y-5">
          <SliderField label="Monthly investment" prefix="$" value={f.monthly} onChange={(v) => setF({ ...f, monthly: v })} min={25} max={10000} step={25} format={money} />
          <SliderField label="Years" suffix="yr" value={f.years} onChange={(v) => setF({ ...f, years: Math.round(v) })} min={1} max={40} format={(v) => `${v} yr`} />
          <SliderField label="Yearly return" suffix="%" value={f.returnPct} onChange={(v) => setF({ ...f, returnPct: v })} min={1} max={20} step={0.5} format={(v) => `${v}%`} hint="Stocks ≈ 7–10% long-run" />
          <SliderField label={<Term k="stepup">Yearly step-up</Term>} suffix="%" value={f.stepUpPct} onChange={(v) => setF({ ...f, stepUpPct: v })} min={0} max={20} step={1} format={(v) => `${v}%`} />
        </div>
      </Card>
      <div className="space-y-6 lg:col-span-3">
        {q.error && <Callout tone="danger" title="Can't calculate">{q.error.message}</Callout>}
        {r && (<>
          <div className="grid gap-3 sm:grid-cols-3"><Result label="You invest" value={moneyCompact(r.invested)} sub={money(r.invested)} /><Result label="Estimated growth" value={moneyCompact(r.gain)} tone="pos" sub={`${Math.round((r.gain / r.futureValue) * 100)}% of the final value`} /><Result label="Future value" value={moneyCompact(r.futureValue)} sub={`${r.multiple}× your money`} /></div>
          <Card title="Growth over time" subtitle="What you put in vs. what it becomes"><TrendArea height={280} data={r.series} xKey="year" xFmt={(y) => `Year ${y}`} series={[{ key: "value", label: "Value", color: "#0f766e" }, { key: "invested", label: "Invested", color: "#64748b", dashed: true }]} /></Card>
        </>)}
      </div>
    </div>
  );
}

function Lump() {
  const [f, setF] = useState({ amount: 10000, years: 10, returnPct: 10 });
  const q = usePost<any>("/calc/lumpsum", f);
  const r = q.data;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2" title="One-time investment" subtitle="Invest once and let it compound">
        <div className="space-y-5">
          <SliderField label="Amount" prefix="$" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} min={500} max={500000} step={500} format={moneyCompact} />
          <SliderField label="Years" suffix="yr" value={f.years} onChange={(v) => setF({ ...f, years: Math.round(v) })} min={1} max={40} format={(v) => `${v} yr`} />
          <SliderField label="Yearly return" suffix="%" value={f.returnPct} onChange={(v) => setF({ ...f, returnPct: v })} min={1} max={20} step={0.5} format={(v) => `${v}%`} />
        </div>
      </Card>
      <div className="space-y-6 lg:col-span-3">
        {q.error && <Callout tone="danger" title="Can't calculate">{q.error.message}</Callout>}
        {r && (<>
          <div className="grid gap-3 sm:grid-cols-3"><Result label="You invest" value={money(r.invested)} /><Result label="Estimated growth" value={moneyCompact(r.gain)} tone="pos" /><Result label="Future value" value={moneyCompact(r.futureValue)} sub={`${r.multiple}× your money`} /></div>
          <Card title="Growth over time"><TrendArea height={280} data={r.series} xKey="year" xFmt={(y) => `Year ${y}`} series={[{ key: "value", label: "Value", color: "#4f46e5" }]} /></Card>
        </>)}
      </div>
    </div>
  );
}

function Debt() {
  const [f, setF] = useState({ balance: 12000, aprPct: 18, payment: 350, extra: 100 });
  const q = usePost<any>("/calc/debt", f);
  const r = q.data;
  const interest = (f.balance * f.aprPct) / 100 / 12;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2" title="Your debt" subtitle="Credit card, car loan, student loan…">
        <div className="space-y-5">
          <SliderField label="Balance owed" prefix="$" value={f.balance} onChange={(v) => setF({ ...f, balance: v })} min={500} max={200000} step={500} format={moneyCompact} />
          <SliderField label="Interest rate (APR)" suffix="%" value={f.aprPct} onChange={(v) => setF({ ...f, aprPct: v })} min={1} max={40} step={0.5} format={(v) => `${v}%`} />
          <SliderField label="Monthly payment" prefix="$" value={f.payment} onChange={(v) => setF({ ...f, payment: v })} min={50} max={5000} step={25} format={money} hint={`Interest alone: ${money(interest)}/mo`} />
          <SliderField label="Extra each month" prefix="$" value={f.extra} onChange={(v) => setF({ ...f, extra: v })} min={0} max={2000} step={25} format={money} />
        </div>
      </Card>
      <div className="space-y-6 lg:col-span-3">
        {q.error && <Callout tone="danger" title="Can't calculate">{q.error.message}</Callout>}
        {r && r.base.months == null && <Callout tone="danger" title="This payment never clears the debt">{money(f.payment)} a month doesn't even cover the {money(interest)} of monthly interest. Pay at least {money(r.minimumToCoverInterest)}, and ideally more.</Callout>}
        {r && (<>
          <div className="grid gap-3 sm:grid-cols-3">
            <Result label="Debt-free in" value={duration(r.base.months)} sub={r.base.totalInterest != null ? `${money(r.base.totalInterest)} interest` : "—"} />
            <Result label={`With +${money(f.extra)}/mo`} value={duration(r.withExtra.months)} sub={r.withExtra.totalInterest != null ? `${money(r.withExtra.totalInterest)} interest` : "—"} />
            <Result label="You save" value={r.interestSaved != null ? money(r.interestSaved) : "—"} tone="pos" sub={r.monthsSaved != null ? `${duration(r.monthsSaved)} sooner` : undefined} />
          </div>
          <Card title="Balance over time" subtitle="Each month's remaining balance"><MultiLine height={280} data={r.series} xKey="month" xFmt={(m) => `${Math.round(m / 12 * 10) / 10}y`} fmt={moneyCompact} series={[{ key: "base", label: "Current payment", color: "#b45309" }, { key: "withExtra", label: `With +${money(f.extra)}/mo`, color: "#0f766e" }]} /></Card>
        </>)}
      </div>
    </div>
  );
}

