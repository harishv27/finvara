import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Briefcase, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Callout, Card, Empty, ErrorBox, Field, Modal, NumInput, PageLoader, Stat, Th, Td, cn, useToast } from "./ui";
import { Donut, Legend2, PALETTE, TrendArea } from "./charts";
import { api } from "../lib/api";
import { money, moneyCompact, num, signedMoney, signedPct, tone } from "../lib/format";
import type { Holding } from "../lib/types";

export function RiskDots({ risk, max = 5 }: { risk: number; max?: number }) {
  const label = ["", "Very low", "Low", "Moderate", "High", "Very high"][risk] ?? "";
  return (
    <span className="inline-flex items-center gap-0.5" title={`Risk ${risk}/5 · ${label}`} aria-label={`Risk ${risk} of 5`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={cn("size-1.5 rounded-full", i < risk ? (risk >= 4 ? "bg-neg" : risk === 3 ? "bg-warn" : "bg-pos") : "bg-line")} />)}
    </span>
  );
}

export function MatchBadge({ match }: { match: number }) {
  return <Badge tone={match >= 75 ? "pos" : match >= 55 ? "brand" : "neutral"}>{match}% match</Badge>;
}

export function WatchButton({ kind, symbol, on }: { kind: "fund" | "stock"; symbol: string; on?: boolean }) {
  const qc = useQueryClient();
  const { error } = useToast();
  const m = useMutation({
    mutationFn: () => (on ? api.del(`/watchlist/${kind}/${symbol}`) : api.post("/watchlist", { kind, symbol })),
    onSuccess: () => { for (const k of ["funds", "stocks", "watchlist", "dashboard", "fund", "stock"]) qc.invalidateQueries({ queryKey: [k] }); },
    onError: error,
  });
  return (
    <button onClick={(e) => { e.stopPropagation(); m.mutate(); }} aria-pressed={!!on} aria-label={on ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      className="cursor-pointer rounded-md p-1.5 text-muted transition hover:bg-surface2 hover:text-accent">
      <Star className={cn("size-4", on && "fill-accent text-accent")} />
    </button>
  );
}

export function AskAI({ q, label = "Ask the advisor" }: { q: string; label?: string }) {
  return <Link to={`/chat?agent=investment&q=${encodeURIComponent(q)}`}><Button size="sm" variant="secondary" icon={<Bot className="size-4" />}>{label}</Button></Link>;
}

export function PriceChart({ history, height = 220 }: { history: { date: string; close: number }[]; height?: number }) {
  const up = history.length > 1 && history[history.length - 1].close >= history[0].close;
  return <TrendArea zoom data={history} xKey="date" height={height} series={[{ key: "close", label: "Price", color: up ? "#15803d" : "#b91c1c" }]} fmt={(n) => `$${n.toFixed(0)}`} tipFmt={(n) => money(n, 2)} xFmt={(d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} />;
}

export function RangeTabs({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5 text-xs" role="group" aria-label="Chart range">
      {["1M", "3M", "6M", "1Y"].map((r) => <button key={r} onClick={() => onChange(r)} aria-pressed={value === r} className={cn("cursor-pointer rounded-md px-2.5 py-1 font-medium transition", value === r ? "bg-brand text-white [[data-theme=dark]_&]:text-ink" : "text-muted hover:text-text")}>{r}</button>)}
    </div>
  );
}

export function AddHoldingModal({ kind, asset, onClose }: { kind: "fund" | "stock"; asset: { symbol: string; name: string; price: number } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const [amount, setAmount] = useState<number | undefined>();
  const units = asset && amount ? amount / asset.price : 0;
  const m = useMutation({
    mutationFn: () => api.post("/portfolio/holdings", { kind, symbol: asset!.symbol, units: Number(units.toFixed(4)) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portfolio"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast(`Added ${asset!.symbol} to your portfolio`); setAmount(undefined); onClose(); },
    onError: error,
  });
  return (
    <Modal open={!!asset} onClose={onClose} title={`Add ${asset?.symbol ?? ""} to portfolio`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!amount || units <= 0} onClick={() => m.mutate()}>Add holding</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{asset?.name} at <b className="text-text">{asset && money(asset.price, 2)}</b> per {kind === "fund" ? "unit (NAV)" : "share"}. This records a simulated holding — no real money moves.</p>
        <Field label="Amount to invest"><NumInput prefix="$" value={amount} onChange={setAmount} min={0} placeholder="1000" /></Field>
        {units > 0 && <p className="text-sm text-muted">≈ <b className="tabular text-text">{num(units, 3)}</b> {kind === "fund" ? "units" : "shares"}</p>}
      </div>
    </Modal>
  );
}

export function PortfolioPanel() {
  const qc = useQueryClient();
  const { toast, error, confirm } = useToast();
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.get<any>("/portfolio"), refetchInterval: 15_000 });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/portfolio/holdings/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["portfolio"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast("Holding removed"); }, onError: error });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  const p = q.data;
  if (p.empty) return <Card><Empty icon={<Briefcase className="size-6" />} title="Your portfolio is empty" body="Add a fund or stock from the other tabs to start tracking performance, risk and diversification." /></Card>;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Value" value={money(p.totalValue)} sub={`Cost ${money(p.totalCost)}`} />
        <Stat label="Total gain" value={signedMoney(p.totalGain)} tone={p.totalGain >= 0 ? "pos" : "neg"} sub={signedPct(p.totalGainPct)} />
        <Stat label="Average risk" value={`${p.weightedRisk} / 5`} sub={`Concentration index ${p.concentration}`} />
        <Stat label="Fund fees" value={`${p.weightedExpenseRatio}%`} sub={`${p.mix.funds}% funds · ${p.mix.stocks}% stocks`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card pad={false} className="lg:col-span-3" title="Holdings">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="border-b border-line"><tr><Th>Holding</Th><Th className="text-right">Value</Th><Th className="text-right">Weight</Th><Th className="text-right">Gain</Th><Th /></tr></thead>
            <tbody>{p.holdings.map((h: Holding) => (
              <tr key={h.id} className="border-b border-line last:border-0">
                <Td><div className="font-medium">{h.symbol} <Badge>{h.kind}</Badge></div><div className="text-xs text-muted">{h.name}</div></Td>
                <Td className="tabular text-right">{money(h.value)}<div className="text-xs text-muted">{num(h.units, 2)} × {money(h.price, 2)}</div></Td>
                <Td className="tabular text-right">{h.weight}%</Td>
                <Td className={cn("tabular text-right font-medium", tone(h.gain))}>{signedMoney(h.gain)}<div className="text-xs">{signedPct(h.gainPct)}</div></Td>
                <Td className="text-right"><button className="cursor-pointer rounded p-1.5 text-muted hover:bg-neg/10 hover:text-neg" aria-label={`Remove ${h.symbol}`} onClick={async () => (await confirm({ title: `Remove ${h.symbol}?`, body: "This deletes the simulated holding from your portfolio.", confirmLabel: "Remove", danger: true })) && del.mutate(h.id)}><Trash2 className="size-4" /></button></Td>
              </tr>))}</tbody>
          </table></div>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card title="Allocation">
            <div className="grid items-center gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Donut data={p.categories.map((c: any, i: number) => ({ name: c.name, value: c.value, color: PALETTE[i % PALETTE.length] }))} height={170} fmt={(n) => money(n)} center={<><span className="text-xs text-muted">Total</span><span className="tabular text-lg font-semibold">{moneyCompact(p.totalValue)}</span></>} />
              <Legend2 items={p.categories.map((c: any, i: number) => ({ name: c.name, color: PALETTE[i % PALETTE.length], value: `${c.weight}%` }))} />
            </div>
          </Card>
          <Card title="Review">
            <div className="space-y-2">{p.findings.map((f: any) => <Callout key={f.text} tone={f.level === "good" ? "good" : f.level === "warning" ? "warn" : "info"} title={f.text} />)}</div>
            <div className="mt-3"><AskAI q="Review my portfolio — is it diversified, and what would you change?" label="Ask the advisor to review" /></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
