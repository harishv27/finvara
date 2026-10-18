import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Star } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, NumInput, PageLoader, Progress, Select, Tabs, Td, Th, cn, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { money, pct } from "../../lib/format";
import type { Fund, Stock } from "../../lib/types";

type Kind = "funds" | "stocks";

export function Content() {
  const [kind, setKind] = useState<Kind>("funds");
  const [edit, setEdit] = useState<{ open: boolean; row?: any }>({ open: false });
  const qc = useQueryClient();
  const { error } = useToast();
  const q = useQuery({ queryKey: ["admin", kind], queryFn: () => api.get<any>(`/admin/${kind}`) });
  const toggle = useMutation({ mutationFn: ({ symbol, ...b }: any) => api.put(`/admin/${kind}/${symbol}`, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", kind] }); for (const k of ["funds", "stocks"]) qc.invalidateQueries({ queryKey: [k] }); }, onError: error });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rows: (Fund & Stock)[] = q.data[kind];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<Kind> value={kind} onChange={setKind} tabs={[{ id: "funds", label: `Mutual funds (${kind === "funds" ? rows.length : "…"})` }, { id: "stocks", label: `Stocks (${kind === "stocks" ? rows.length : "…"})` }]} />
        <Button icon={<Plus className="size-4" />} onClick={() => setEdit({ open: true })}>Add {kind === "funds" ? "fund" : "stock"}</Button>
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px]">
          <thead className="border-b border-line"><tr><Th>Symbol</Th><Th>Name</Th><Th>{kind === "funds" ? "Category" : "Sector"}</Th><Th className="text-right">{kind === "funds" ? "NAV" : "Price"}</Th>{kind === "funds" ? <><Th className="text-right">Risk</Th><Th className="text-right">Cost</Th></> : <><Th className="text-right">P/E</Th><Th className="text-right">Beta</Th></>}<Th>Featured</Th><Th>Active</Th><Th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.symbol} className={cn("border-b border-line last:border-0", !r.active && "opacity-55")}>
              <Td className="font-semibold">{r.symbol}</Td><Td className="max-w-[16rem] truncate">{r.name}</Td><Td className="text-muted">{kind === "funds" ? r.category : r.sector}</Td>
              <Td className="tabular text-right">{money(kind === "funds" ? r.nav : r.price, 2)}</Td>
              {kind === "funds" ? <><Td className="tabular text-right">{r.risk}</Td><Td className="tabular text-right">{pct(r.expense_ratio, 2)}</Td></> : <><Td className="tabular text-right">{r.pe.toFixed(1)}</Td><Td className="tabular text-right">{r.beta.toFixed(2)}</Td></>}
              <Td><button className="cursor-pointer" aria-pressed={r.featured} aria-label={`Toggle featured for ${r.symbol}`} onClick={() => toggle.mutate({ symbol: r.symbol, featured: !r.featured })}><Star className={cn("size-4", r.featured ? "fill-accent text-accent" : "text-muted")} /></button></Td>
              <Td><input type="checkbox" role="switch" aria-label={`Active ${r.symbol}`} checked={r.active} onChange={() => toggle.mutate({ symbol: r.symbol, active: !r.active })} className="size-4 cursor-pointer accent-[var(--c-brand)]" /></Td>
              <Td className="text-right"><Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit({ open: true, row: r })}>Edit</Button></Td>
            </tr>))}</tbody>
        </table></div>
      </Card>
      <p className="text-xs text-muted">Deactivated items disappear from user-facing lists and recommendations but remain in existing portfolios. “Featured” gives a small score boost in recommendations.</p>
      <EditModal kind={kind} state={edit} close={() => setEdit({ open: false })} />
    </div>
  );
}

