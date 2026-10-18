import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, BarChart3, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Download, Lightbulb, Pencil, PiggyBank, Plus, Receipt, Repeat, Search, Target, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bars, Spark, TrendArea } from "../components/charts";
import { ImportModal } from "../components/ImportModal";
import { PageSkeleton, TableSkeleton } from "../components/skeletons";
import { Term } from "../components/Term";
import { Badge, Button, Callout, Card, Empty, ErrorBox, Field, Input, Modal, NumInput, PageHeader, PageLoader, Progress, Select, Stat, Tabs, Td, Th, cn, useToast } from "../components/ui";
import { api, download } from "../lib/api";
import { dateShort, money, monthLabel, monthLong, pct, shiftMonth, thisMonth, today } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import type { Category } from "../lib/types";

type TabId = "overview" | "transactions" | "recurring" | "reports" | "categories" | "goals";
const BUCKET = { need: "Need", want: "Want", savings: "Savings" } as const;
const BUCKET_PLURAL = { need: "Needs", want: "Wants", savings: "Savings" } as const;

export default function Budget() {
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useState<TabId>(() => (["overview", "transactions", "recurring", "reports", "categories", "goals"].includes(params.get("tab") ?? "") ? (params.get("tab") as TabId) : "overview"));
  const [txModal, setTxModal] = useState<{ open: boolean; edit?: any }>({ open: false });
  const [importing, setImporting] = useState(false);
  const summary = useQuery({ queryKey: ["budget", "summary", month], queryFn: () => api.get<any>(`/budget/summary?month=${month}`) });
  const trend = useQuery({ queryKey: ["budget", "trend"], queryFn: () => api.get<{ trend: any[] }>("/budget/trend?months=6") });

  // deep links from the quick-add menu and command palette: /budget?add=1, ?import=1, ?tab=recurring
  useEffect(() => {
    const t = params.get("tab") as TabId | null;
    if (t && ["overview", "transactions", "recurring", "reports", "categories", "goals"].includes(t)) setTab(t);
    if (params.get("add")) setTxModal({ open: true });
    if (params.get("import")) { setTab("transactions"); setImporting(true); }
    if (params.get("add") || params.get("import") || params.get("tab")) setParams({}, { replace: true });
  }, [params, setParams]);

  if (summary.isLoading) return <PageSkeleton />;
  if (summary.error || !summary.data) return <ErrorBox error={summary.error} onRetry={summary.refetch} />;
  const s = summary.data;
  const a = s.analysis;

  return (
    <div className="space-y-6">
      <PageHeader title="Budget" subtitle="Plan every category, record what you spend, and see where the gaps are."
        actions={<>
          <div className="flex items-center rounded-lg border border-line bg-surface">
            <button className="cursor-pointer p-2 text-muted hover:text-text" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="size-4" /></button>
            <span className="min-w-32 text-center text-sm font-medium">{monthLong(month)}</span>
            <button className="cursor-pointer p-2 text-muted hover:text-text disabled:opacity-30" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className="size-4" /></button>
          </div>
          <Button icon={<Plus className="size-4" />} onClick={() => setTxModal({ open: true })}>Add transaction</Button>
        </>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Income" value={money(a.income)} sub={`Planned ${money(s.incomePlanned)}`} />
        <Stat label="Spent" value={money(a.spent)} sub={`Planned ${money(s.plannedExpenses)}`} />
        <Stat label={<Term k="savingsRate" icon={false}>Left over</Term>} value={a.spent > 0 ? money(a.saved) : "—"} tone={a.spent > 0 ? (a.saved > 0 ? "pos" : "neg") : undefined} sub={a.spent > 0 ? `${Math.round(a.savingsRate * 100)}% savings rate (goal 20%)` : "Record spending to see your savings rate"} />
        <Stat label="Over budget" value={a.overBudget.length ? money(a.wastage) : "None"} tone={a.overBudget.length ? "neg" : "pos"} sub={a.overBudget.length ? `${a.overBudget.length} categor${a.overBudget.length > 1 ? "ies" : "y"} above plan` : "Every category within plan"} />
      </div>

      <Tabs<TabId> value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Overview" }, { id: "transactions", label: "Transactions" }, { id: "recurring", label: "Bills & subscriptions", icon: <Repeat className="size-3.5" /> },
        { id: "reports", label: "Reports", icon: <BarChart3 className="size-3.5" /> }, { id: "categories", label: "Categories" }, { id: "goals", label: "Savings goals" },
      ]} />

      {tab === "overview" && <Overview s={s} trend={trend.data?.trend ?? []} />}
      {tab === "transactions" && <Transactions month={month} categories={s.categories} onEdit={(t) => setTxModal({ open: true, edit: t })} onImport={() => setImporting(true)} />}
      {tab === "recurring" && <Recurring />}
      {tab === "reports" && <Reports />}
      {tab === "categories" && <Categories categories={s.categories} />}
      {tab === "goals" && <Goals />}

      <TxModal state={txModal} close={() => setTxModal({ open: false })} categories={s.categories} month={month} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- overview
function Overview({ s, trend }: { s: any; trend: any[] }) {
  const a = s.analysis;
  const expense = s.categories.filter((c: Category) => c.kind === "expense" && c.bucket !== "savings");
  const [openTips, setOpenTips] = useState<string | null>(null);
  const sp = s.savingsPlan;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <Card title="Planned vs. actual" subtitle="Spending by category this month">
          <ul className="space-y-4">
            {expense.map((c: Category) => {
              const ratio = c.planned > 0 ? (c.actual / c.planned) * 100 : c.actual > 0 ? 100 : 0;
              const over = c.planned > 0 && c.actual > c.planned;
              return (
                <li key={c.id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 font-medium"><span className="size-2.5 rounded-full" style={{ background: c.color }} />{c.name}<Badge>{BUCKET[c.bucket]}</Badge></span>
                    <span className="tabular text-xs"><b className={over ? "text-neg" : ""}>{money(c.actual)}</b> <span className="text-muted">/ {c.planned ? money(c.planned) : "no plan"}</span></span>
                  </div>
                  <Progress value={ratio} tone={over ? "neg" : ratio >= 85 && ratio < 99.5 ? "warn" : "brand"} className="mt-1.5" label={c.name} />
                  {over && <p className="mt-1 text-xs text-neg">{money(c.actual - c.planned)} over plan</p>}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Six-month trend" subtitle="Income, spending and what you kept">
          <TrendArea data={trend} xKey="month" xFmt={monthLabel} series={[{ key: "income", label: "Income", color: "#0f766e" }, { key: "spent", label: "Spent", color: "#d97706" }, { key: "saved", label: "Kept", color: "#4f46e5", dashed: true }]} />
        </Card>
      </div>

      <div className="space-y-6 lg:col-span-2">
        <Card title="The 50 / 30 / 20 check" subtitle="Share of income by bucket">
          <div className="space-y-4">
            {(["need", "want", "savings"] as const).map((b) => {
              const x = a.buckets[b];
              const bad = b === "savings" ? x.pct < x.target : x.pct > x.target;
              return (
                <div key={b}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{BUCKET_PLURAL[b]} <span className="text-xs font-normal text-muted">target {b === "savings" ? "≥" : "≤"} {x.target * 100}%</span></span><span className={cn("tabular font-medium", bad ? "text-warn" : "text-pos")}>{Math.round(x.pct * 100)}% · {money(x.amount)}</span></div>
                  <Progress value={(x.pct / Math.max(x.target, 0.01)) * 50} tone={bad ? "warn" : "pos"} className="mt-1.5" label={`${BUCKET[b]} share`} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Insights">
          <div className="space-y-2.5">
            {a.insights.map((i: any) => <Callout key={i.title} tone={i.level === "good" ? "good" : i.level === "danger" ? "danger" : i.level === "warning" ? "warn" : "info"} title={i.title}>{i.detail}</Callout>)}
          </div>
        </Card>

        <Card title="Where you could trim" subtitle="Low-impact savings, biggest first" action={s.optimization.totalMonthly > 0 && <Badge tone="pos"><Lightbulb className="size-3" />{money(s.optimization.totalMonthly)}/mo</Badge>}>
          {s.optimization.items.length === 0 ? <p className="py-3 text-center text-sm text-muted">Record some spending to see suggestions.</p> : (
            <ul className="divide-y divide-line">
              {s.optimization.items.slice(0, 5).map((o: any) => (
                <li key={o.category} className="py-2.5">
                  <button className="flex w-full cursor-pointer items-center justify-between gap-2 text-left text-sm" onClick={() => setOpenTips(openTips === o.category ? null : o.category)} aria-expanded={openTips === o.category}>
                    <span><span className="font-medium">{o.category}</span><span className="ml-2 text-xs text-muted">{money(o.current)} spent</span></span>
                    <span className="flex items-center gap-1 tabular font-medium text-pos">−{money(o.potentialSaving)}<ChevronDown className={cn("size-4 text-muted transition", openTips === o.category && "rotate-180")} /></span>
                  </button>
                  {openTips === o.category && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">{o.tips.map((t: string) => <li key={t}>{t}</li>)}</ul>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Your savings plan" action={<PiggyBank className="size-4 text-brand" />}>
          <div className="text-sm">
            <div className="flex justify-between"><span className="text-muted">Emergency fund ({sp.emergencyFundMonths} mo)</span><span className="tabular font-medium">{money(sp.currentSavings)} / {money(sp.emergencyFundTarget)}</span></div>
            <Progress value={(sp.currentSavings / Math.max(sp.emergencyFundTarget, 1)) * 100} tone={sp.emergencyGap > 0 ? "warn" : "pos"} className="mt-1.5" label="Emergency fund" />
            <ol className="mt-4 space-y-2.5">
              {sp.steps.map((st: any) => <li key={st.order} className="flex gap-2.5"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-[0.65rem] font-bold text-brand">{st.order}</span><span><b className="font-medium">{st.title}.</b> <span className="text-muted">{st.detail}</span></span></li>)}
            </ol>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ transactions
function Transactions({ month, categories, onEdit, onImport }: { month: string; categories: Category[]; onEdit: (t: any) => void; onImport: () => void }) {
  const [cat, setCat] = useState("");
  const [search, setSearch] = useState("");
  const [allMonths, setAllMonths] = useState(false);
  const dq = useDebounced(search.trim(), 250);
  const qc = useQueryClient();
  const { confirm, toast, error } = useToast();
  const scope = allMonths || dq ? "" : `month=${month}&`;
  const q = useQuery({ queryKey: ["budget", "tx", scope, cat, dq], queryFn: () => api.get<{ transactions: any[] }>(`/budget/transactions?${scope}${cat ? `categoryId=${cat}&` : ""}${dq ? `q=${encodeURIComponent(dq)}` : ""}`) });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/budget/transactions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast("Transaction deleted"); },
    onError: error,
  });
  const rows = q.data?.transactions ?? [];
  const total = useMemo(() => rows.reduce((a, t) => a + (t.kind === "income" ? t.amount : -t.amount), 0), [rows]);
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div className="relative min-w-52 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Search transactions" className="pl-9" placeholder="Search merchant, note or category" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category" className="!w-44"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={allMonths || !!dq} disabled={!!dq} onChange={(e) => setAllMonths(e.target.checked)} className="size-4 accent-[var(--c-brand)]" />All months</label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} onClick={onImport}>Import CSV</Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => download(`/budget/transactions/export${allMonths || dq ? "" : `?month=${month}`}`, "finvara-transactions.csv").catch(error)}>Export</Button>
        </div>
      </div>
      <p className="border-b border-line px-4 py-2 text-xs text-muted">{rows.length} transaction{rows.length === 1 ? "" : "s"}{allMonths || dq ? "" : ` in ${monthLong(month)}`} · net <b className={cn("tabular", total >= 0 ? "text-pos" : "text-text")}>{money(total)}</b>{rows.length === 500 && " · showing the latest 500"}</p>
      {q.isLoading ? <div className="p-4"><TableSkeleton rows={6} /></div> : rows.length === 0 ? <Empty icon={<Receipt className="size-6" />} title={dq ? `No matches for “${dq}”` : "No transactions"} body={dq ? "Try a different word, or tick “All months”." : "Nothing recorded for this month yet — add one, or import a CSV from your bank."} action={!dq && <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} onClick={onImport}>Import CSV</Button>} /> : (
        <div className="overflow-x-auto"><table className="w-full">
          <thead className="border-b border-line"><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-line last:border-0 hover:bg-surface2/50">
                <Td className="whitespace-nowrap text-muted">{dateShort(t.date)}</Td>
                <Td><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: t.color }} />{t.category}</span></Td>
                <Td className="max-w-[16rem] truncate text-muted">{t.note}</Td>
                <Td className={cn("tabular text-right font-medium", t.kind === "income" && "text-pos")}>{t.kind === "income" ? "+" : "−"}{money(t.amount, 2)}</Td>
                <Td className="whitespace-nowrap text-right">
                  <button className="cursor-pointer rounded p-1.5 text-muted hover:bg-surface2 hover:text-text" onClick={() => onEdit(t)} aria-label="Edit"><Pencil className="size-4" /></button>
                  <button className="cursor-pointer rounded p-1.5 text-muted hover:bg-neg/10 hover:text-neg" aria-label="Delete" onClick={async () => (await confirm({ title: "Delete transaction?", body: `${t.category} · ${money(t.amount, 2)} on ${dateShort(t.date)}`, confirmLabel: "Delete", danger: true })) && del.mutate(t.id)}><Trash2 className="size-4" /></button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

function TxModal({ state, close, categories, month }: { state: { open: boolean; edit?: any }; close: () => void; categories: Category[]; month: string }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const e = state.edit;
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [f, setF] = useState<{ categoryId?: number; amount?: number; date: string; note: string }>({ date: today(), note: "" });
  const [key, setKey] = useState<string>("");
  // reset form whenever the modal is (re)opened
  const k = state.open ? `${e?.id ?? "new"}` : "";
  if (k !== key) {
    setKey(k);
    if (state.open) {
      setKind(e?.kind ?? "expense");
      setF({ categoryId: e?.categoryId, amount: e?.amount, date: e?.date ?? (month === thisMonth() ? today() : `${month}-01`), note: e?.note ?? "" });
    }
  }
  const list = categories.filter((c) => c.kind === kind);
  const save = useMutation({
    mutationFn: () => (e ? api.put(`/budget/transactions/${e.id}`, f) : api.post("/budget/transactions", f)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast(e ? "Transaction updated" : "Transaction added"); close(); },
    onError: error,
  });
  return (
    <Modal open={state.open} onClose={close} title={e ? "Edit transaction" : "Add transaction"} footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={save.isPending} disabled={!f.categoryId || !f.amount} onClick={() => save.mutate()}>{e ? "Save" : "Add"}</Button></>}>
      <div className="space-y-4">
        <Tabs value={kind} onChange={(v) => { setKind(v); setF({ ...f, categoryId: undefined }); }} tabs={[{ id: "expense", label: "Expense" }, { id: "income", label: "Income" }]} />
        <Field label="Category"><Select value={f.categoryId ?? ""} onChange={(ev) => setF({ ...f, categoryId: Number(ev.target.value) || undefined })}><option value="">Choose…</option>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><NumInput prefix="$" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} min={0} placeholder="0.00" /></Field>
          <Field label="Date"><Input type="date" value={f.date} max={today()} onChange={(ev) => setF({ ...f, date: ev.target.value })} /></Field>
        </div>
        <Field label="Note (optional)"><Input value={f.note} maxLength={200} onChange={(ev) => setF({ ...f, note: ev.target.value })} placeholder="e.g. Weekly groceries" /></Field>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------- categories
function Categories({ categories }: { categories: Category[] }) {
  const qc = useQueryClient();
  const { toast, error, confirm } = useToast();
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState<{ name: string; kind: "income" | "expense"; bucket: "need" | "want" | "savings"; planned?: number }>({ name: "", kind: "expense", bucket: "need" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["budget"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const upd = useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`/budget/categories/${id}`, b), onSuccess: () => { refresh(); toast("Saved"); }, onError: error });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/budget/categories/${id}`), onSuccess: () => { refresh(); toast("Category removed"); }, onError: error });
  const add = useMutation({ mutationFn: () => api.post("/budget/categories", { ...nc, planned: nc.planned ?? 0 }), onSuccess: () => { refresh(); setAdding(false); setNc({ name: "", kind: "expense", bucket: "need" }); toast("Category added"); }, onError: error });
  const group = (kind: "income" | "expense") => categories.filter((c) => c.kind === kind);
  const totalPlanned = (kind: "income" | "expense") => group(kind).filter((c) => kind === "income" || c.bucket !== "savings").reduce((a, c) => a + c.planned, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {(["income", "expense"] as const).map((kind) => (
        <Card key={kind} title={kind === "income" ? "Income sources" : "Expense categories"} subtitle={`Planned monthly total ${money(totalPlanned(kind))}${kind === "expense" ? " (excl. savings)" : ""}`}
          action={kind === "expense" && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => { setNc({ name: "", kind: "expense", bucket: "need" }); setAdding(true); }}>New</Button>}>
          <ul className="divide-y divide-line">
            {group(kind).map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                {kind === "expense" && (
                  <Select aria-label={`${c.name} bucket`} value={c.bucket} onChange={(e) => upd.mutate({ id: c.id, bucket: e.target.value })} className="!w-28 !py-1 text-xs">
                    <option value="need">Need</option><option value="want">Want</option><option value="savings">Savings</option>
                  </Select>
                )}
                <div className="w-28 shrink-0">
                  <input type="number" min={0} step="1" defaultValue={c.planned} aria-label={`${c.name} planned amount`}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== c.planned && v >= 0) upd.mutate({ id: c.id, planned: v }); }}
                    className="tabular w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-right text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25" />
                </div>
                <button className="cursor-pointer rounded p-1.5 text-muted hover:bg-neg/10 hover:text-neg" aria-label={`Delete ${c.name}`}
                  onClick={async () => (await confirm({ title: `Delete “${c.name}”?`, body: "All transactions in this category will be deleted too.", confirmLabel: "Delete", danger: true })) && del.mutate(c.id)}><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <Modal open={adding} onClose={() => setAdding(false)} title="New expense category" footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button loading={add.isPending} disabled={!nc.name.trim()} onClick={() => add.mutate()}>Add</Button></>}>
        <div className="space-y-4">
          <Field label="Name"><Input value={nc.name} maxLength={40} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="e.g. Pet care" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={nc.bucket} onChange={(e) => setNc({ ...nc, bucket: e.target.value as any })}><option value="need">Need</option><option value="want">Want</option><option value="savings">Savings</option></Select></Field>
            <Field label="Monthly plan"><NumInput prefix="$" value={nc.planned} onChange={(v) => setNc({ ...nc, planned: v })} min={0} /></Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------- goals
function Goals() {
  const qc = useQueryClient();
  const { toast, error, confirm } = useToast();
  const q = useQuery({ queryKey: ["budget", "goals"], queryFn: () => api.get<{ goals: any[] }>("/budget/goals") });
  const [modal, setModal] = useState<{ open: boolean; edit?: any }>({ open: false });
  const [contrib, setContrib] = useState<{ goal: any; amount?: number } | null>(null);
  const [f, setF] = useState<{ name: string; target?: number; current?: number; deadline: string }>({ name: "", deadline: "" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["budget", "goals"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const save = useMutation({
    mutationFn: () => { const b = { name: f.name, target: f.target, current: f.current ?? 0, deadline: f.deadline || null }; return modal.edit ? api.put(`/budget/goals/${modal.edit.id}`, b) : api.post("/budget/goals", b); },
    onSuccess: () => { refresh(); setModal({ open: false }); toast("Goal saved"); }, onError: error,
  });
  const add = useMutation({ mutationFn: () => api.post(`/budget/goals/${contrib!.goal.id}/contribute`, { amount: contrib!.amount }), onSuccess: () => { refresh(); setContrib(null); toast("Contribution added"); }, onError: error });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/budget/goals/${id}`), onSuccess: () => { refresh(); toast("Goal deleted"); }, onError: error });
  const goals = q.data?.goals ?? [];
  const open = (g?: any) => { setF({ name: g?.name ?? "", target: g?.target, current: g?.current ?? 0, deadline: g?.deadline ?? "" }); setModal({ open: true, edit: g }); };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button icon={<Plus className="size-4" />} onClick={() => open()}>New savings goal</Button></div>
      {q.isLoading ? <PageLoader /> : goals.length === 0 ? <Card><Empty icon={<Target className="size-6" />} title="No savings goals" body="Set a target for an emergency fund, a trip or a big purchase." /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((g) => {
            const p = (g.current / g.target) * 100;
            const monthsLeft = g.deadline ? Math.max(0, Math.round((new Date(g.deadline).getTime() - Date.now()) / (30.4 * 86400000))) : null;
            const need = monthsLeft ? Math.max(0, g.target - g.current) / monthsLeft : null;
            return (
              <Card key={g.id}>
                <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{g.name}</h3>
                  <div className="flex"><button className="cursor-pointer rounded p-1.5 text-muted hover:bg-surface2" onClick={() => open(g)} aria-label="Edit goal"><Pencil className="size-4" /></button>
                    <button className="cursor-pointer rounded p-1.5 text-muted hover:bg-neg/10 hover:text-neg" aria-label="Delete goal" onClick={async () => (await confirm({ title: `Delete “${g.name}”?`, confirmLabel: "Delete", danger: true })) && del.mutate(g.id)}><Trash2 className="size-4" /></button></div></div>
                <div className="tabular mt-2 text-2xl font-semibold">{money(g.current)} <span className="text-sm font-normal text-muted">of {money(g.target)}</span></div>
                <Progress value={p} tone={p >= 100 ? "pos" : "brand"} className="mt-3" label={g.name} />
                <p className="mt-2 text-xs text-muted">{pct(Math.min(p, 100), 0)} complete{g.deadline && ` · by ${dateShort(g.deadline)}`}{need ? ` · save ${money(need)}/mo` : ""}</p>
                <Button size="sm" variant="secondary" className="mt-4 w-full" icon={<Plus className="size-4" />} onClick={() => setContrib({ goal: g })}>Add money</Button>
              </Card>
            );
          })}
        </div>
      )}
      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.edit ? "Edit goal" : "New savings goal"} footer={<><Button variant="secondary" onClick={() => setModal({ open: false })}>Cancel</Button><Button loading={save.isPending} disabled={!f.name.trim() || !f.target} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Name"><Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Japan trip" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target"><NumInput prefix="$" value={f.target} onChange={(v) => setF({ ...f, target: v })} min={0} /></Field>
            <Field label="Saved so far"><NumInput prefix="$" value={f.current} onChange={(v) => setF({ ...f, current: v })} min={0} /></Field>
          </div>
          <Field label="Deadline (optional)"><Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={!!contrib} onClose={() => setContrib(null)} title={`Add to ${contrib?.goal.name}`} footer={<><Button variant="secondary" onClick={() => setContrib(null)}>Cancel</Button><Button loading={add.isPending} disabled={!contrib?.amount} onClick={() => add.mutate()}>Add</Button></>}>
        <Field label="Amount"><NumInput prefix="$" value={contrib?.amount} onChange={(v) => contrib && setContrib({ ...contrib, amount: v })} min={0} /></Field>
      </Modal>
    </div>
  );
}

// --------------------------------------------------------------- recurring
function Recurring() {
  const q = useQuery({ queryKey: ["budget", "recurring"], queryFn: () => api.get<any>("/budget/recurring") });
  const [filter, setFilter] = useState<"all" | "subs" | "bills">("all");
  if (q.isLoading) return <TableSkeleton rows={6} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const isSub = (i: any) => /subscri/i.test(i.category);
  const items = d.items.filter((i: any) => (filter === "all" ? true : filter === "subs" ? isSub(i) : !isSub(i)));
  const subs = d.items.filter(isSub);
  const subsMonthly = subs.reduce((a: number, i: any) => a + i.amount, 0);
  const due30 = d.upcoming.filter((u: any) => u.kind === "expense");
  if (d.items.length === 0) return <Card><Empty icon={<Repeat className="size-6" />} title="No recurring payments found yet" body="Finvara spots bills and subscriptions once the same payee shows up in three different months. Keep recording transactions, or import a few months from your bank." /></Card>;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Recurring each month" value={money(d.monthlyTotal)} sub={`${d.items.length} bills & subscriptions`} />
        <Stat label="Cost per year" value={money(d.annualTotal)} sub="If nothing changes" />
        <Stat label="Due in 30 days" value={money(due30.reduce((a: number, u: any) => a + u.amount, 0))} sub={`${due30.length} payment${due30.length === 1 ? "" : "s"} coming up`} />
        <Stat label="Subscriptions" value={money(subsMonthly)} sub={subs.length ? `${money(subsMonthly * 12)} a year across ${subs.length}` : "None detected"} />
      </div>
      {subs.length > 0 && <Callout tone="info" title={`Subscriptions add up to ${money(subsMonthly * 12)} a year`}>Worth a quick review: cancel what you haven't used in the last month, or switch to annual plans for the ones you keep.</Callout>}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card pad={false} className="lg:col-span-3" title="All recurring payments" action={<Tabs<"all" | "subs" | "bills"> value={filter} onChange={setFilter} tabs={[{ id: "all", label: "All" }, { id: "subs", label: "Subscriptions" }, { id: "bills", label: "Bills" }]} />}>
          <ul className="divide-y divide-line">
            {items.map((i: any) => (
              <li key={i.name + i.category} className="flex items-center gap-3 px-5 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface2 text-sm font-bold text-muted">{i.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{i.name}</span>{i.varies && <Badge>varies</Badge>}</span><span className="block text-xs text-muted">{i.category} · next {dateShort(i.nextDate)} ({i.daysUntil <= 0 ? "today" : `in ${i.daysUntil}d`})</span></span>
                <span className="text-right"><span className="tabular block text-sm font-semibold">{money(i.amount, i.amount % 1 ? 2 : 0)}<span className="font-normal text-muted">/mo</span></span><span className="tabular block text-xs text-muted">{money(i.annualCost)}/yr</span></span>
              </li>))}
            {items.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Nothing in this group.</li>}
          </ul>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card title="Coming up" subtitle="Next 30 days">
            {due30.length === 0 ? <p className="py-3 text-center text-sm text-muted">Nothing due in the next 30 days.</p> : (
              <ol className="relative space-y-4 border-l border-line pl-5">{due30.map((u: any) => (
                <li key={u.name} className="relative"><span className="absolute -left-[1.62rem] top-1 grid size-3 place-items-center rounded-full border-2 border-brand bg-surface" />
                  <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{u.name}</span><span className="tabular text-sm">{money(u.amount, u.amount % 1 ? 2 : 0)}</span></div>
                  <div className="flex items-center gap-1.5 text-xs text-muted"><CalendarClock className="size-3" />{dateShort(u.nextDate)} · {u.daysUntil <= 0 ? "due today" : u.daysUntil === 1 ? "tomorrow" : `in ${u.daysUntil} days`}</div></li>))}</ol>
            )}
          </Card>
          {d.income.length > 0 && <Card title="Regular income"><ul className="space-y-2">{d.income.map((i: any) => <li key={i.name} className="flex items-center justify-between text-sm"><span>{i.name}<span className="block text-xs text-muted">next {dateShort(i.nextDate)}</span></span><span className="tabular font-semibold text-pos">+{money(i.amount)}</span></li>)}</ul></Card>}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- reports
function Reports() {
  const q = useQuery({ queryKey: ["budget", "report"], queryFn: () => api.get<any>("/budget/report?months=6") });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  const r = q.data;
  const top = r.categories.slice(0, 6);
  const rest = r.categories.slice(6);
  const series = [...top.map((c: any) => ({ key: c.name, label: c.name, color: c.color })), ...(rest.length ? [{ key: "Other", label: "Other", color: "#94a3b8" }] : [])];
  const data = r.months.map((m: string, i: number) => ({ month: m, ...Object.fromEntries(top.map((c: any) => [c.name, c.totals[i]])), ...(rest.length ? { Other: Math.round(rest.reduce((a: number, c: any) => a + c.totals[i], 0) * 100) / 100 } : {}) }));
  const rate = r.totals.map((t: any) => ({ month: t.month, rate: t.income > 0 ? Math.round(((t.income - t.spent) / t.income) * 100) : 0 }));
  const maxM = Math.max(1, ...r.merchants.map((m: any) => m.total));
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Spending by category" subtitle="Last 6 months · the latest month is still in progress"><Bars stacked data={data} xKey="month" xFmt={monthLabel} series={series} height={280} /></Card>
        <Card className="lg:col-span-2" title="Savings rate by month" subtitle="Share of income you kept (excl. investing transfers)"><Bars data={rate} xKey="month" xFmt={monthLabel} fmt={(n) => `${n}%`} series={[{ key: "rate", label: "Savings rate", color: "#4f46e5" }]} height={280} /></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card pad={false} className="lg:col-span-3" title="Category trends" subtitle="Average uses full months only">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="border-b border-line"><tr><Th>Category</Th><Th className="text-right">Avg / month</Th><Th className="text-right">Last full month</Th><Th className="text-right">vs. month before</Th><Th className="w-24">Trend</Th></tr></thead>
            <tbody>{r.categories.map((c: any) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <Td><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: c.color }} />{c.name}</span></Td>
                <Td className="tabular text-right">{money(c.avg)}</Td><Td className="tabular text-right">{money(c.last)}</Td>
                <Td className={cn("tabular text-right text-xs font-medium", c.changePct == null ? "text-muted" : c.changePct > 5 ? "text-neg" : c.changePct < -5 ? "text-pos" : "text-muted")}>{c.changePct == null ? "—" : <span className="inline-flex items-center gap-0.5">{c.changePct > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(c.changePct)}%</span>}</Td>
                <Td><Spark data={c.totals} color={c.color} height={28} /></Td>
              </tr>))}</tbody>
          </table></div>
        </Card>
        <Card className="lg:col-span-2" title="Top merchants" subtitle="Where most of your money goes">
          <ul className="space-y-3">{r.merchants.map((m: any) => (
            <li key={m.name + m.category}><div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium">{m.name}</span><span className="tabular">{money(m.total)}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-brand" style={{ width: `${(m.total / maxM) * 100}%` }} /></div>
              <p className="mt-0.5 text-xs text-muted">{m.category} · {m.count} payment{m.count === 1 ? "" : "s"}</p></li>))}</ul>
        </Card>
      </div>
    </div>
  );
}
