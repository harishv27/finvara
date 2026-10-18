import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Callout, Card, ErrorBox, Field, Input, Modal, NumInput, PageHeader, PageLoader, cn, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Profile as ProfileT } from "../lib/types";

const GOALS = ["Buy a home", "Retire comfortably", "Build an emergency fund", "Pay off debt", "Fund education", "Grow wealth", "Travel", "Generate passive income"];

export default function Profile() {
  const { user, refresh, logout } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api.get<{ profile: ProfileT }>("/profile") });
  const qs = useQuery({ queryKey: ["risk-questions"], queryFn: () => api.get<{ questions: { id: string; text: string; options: { label: string; score: number }[] }[] }>("/profile/risk-questions") });
  const [f, setF] = useState<any>(null);
  const [name, setName] = useState(user?.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [quiz, setQuiz] = useState(false);
  const [del, setDel] = useState<string | null>(null);

  useEffect(() => { const p = q.data?.profile; if (p) setF({ age: p.age, monthlyIncome: p.monthly_income, monthlyExpenses: p.monthly_expenses, currentSavings: p.current_savings, totalDebt: p.total_debt, dependents: p.dependents, retirementAge: p.retirement_age, goals: p.goals }); }, [q.data]);

  const save = useMutation({ mutationFn: () => api.put("/profile", f), onSuccess: () => { qc.invalidateQueries(); toast("Profile saved"); }, onError: error });
  const acct = useMutation({
    mutationFn: () => api.put("/profile/account", { name, ...(pw.next ? { currentPassword: pw.current, newPassword: pw.next } : {}) }),
    onSuccess: async () => { setPw({ current: "", next: "" }); await refresh(); toast("Account updated"); }, onError: error,
  });
  const risk = useMutation({ mutationFn: () => api.post<{ result: any }>("/profile/risk", { answers }), onSuccess: (r) => { qc.invalidateQueries(); setQuiz(false); toast(`Risk profile updated: ${r.result.profile} (${r.result.rounded}/5)`); }, onError: error });
  const remove = useMutation({ mutationFn: () => api.del("/profile", { password: del }), onSuccess: () => { logout(); nav("/"); }, onError: error });

  if (q.isLoading || !f) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data!.profile;
  const set = (k: string) => (v: number | undefined) => setF({ ...f, [k]: v });

  return (
    <div className="space-y-6">
      <PageHeader title="Profile & settings" subtitle="These details drive your budget sizing, recommendations and what the AI advisors know about you." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Financial profile" action={<Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Age"><NumInput value={f.age} onChange={set("age")} step="1" /></Field>
            <Field label="Planned retirement age"><NumInput value={f.retirementAge} onChange={set("retirementAge")} step="1" /></Field>
            <Field label="Monthly income (after tax)"><NumInput prefix="$" value={f.monthlyIncome} onChange={set("monthlyIncome")} /></Field>
            <Field label="Typical monthly spending"><NumInput prefix="$" value={f.monthlyExpenses} onChange={set("monthlyExpenses")} /></Field>
            <Field label="Savings & investments"><NumInput prefix="$" value={f.currentSavings} onChange={set("currentSavings")} /></Field>
            <Field label="Total debt"><NumInput prefix="$" value={f.totalDebt} onChange={set("totalDebt")} /></Field>
            <Field label="Dependents"><NumInput value={f.dependents} onChange={set("dependents")} step="1" min={0} /></Field>
          </div>
          <Field label="Goals" className="mt-4">
            <div className="flex flex-wrap gap-2">{GOALS.map((g) => { const on = f.goals?.includes(g); return <button key={g} type="button" aria-pressed={on} onClick={() => setF({ ...f, goals: on ? f.goals.filter((x: string) => x !== g) : [...(f.goals ?? []), g] })} className={cn("cursor-pointer rounded-full border px-3 py-1 text-sm transition", on ? "border-brand bg-brand-soft font-medium text-brand" : "border-line hover:bg-surface2")}>{g}</button>; })}</div>
          </Field>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card title="Risk profile" action={<Gauge className="size-4 text-brand" />}>
            {p.risk_score ? (
              <div><div className="flex items-end gap-3"><span className="tabular text-4xl font-semibold">{p.risk_score}<span className="text-lg text-muted">/5</span></span><Badge tone="brand" className="mb-1.5 capitalize">{p.risk_profile}</Badge></div>
                <div className="mt-3 flex gap-1">{[1, 2, 3, 4, 5].map((i) => <span key={i} className={cn("h-2 flex-1 rounded-full", i <= p.risk_score! ? "bg-brand" : "bg-surface2")} />)}</div></div>
            ) : <Callout tone="warn" title="Not assessed yet">Take the six-question quiz so fund and stock picks match your comfort with risk.</Callout>}
            <Button variant="secondary" className="mt-4 w-full" onClick={() => { setAnswers({}); setQuiz(true); }}>{p.risk_score ? "Retake questionnaire" : "Take the questionnaire"}</Button>
          </Card>
          <Card title="Account">
            <div className="space-y-4">
              <Field label="Email"><Input value={user?.email} disabled /></Field>
              <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
                <Field label="New password"><Input type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field></div>
              <Button variant="secondary" loading={acct.isPending} onClick={() => acct.mutate()}>Update account</Button>
            </div>
          </Card>
          {user?.role !== "admin" && (
            <Card title="Danger zone" action={<ShieldAlert className="size-4 text-neg" />}>
              <p className="text-sm text-muted">Deleting your account permanently removes your budget, goals, portfolio, will draft and chat history.</p>
              <Button variant="danger" size="sm" className="mt-3" onClick={() => setDel("")}>Delete my account</Button>
            </Card>
          )}
        </div>
      </div>

      <Modal open={quiz} onClose={() => setQuiz(false)} wide title="Risk questionnaire" footer={<><Button variant="secondary" onClick={() => setQuiz(false)}>Cancel</Button><Button loading={risk.isPending} disabled={Object.keys(answers).length < 3} onClick={() => risk.mutate()}>Save result</Button></>}>
        <div className="space-y-5">{qs.data?.questions.map((qq, i) => (
          <fieldset key={qq.id}><legend className="mb-2 text-sm font-medium">{i + 1}. {qq.text}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">{qq.options.map((o) => <label key={o.score} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", answers[qq.id] === o.score ? "border-brand bg-brand-soft" : "border-line hover:bg-surface2")}><input type="radio" name={qq.id} checked={answers[qq.id] === o.score} onChange={() => setAnswers({ ...answers, [qq.id]: o.score })} className="accent-[var(--c-brand)]" />{o.label}</label>)}</div></fieldset>))}
        </div>
      </Modal>
      <Modal open={del !== null} onClose={() => setDel(null)} title="Delete account" footer={<><Button variant="secondary" onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} disabled={!del} onClick={() => remove.mutate()}>Delete forever</Button></>}>
        <Field label="Enter your password to confirm"><Input type="password" value={del ?? ""} onChange={(e) => setDel(e.target.value)} autoComplete="current-password" /></Field>
      </Modal>
    </div>
  );
}