const FUND_FIELDS: [string, string, "text" | "num", string?][] = [["name", "Name", "text"], ["category", "Category", "text"], ["fund_house", "Fund house", "text"], ["nav", "NAV", "num", "$"], ["risk", "Risk (1–5)", "num"], ["expense_ratio", "Expense ratio", "num", "%"], ["return_1y", "1Y return", "num", "%"], ["return_3y", "3Y / yr", "num", "%"], ["return_5y", "5Y / yr", "num", "%"], ["volatility", "Volatility (0–1)", "num"], ["sharpe", "Sharpe", "num"], ["aum_bn", "Assets ($bn)", "num"], ["min_investment", "Minimum ($)", "num"]];
const STOCK_FIELDS: [string, string, "text" | "num", string?][] = [["name", "Name", "text"], ["sector", "Sector", "text"], ["price", "Price", "num", "$"], ["market_cap_bn", "Market cap ($bn)", "num"], ["pe", "P/E", "num"], ["dividend_yield", "Dividend yield", "num", "%"], ["beta", "Beta", "num"], ["eps_growth", "EPS growth", "num", "%"], ["volatility", "Volatility (0–1)", "num"]];

function EditModal({ kind, state, close }: { kind: Kind; state: { open: boolean; row?: any }; close: () => void }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const fields = kind === "funds" ? FUND_FIELDS : STOCK_FIELDS;
  const [f, setF] = useState<any>({});
  const [k, setK] = useState("");
  const key = state.open ? `${kind}:${state.row?.symbol ?? "new"}` : "";
  if (key !== k) { setK(key); if (state.open) setF(state.row ? { ...state.row } : kind === "funds" ? { symbol: "", risk: 3, expense_ratio: 0.5, nav: 20, return_1y: 8, return_3y: 8, return_5y: 8, volatility: 0.15, sharpe: 0.5, aum_bn: 1, min_investment: 1000, featured: false, active: true, description: "", name: "", category: "", fund_house: "" } : { symbol: "", price: 50, market_cap_bn: 10, pe: 20, dividend_yield: 1, beta: 1, eps_growth: 8, volatility: 0.25, featured: false, active: true, description: "", name: "", sector: "" }); }
  const save = useMutation({
    mutationFn: () => {
      const body: any = Object.fromEntries([...fields.map(([n]) => [n, f[n]]), ["description", f.description ?? ""], ["featured", !!f.featured], ["active", f.active !== false]]);
      if (state.row) return api.put(`/admin/${kind}/${state.row.symbol}`, body);
      return api.post(`/admin/${kind}`, { ...body, symbol: f.symbol });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", kind] }); for (const x of ["funds", "stocks", "dashboard"]) qc.invalidateQueries({ queryKey: [x] }); toast("Saved"); close(); },
    onError: (e: any) => error(new Error(Object.values(e.fields ?? {})[0] as string ?? e.message)),
  });
  return (
    <Modal open={state.open} onClose={close} wide title={state.row ? `Edit ${state.row.symbol}` : `Add ${kind === "funds" ? "fund" : "stock"}`} footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        {!state.row && <Field label="Symbol"><Input value={f.symbol ?? ""} maxLength={8} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} placeholder="ABCD" /></Field>}
        {fields.map(([n, label, type, unit]) => <Field key={n} label={label} className={n === "name" ? "sm:col-span-2" : ""}>{type === "text" ? <Input value={f[n] ?? ""} onChange={(e) => setF({ ...f, [n]: e.target.value })} /> : <NumInput value={f[n]} onChange={(v) => setF({ ...f, [n]: v })} prefix={unit === "$" ? "$" : undefined} suffix={unit === "%" ? "%" : undefined} />}</Field>)}
        <Field label="Description" className="sm:col-span-3"><Input value={f.description ?? ""} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.featured} onChange={(e) => setF({ ...f, featured: e.target.checked })} className="size-4 accent-[var(--c-brand)]" />Featured pick</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} className="size-4 accent-[var(--c-brand)]" />Active</label>
      </div>
      {kind === "stocks" && state.row && <p className="mt-3 text-xs text-muted">Changing the price updates the live feed immediately; the simulated ticker continues from the new value.</p>}
    </Modal>
  );
}

// ---------------------------------------------------- recommendation config
const WEIGHTS: [string, string, string][] = [["rec_weight_risk_fit", "Risk fit", "How closely the asset's risk matches the user's tolerance"], ["rec_weight_return", "Returns", "Historical return (funds) / momentum + earnings growth (stocks)"], ["rec_weight_cost", "Cost / valuation", "Low expense ratio (funds) / reasonable P/E (stocks)"], ["rec_weight_quality", "Quality", "Sharpe ratio (funds) / dividends & size (stocks)"]];

