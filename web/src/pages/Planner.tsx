import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Home, Landmark, Pencil, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Donut, FanChart, Gauge, Legend2, MultiLine } from "../components/charts";
import { SliderField } from "../components/Slider";
import { Term } from "../components/Term";
import { Badge, Button, Callout, Card, Empty, ErrorBox, Field, Input, Modal, NumInput, PageHeader, Progress, Select, Tabs, cn, useToast } from "../components/ui";
import { PageSkeleton } from "../components/skeletons";
import { api } from "../lib/api";
import { dateLong, money, moneyCompact, pct } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import type { Milestone, Strategy } from "../lib/types";

type TabId = "milestones" | "retirement";
const ICONS = { home: Home, retirement: Landmark, education: GraduationCap, custom: Target } as const;
const PRESETS: Record<string, { name: string; ret: number }> = { home: { name: "Home down payment", ret: 0.05 }, education: { name: "Education fund", ret: 0.06 }, retirement: { name: "Retirement nest egg", ret: 0.07 }, custom: { name: "", ret: 0.06 } };

export default function Planner() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>(params.get("tab") === "retirement" ? "retirement" : "milestones");
  const [openSignal, setOpenSignal] = useState(params.get("new") === "1" ? 1 : 0);
  // deep links (quick add, command palette) must work whether or not the page is already mounted
  useEffect(() => {
    if (params.get("tab") === "retirement") setTab("retirement");
    if (params.get("new") === "1") { setTab("milestones"); setOpenSignal((n) => n + 1); }
    if (params.get("new") || params.get("tab")) setParams({}, { replace: true });
  }, [params, setParams]);
  return (
    <div className="space-y-6">
      <PageHeader title="Financial planner" subtitle="Turn big life milestones into a monthly number, a projection and an investment mix that fits the timeline." />
      <Tabs<TabId> value={tab} onChange={setTab} tabs={[{ id: "milestones", label: "Milestones", icon: <Target className="size-4" /> }, { id: "retirement", label: "Retirement calculator", icon: <Landmark className="size-4" /> }]} />
      {tab === "milestones" ? <Milestones openSignal={openSignal} /> : <Retirement />}
    </div>
  );
}

const allocData = (a: Strategy["allocation"]) => [{ name: "Equity", value: a.equity, color: "#0f766e" }, { name: "Bonds", value: a.bonds, color: "#4f46e5" }, { name: "Cash", value: a.cash, color: "#d97706" }];