export function Recommendations() {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const q = useQuery({ queryKey: ["admin", "recs"], queryFn: () => api.get<any>("/admin/recommendations") });
  const [c, setC] = useState<any>(null);
  const [pv, setPv] = useState({ risk: 3, horizon: 10 });
  const cfg = c ?? q.data?.config;
  const preview = useQuery({ enabled: !!q.data, queryKey: ["admin", "rec-preview", pv, q.data?.config, c === null], queryFn: () => api.get<any>(`/admin/recommendations/preview?risk=${pv.risk}&horizon=${pv.horizon}`) });
  const save = useMutation({ mutationFn: () => api.put("/admin/recommendations", cfg), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); for (const k of ["funds", "stocks", "dashboard"]) qc.invalidateQueries({ queryKey: [k] }); setC(null); toast("Recommendation settings saved"); }, onError: error });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const total = WEIGHTS.reduce((a, [k]) => a + (cfg[k] ?? 0), 0) || 1;
  const set = (k: string, v: number) => setC({ ...cfg, [k]: v });
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2" title="Scoring weights" subtitle="Relative importance — normalised automatically" action={<Button size="sm" disabled={!c} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
        <div className="space-y-5">{WEIGHTS.map(([k, label, hint]) => (
          <div key={k}><div className="flex items-baseline justify-between"><label htmlFor={k} className="text-sm font-medium">{label}</label><span className="tabular text-sm font-semibold">{Math.round((cfg[k] / total) * 100)}%</span></div>
            <input id={k} type="range" min={0} max={1} step={0.05} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} className="mt-1 w-full cursor-pointer accent-[var(--c-brand)]" /><p className="text-xs text-muted">{hint}</p></div>))}
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
            <Field label="Min match score" hint="Hide anything scoring lower"><NumInput value={cfg.rec_min_match} onChange={(v) => set("rec_min_match", v ?? 0)} min={0} max={100} step="1" /></Field>
            <Field label="Results shown"><NumInput value={cfg.rec_top_n} onChange={(v) => set("rec_top_n", Math.round(v ?? 6))} min={1} max={20} step="1" /></Field>
          </div>
        </div>
        <div className="mt-5 border-t border-line pt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">User engagement</p>
          <div className="flex flex-wrap gap-2">{q.data.feedback.length === 0 ? <span className="text-sm text-muted">No feedback yet.</span> : q.data.feedback.map((f: any) => <Badge key={f.action} tone="brand">{f.action}: {f.n}</Badge>)}</div></div>
      </Card>
      <Card className="lg:col-span-3" title="Preview" subtitle="Top results for a sample investor (saved settings)">
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Field label="Risk tolerance"><Select value={pv.risk} onChange={(e) => setPv({ ...pv, risk: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r} — {["very low", "low", "moderate", "high", "very high"][r - 1]}</option>)}</Select></Field>
          <Field label="Horizon"><Select value={pv.horizon} onChange={(e) => setPv({ ...pv, horizon: Number(e.target.value) })}>{[2, 5, 10, 20, 30].map((h) => <option key={h} value={h}>{h} years</option>)}</Select></Field>
        </div>
        {!preview.data ? <PageLoader /> : <div className="grid gap-5 sm:grid-cols-2">{([["Funds", preview.data.funds], ["Stocks", preview.data.stocks]] as const).map(([t, rows]) => (
          <div key={t}><p className="mb-2 text-sm font-semibold">{t}</p>{rows.length === 0 && <p className="text-sm text-muted">Nothing clears the threshold.</p>}<ul className="space-y-2.5">{rows.map((r: any) => (
            <li key={r.symbol}><div className="flex items-center justify-between text-sm"><span className="font-medium">{r.symbol}</span><span className="tabular text-xs text-muted">{r.match}%</span></div><Progress value={r.match} className="mt-1" label={r.symbol} /><p className="mt-0.5 truncate text-xs text-muted">{r.reasons[0]}</p></li>))}</ul></div>))}</div>}
        <p className="mt-4 text-xs text-muted">Most-watchlisted: {q.data.topWatchlisted.map((w: any) => `${w.symbol} (${w.n})`).join(", ") || "—"}</p>
      </Card>
    </div>
  );
}