// ------------------------------------------------------------- milestones
function Milestones({ openSignal }: { openSignal?: number }) {
  const qc = useQueryClient();
  const { toast, error, confirm } = useToast();
  const q = useQuery({ queryKey: ["milestones"], queryFn: () => api.get<{ milestones: Milestone[] }>("/planner/milestones") });
  const [edit, setEdit] = useState<{ open: boolean; m?: Milestone }>({ open: false });
  useEffect(() => { if (openSignal) setEdit({ open: true }); }, [openSignal]);
  const del = useMutation({ mutationFn: (id: number) => api.del(`/planner/milestones/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["milestones"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast("Milestone deleted"); }, onError: error });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  const ms = q.data!.milestones;

  return (
    <div className="space-y-5">
      <div className="flex justify-end"><Button icon={<Plus className="size-4" />} onClick={() => setEdit({ open: true })}>New milestone</Button></div>
      {ms.length === 0 && <Card><Empty icon={<Target className="size-6" />} title="No milestones yet" body="Plan a home purchase, a college fund or any big goal." action={<Button onClick={() => setEdit({ open: true })}>Create your first</Button>} /></Card>}
      {ms.map((m) => <MilestoneCard key={m.id} m={m} onEdit={() => setEdit({ open: true, m })} onDelete={async () => (await confirm({ title: `Delete “${m.name}”?`, confirmLabel: "Delete", danger: true })) && del.mutate(m.id)} />)}
      <MilestoneModal state={edit} close={() => setEdit({ open: false })} />
    </div>
  );
}

function MilestoneCard({ m, onEdit, onDelete }: { m: Milestone; onEdit: () => void; onDelete: () => void }) {
  const Icon = ICONS[m.type];
  const p = m.plan;
  const series = p.series.map((x) => ({ label: x.label, "Required path": x.balance, "Current pace": x.contributed }));
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" /></span>
          <div><h3 className="font-semibold">{m.name}</h3><p className="text-xs text-muted">Target {money(m.targetAmount)} by {dateLong(m.targetDate)} · {(m.expectedReturn * 100).toFixed(1)}% assumed return</p></div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={p.onTrack ? "pos" : "warn"}>{p.onTrack ? "On track" : `Short ${money(p.shortfall)}`}</Badge>
          <button className="cursor-pointer rounded p-1.5 text-muted hover:bg-surface2" onClick={onEdit} aria-label="Edit"><Pencil className="size-4" /></button>
          <button className="cursor-pointer rounded p-1.5 text-muted hover:bg-neg/10 hover:text-neg" onClick={onDelete} aria-label="Delete"><Trash2 className="size-4" /></button>
        </div>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <div><div className="mb-1 flex justify-between text-xs text-muted"><span>Saved so far</span><span className="tabular">{money(m.currentSavings)} · {pct(p.progressPct, 0)}</span></div><Progress value={p.progressPct} tone={p.onTrack ? "pos" : "brand"} label={m.name} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface2 p-3"><div className="text-xs text-muted">Needed per month</div><div className="tabular mt-0.5 text-xl font-semibold">{money(p.requiredMonthly)}</div></div>
            <div className="rounded-xl bg-surface2 p-3"><div className="text-xs text-muted">You save now</div><div className={cn("tabular mt-0.5 text-xl font-semibold", p.currentMonthly < p.requiredMonthly ? "text-warn" : "text-pos")}>{money(p.currentMonthly)}</div></div>
          </div>
          <p className="text-sm text-muted">At your current pace you'd have <b className="text-text">{money(p.projectedAtDeadline)}</b> by the deadline{p.onTrack ? "." : <>, <b className="text-warn">{money(p.shortfall)}</b> short. Increase saving by <b className="text-text">{money(Math.max(0, p.requiredMonthly - p.currentMonthly))}/month</b> to close the gap.</>}</p>
          <ul className="space-y-1 text-xs text-muted">{p.milestones.map((x) => <li key={x.pct} className="flex justify-between"><span>{x.pct}% · {money(x.amount)}</span><span>{x.approxMonth != null ? `~month ${x.approxMonth}` : "—"}</span></li>)}</ul>
        </div>
        <div className="lg:col-span-3">
          <MultiLine data={series} xKey="label" height={210} fmt={moneyCompact} series={[{ key: "Required path", label: "Required path", color: "#0f766e" }, { key: "Current pace", label: "At current pace", color: "#d97706", dashed: true }]} />
        </div>
      </div>
      <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
        <div className="flex items-center gap-4">
          <div className="w-28 shrink-0"><Donut data={allocData(m.strategy.allocation)} height={110} fmt={(n) => `${n}%`} /></div>
          <div className="min-w-0"><p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="size-4 text-accent" />Suggested mix</p><p className="mt-1 text-xs text-muted">{m.strategy.summary}</p></div>
        </div>
        <div><p className="mb-1.5 text-sm font-medium">Funds that fit this timeline</p>
          <div className="flex flex-wrap gap-2">{m.suggestedFunds.map((f) => <Link key={f.symbol} to={`/funds?q=${f.symbol}`} className="rounded-lg border border-line px-2.5 py-1.5 text-xs transition hover:border-brand hover:bg-brand-soft/50"><b>{f.symbol}</b> <span className="text-muted">{f.category} · {f.match}% match</span></Link>)}</div></div>
      </div>
    </Card>
  );
}

function MilestoneModal({ state, close }: { state: { open: boolean; m?: Milestone }; close: () => void }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const m = state.m;
  const blank = { type: "home" as Milestone["type"], name: PRESETS.home.name, targetAmount: undefined as number | undefined, currentSavings: 0 as number | undefined, monthlyContribution: 0 as number | undefined, targetDate: `${new Date().getFullYear() + 5}-06-01`, expectedReturn: 5 };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (state.open) setF(m ? { type: m.type, name: m.name, targetAmount: m.targetAmount, currentSavings: m.currentSavings, monthlyContribution: m.monthlyContribution, targetDate: m.targetDate, expectedReturn: +(m.expectedReturn * 100).toFixed(2) } : blank);
  }, [state.open, m?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = { type: f.type, name: f.name, targetAmount: f.targetAmount, currentSavings: f.currentSavings ?? 0, monthlyContribution: f.monthlyContribution ?? 0, targetDate: f.targetDate, expectedReturn: f.expectedReturn / 100 };
  const dbody = useDebounced(body, 400);
  const ready = !!dbody.targetAmount && dbody.targetAmount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dbody.targetDate);
  const preview = useQuery({ enabled: state.open && ready, queryKey: ["plan-preview", dbody], queryFn: () => api.post<{ plan: Milestone["plan"]; strategy: Strategy }>("/planner/preview", dbody), placeholderData: keepPreviousData, retry: false });
  const save = useMutation({
    mutationFn: () => (m ? api.put(`/planner/milestones/${m.id}`, body) : api.post("/planner/milestones", body)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["milestones"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast("Milestone saved"); close(); }, onError: error,
  });
  const p = preview.data?.plan;
  return (
    <Modal open={state.open} onClose={close} wide title={m ? "Edit milestone" : "New milestone"} footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={save.isPending} disabled={!f.name.trim() || !f.targetAmount} onClick={() => save.mutate()}>Save milestone</Button></>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Type"><Select value={f.type} onChange={(e) => { const t = e.target.value as Milestone["type"]; setF({ ...f, type: t, name: !m && (!f.name || Object.values(PRESETS).some((x) => x.name === f.name)) ? PRESETS[t].name : f.name, expectedReturn: PRESETS[t].ret * 100 }); }}>
            <option value="home">Buy a home</option><option value="education">Education</option><option value="retirement">Retirement</option><option value="custom">Something else</option></Select></Field>
          <Field label="Name"><Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target amount"><NumInput prefix="$" value={f.targetAmount} onChange={(v) => setF({ ...f, targetAmount: v })} min={0} /></Field>
            <Field label="Target date"><Input type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></Field>
            <Field label="Saved so far"><NumInput prefix="$" value={f.currentSavings} onChange={(v) => setF({ ...f, currentSavings: v })} min={0} /></Field>
          </div>
          <SliderField label="Saving per month" prefix="$" value={f.monthlyContribution ?? 0} onChange={(v) => setF({ ...f, monthlyContribution: v })} min={0} max={Math.max(3000, Math.ceil(((preview.data?.plan.requiredMonthly ?? 0) * 2) / 100) * 100)} step={25}
            format={(v) => money(v)} hint={preview.data ? `Needed: ${money(preview.data.plan.requiredMonthly)}` : undefined} />
          <Field label="Expected annual return" hint="0–20%. Cash ≈ 3–4%, balanced ≈ 5–6%, equity-heavy ≈ 7–8%."><NumInput suffix="%" value={f.expectedReturn} onChange={(v) => setF({ ...f, expectedReturn: v ?? 0 })} min={0} max={20} step="0.1" /></Field>
        </div>
        <div className="rounded-xl bg-surface2/70 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Live preview</p>
          {preview.error ? <Callout tone="danger" title="Can't preview this plan">{preview.error.message}</Callout> : !p ? <p className="py-10 text-center text-sm text-muted">Enter a target amount and date to see the plan.</p> : (
            <div className="space-y-3">
              <div><div className="text-xs text-muted">You need to save</div><div className="tabular text-3xl font-semibold">{money(p.requiredMonthly)}<span className="text-sm font-normal text-muted"> /month</span></div><div className="text-xs text-muted">for {p.months} months</div></div>
              <Callout tone={p.onTrack ? "good" : "warn"} title={p.onTrack ? "You're on track" : `You'd fall ${money(p.shortfall)} short`}>At {money(p.currentMonthly)}/month you'd reach {money(p.projectedAtDeadline)}.</Callout>
              {preview.data && <p className="text-xs text-muted"><b className="text-text">Suggested mix:</b> {preview.data.strategy.summary}</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------- retirement
interface RetForm { age: number; retirementAge: number; lifeExpectancy: number; currentSavings: number; monthlyContribution: number; desiredMonthlyIncomeToday: number; otherIncomeToday: number; inflation: number; preReturn: number; postReturn: number }
const toBody = (f: RetForm) => ({ ...f, inflation: f.inflation / 100, preReturn: f.preReturn / 100, postReturn: f.postReturn / 100 });
const verdict = (p: number) => (p >= 0.85 ? { label: "Strong", color: "#15803d", tone: "good" as const, text: "Your plan holds up in most market conditions." } : p >= 0.7 ? { label: "Reasonable", color: "#0f766e", tone: "good" as const, text: "Solid, with some room to strengthen it." } : p >= 0.5 ? { label: "At risk", color: "#b45309", tone: "warn" as const, text: "Roughly a coin-flip in bad markets — worth acting on." } : { label: "Unlikely", color: "#b91c1c", tone: "danger" as const, text: "Under current assumptions the money probably runs out early." });

function Retirement() {
  const defaults = useQuery({ queryKey: ["planner", "defaults"], queryFn: () => api.get<{ age: number; retirementAge: number; currentSavings: number; monthlyContribution: number; desiredMonthlyIncomeToday: number; basis: string }>("/planner/defaults"), staleTime: 60_000 });
  const [f, setF] = useState<RetForm | null>(null);
  const [adv, setAdv] = useState(false);
  useEffect(() => {
    const p = defaults.data;
    if (p && !f) setF({ age: p.age, retirementAge: p.retirementAge, lifeExpectancy: 90, currentSavings: p.currentSavings, monthlyContribution: p.monthlyContribution, desiredMonthlyIncomeToday: p.desiredMonthlyIncomeToday, otherIncomeToday: 0, inflation: 3, preReturn: 7, postReturn: 5 });
  }, [defaults.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = useDebounced(f, 350);
  const valid = !!d && d.age >= 16 && d.retirementAge > d.age && d.lifeExpectancy > d.retirementAge;
  const res = useQuery({ enabled: valid, queryKey: ["retirement", d], queryFn: () => api.post<any>("/planner/retirement", toBody(d!)), placeholderData: keepPreviousData, retry: false });

  // "What would improve my odds?" — re-run the plan with one lever changed at a time
  const levers = d ? [
    { id: "save", label: "Save $200 more a month", f: { ...d, monthlyContribution: d.monthlyContribution + 200 } },
    { id: "later", label: "Retire 2 years later", f: { ...d, retirementAge: Math.min(d.lifeExpectancy - 1, d.retirementAge + 2) } },
    { id: "spend", label: "Spend 10% less in retirement", f: { ...d, desiredMonthlyIncomeToday: Math.round(d.desiredMonthlyIncomeToday * 0.9) } },
  ] : [];
  const lev = useQueries({ queries: levers.map((l) => ({ enabled: valid && !!res.data, queryKey: ["retirement", l.f], queryFn: () => api.post<any>("/planner/retirement", toBody(l.f)), retry: false, staleTime: 60_000 })) });

  if (!f) return <PageSkeleton />;
  const set = <K extends keyof RetForm>(k: K) => (v: number | undefined) => setF({ ...f, [k]: v ?? 0 });
  const r = res.data?.plan;
  const mc = res.data?.monteCarlo;
  const v = mc ? verdict(mc.successProbability) : null;
  const sliderMax = Math.max(5000, Math.ceil((f.monthlyContribution * 3) / 500) * 500);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Your plan" subtitle={`Starts from ${defaults.data?.basis ?? "your data"} — drag a slider and results update instantly`} className="lg:sticky lg:top-20 lg:col-span-1 lg:self-start">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Your age"><NumInput value={f.age} onChange={set("age")} step="1" min={16} max={90} /></Field>
            <Field label="Saved so far"><NumInput prefix="$" value={f.currentSavings} onChange={set("currentSavings")} min={0} /></Field>
          </div>
          <SliderField label="Retire at age" value={f.retirementAge} onChange={set("retirementAge")} min={Math.max(f.age + 1, 40)} max={80} format={(x) => `${x}`} />
          <SliderField label="Save each month" prefix="$" value={f.monthlyContribution} onChange={set("monthlyContribution")} min={0} max={sliderMax} step={50} format={(x) => money(x)} />
          <SliderField label="Income wanted in retirement (per month, today's $)" prefix="$" value={f.desiredMonthlyIncomeToday} onChange={set("desiredMonthlyIncomeToday")} min={500} max={Math.max(15000, f.desiredMonthlyIncomeToday)} step={100} format={(x) => money(x)} />
          <button className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-surface2" onClick={() => setAdv(!adv)} aria-expanded={adv}>Advanced assumptions<span className="text-muted">{adv ? "Hide" : "Show"}</span></button>
          {adv && (
            <div className="space-y-4 rounded-xl bg-surface2/60 p-3">
              <Field label="Plan to age"><NumInput value={f.lifeExpectancy} onChange={set("lifeExpectancy")} step="1" min={60} max={110} /></Field>
              <Field label="Pension / Social Security" hint="Per month, today's dollars"><NumInput prefix="$" value={f.otherIncomeToday} onChange={set("otherIncomeToday")} min={0} /></Field>
              <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Rates (0–20% a year)</p>
              <Field label={<Term k="inflation">Inflation</Term>}><NumInput suffix="%" value={f.inflation} onChange={set("inflation")} step="0.1" min={0} max={20} /></Field>
              <Field label="Return before retirement"><NumInput suffix="%" value={f.preReturn} onChange={set("preReturn")} step="0.1" min={0} max={20} /></Field>
              <Field label="Return after retirement"><NumInput suffix="%" value={f.postReturn} onChange={set("postReturn")} step="0.1" min={0} max={20} /></Field>
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-6 lg:col-span-2">
        {!valid && <Callout tone="warn" title="Check your ages">Retirement age must be above your current age, and your planning age above retirement age.</Callout>}
        {res.error && <Callout tone="danger" title="Can't calculate with these assumptions">{res.error.message}</Callout>}
        {r && mc && v && !res.error && (
          <>
            <Card>
              <div className="flex flex-wrap items-center gap-6">
                <Gauge value={mc.successProbability * 100} color={v.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><Badge tone={v.tone === "good" ? "pos" : v.tone === "warn" ? "warn" : "neg"}>{v.label}</Badge><span className="text-xs text-muted"><Term k="montecarlo">How is this calculated?</Term></span></div>
                  <h2 className="mt-1.5 text-lg font-semibold leading-snug">{v.text}</h2>
                  <p className="mt-1 text-sm text-muted">Across {mc.runs.toLocaleString()} simulated market histories, your money lasts to age {f.lifeExpectancy} in <b className="text-text">{Math.round(mc.successProbability * 100)}%</b> of them.{mc.medianDepletionAge && <> When it doesn't, it typically runs out around age <b className="text-text">{mc.medianDepletionAge}</b>.</>}</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[["Saved by retirement", moneyCompact(r.projectedCorpus), `Average markets · typical case ${moneyCompact(mc.atRetirement.p50)}`], ["Target pot", moneyCompact(r.corpusNeeded), `Needed for ${money(r.inflatedMonthlyNeed)}/mo at retirement`], [r.onTrack ? "Cushion" : "Shortfall", moneyCompact(Math.abs(r.projectedCorpus - r.corpusNeeded)), r.onTrack ? "Above target if markets are average — a cushion for bad years" : `Save +${money(r.extraMonthlyNeeded)}/mo to close it`]].map(([k, val, sub], i) => (
                  <div key={k} className="rounded-xl bg-surface2 p-3"><div className="text-xs text-muted">{k}</div><div className={cn("tabular mt-0.5 text-xl font-semibold", i === 2 && (r.onTrack ? "text-pos" : "text-neg"))}>{val}</div><div className="text-xs text-muted">{sub}</div></div>))}
              </div>
            </Card>

            <Card title="What would improve your odds?" subtitle="Each change is tested on its own against your current plan">
              <ul className="grid gap-3 sm:grid-cols-3">
                {levers.map((l, i) => {
                  const p = lev[i]?.data?.monteCarlo?.successProbability as number | undefined;
                  const delta = p == null ? null : Math.round((p - mc.successProbability) * 100);
                  return (
                    <li key={l.id}><button onClick={() => setF({ ...f, retirementAge: l.f.retirementAge, monthlyContribution: l.f.monthlyContribution, desiredMonthlyIncomeToday: l.f.desiredMonthlyIncomeToday })} className="w-full cursor-pointer rounded-xl border border-line p-3 text-left transition hover:border-brand hover:bg-brand-soft/40">
                      <div className="text-sm font-medium">{l.label}</div>
                      <div className="mt-1 flex items-baseline gap-2"><span className="tabular text-xl font-semibold">{p == null ? "…" : `${Math.round(p * 100)}%`}</span>{delta != null && <span className={cn("tabular text-xs font-semibold", delta > 0 ? "text-pos" : delta < 0 ? "text-neg" : "text-muted")}>{delta > 0 ? "+" : ""}{delta} pts</span>}</div>
                      <div className="mt-1 text-xs text-brand">Apply this change →</div></button></li>);
                })}
              </ul>
            </Card>

            <Card title="Range of outcomes" subtitle={<>Your balance through retirement across simulations · <Term k="p10p90">what does the band mean?</Term></>}>
              <FanChart data={mc.bands} retireAge={f.retirementAge} height={300} />
              <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
                {[["Poor markets", mc.atRetirement.p10], ["Typical", mc.atRetirement.p50], ["Good markets", mc.atRetirement.p90]].map(([k, val]) => <div key={k as string} className="rounded-xl bg-surface2 p-2.5"><div className="text-xs text-muted">{k} at retirement</div><div className="tabular text-lg font-semibold">{moneyCompact(val as number)}</div></div>)}
              </div>
              <p className="mt-3 text-xs text-muted">Simulation assumes {Math.round(mc.assumptions.preVolatility * 100)}% yearly volatility before retirement and {Math.round(mc.assumptions.postVolatility * 100)}% after, matched to your suggested asset mix. Illustrative — not a guarantee.</p>
            </Card>

            {res.data?.strategy && (
              <Card title="Suggested investment mix" subtitle={`For a ${r.yearsToRetirement}-year horizon and your risk profile`}>
                <div className="grid items-center gap-4 sm:grid-cols-2"><Donut data={allocData(res.data.strategy.allocation)} height={170} fmt={(n) => `${n}%`} /><div><Legend2 items={allocData(res.data.strategy.allocation).map((a) => ({ name: a.name, color: a.color, value: `${a.value}%` }))} /><p className="mt-3 text-xs text-muted">{res.data.strategy.summary}</p></div></div>
              </Card>
            )}
          </>
        )}
        {!r && !res.error && valid && <PageSkeleton />}
      </div>
    </div>
  );
}
