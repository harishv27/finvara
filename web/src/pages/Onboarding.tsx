import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { Button, Card, Field, NumInput, PageLoader, Progress, cn, useToast } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

const GOALS = ["Buy a home", "Retire comfortably", "Build an emergency fund", "Pay off debt", "Fund education", "Grow wealth", "Travel", "Generate passive income"];
type Q = { id: string; text: string; options: { label: string; score: number }[] };

/** Two essentials first, optional detail second, then one risk question per screen (tap to answer, auto-advances). */
export default function Onboarding() {
  const nav = useNavigate();
  const { refresh, user } = useAuth();
  const { error, toast } = useToast();
  const [step, setStep] = useState(0);
  const [qi, setQi] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<{ age?: number; monthlyIncome?: number; monthlyExpenses?: number; dependents?: number; retirementAge?: number; currentSavings?: number; totalDebt?: number; goals: string[] }>({ retirementAge: 65, dependents: 0, goals: [] });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const advance = useRef<ReturnType<typeof setTimeout>>(undefined);
  const q = useQuery({ queryKey: ["risk-questions"], queryFn: () => api.get<{ questions: Q[] }>("/profile/risk-questions") });
  useEffect(() => () => clearTimeout(advance.current), []);

  const valid0 = !!f.age && f.age >= 16 && f.age <= 100 && !!f.monthlyIncome && f.monthlyIncome > 0;
  const questions = q.data?.questions ?? [];
  const answered = Object.keys(answers).length;

  const finish = async (withRisk: boolean) => {
    setBusy(true);
    try {
      // drop untouched optional fields so the server keeps its defaults
      await api.post("/profile/onboarding", Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
      if (withRisk && answered >= 3) await api.post("/profile/risk", { answers });
      await refresh();
      toast("You're all set — welcome to Finvara!");
      nav("/dashboard", { replace: true });
    } catch (e) { error(e instanceof ApiError ? e : e); } finally { setBusy(false); }
  };

  const pick = (qid: string, score: number) => {
    setAnswers((a) => ({ ...a, [qid]: score }));
    clearTimeout(advance.current);
    advance.current = setTimeout(() => setQi((i) => Math.min(questions.length, i + 1)), 220);
  };

  const titles = ["The basics", "Your money", "Your comfort with risk"];
  const total = 2 + (questions.length || 6);
  const progress = step === 0 ? 1 : step === 1 ? 2 : 2 + Math.min(qi, questions.length);

  return (
    <div className="min-h-screen bg-bg px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center justify-between"><Logo /><span className="text-sm text-muted">Hi {user?.name.split(" ")[0]} 👋</span></div>
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted"><span>Step {Math.min(step + 1, 3)} of 3 · {titles[step]}</span><span>{step === 0 ? "About a minute" : step === 1 ? "Optional" : `${Math.min(qi + 1, questions.length)} / ${questions.length}`}</span></div>
        <Progress value={(progress / total) * 100} className="mb-6" label="Onboarding progress" />

        <Card>
          {step === 0 && (
            <div className="space-y-5">
              <div><h1 className="font-display text-2xl font-semibold">Let's start with two numbers</h1><p className="mt-1 text-sm text-muted">That's all we need to size your first budget and plan. Everything else can wait.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your age" error={f.age != null && (f.age < 16 || f.age > 100) ? "Enter an age between 16 and 100" : undefined}><NumInput value={f.age} onChange={(v) => setF({ ...f, age: v })} min={16} max={100} step="1" placeholder="e.g. 34" /></Field>
                <Field label="Monthly income after tax" hint="A rough figure is fine"><NumInput prefix="$" value={f.monthlyIncome} onChange={(v) => setF({ ...f, monthlyIncome: v })} min={0} placeholder="e.g. 5,000" /></Field>
              </div>
              <p className="flex items-start gap-2 rounded-xl bg-surface2 p-3 text-xs text-muted"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Your details stay in your account, are never sold, and you can edit or delete everything later in Profile.</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div><h1 className="font-display text-2xl font-semibold">A bit more helps — skip what you don't know</h1><p className="mt-1 text-sm text-muted">These sharpen your net worth, retirement and savings advice.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Typical monthly spending"><NumInput prefix="$" value={f.monthlyExpenses} onChange={(v) => setF({ ...f, monthlyExpenses: v })} min={0} placeholder="e.g. 3,200" /></Field>
                <Field label="Savings & investments"><NumInput prefix="$" value={f.currentSavings} onChange={(v) => setF({ ...f, currentSavings: v })} min={0} placeholder="e.g. 18,000" /></Field>
                <Field label="Total debt (loans, cards)"><NumInput prefix="$" value={f.totalDebt} onChange={(v) => setF({ ...f, totalDebt: v })} min={0} placeholder="0" /></Field>
                <Field label="People who depend on you" hint="0–20"><NumInput value={f.dependents} onChange={(v) => setF({ ...f, dependents: v })} min={0} max={20} step="1" /></Field>
                <Field label="Planned retirement age"><NumInput value={f.retirementAge} onChange={(v) => setF({ ...f, retirementAge: v })} min={40} max={90} step="1" /></Field>
              </div>
              <Field label="What are you working toward? (pick any)">
                <div className="flex flex-wrap gap-2">
                  {GOALS.map((g) => { const on = f.goals.includes(g); return (
                    <button key={g} type="button" aria-pressed={on} onClick={() => setF({ ...f, goals: on ? f.goals.filter((x) => x !== g) : [...f.goals, g] })}
                      className={cn("cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition", on ? "border-brand bg-brand-soft font-medium text-brand" : "border-line hover:bg-surface2")}>{on && <Check className="mr-1 inline size-3.5" />}{g}</button>); })}
                </div>
              </Field>
            </div>
          )}

          {step === 2 && (q.isLoading ? <PageLoader /> : qi < questions.length ? (
            <fieldset className="space-y-4">
              <legend className="font-display text-xl font-semibold leading-snug">{questions[qi].text}</legend>
              <p className="text-sm text-muted">Tap the closest answer — there are no wrong ones.</p>
              <div className="grid gap-2">
                {questions[qi].options.map((o) => (
                  <label key={o.score} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition", answers[questions[qi].id] === o.score ? "border-brand bg-brand-soft font-medium" : "border-line hover:border-brand/50 hover:bg-surface2")}>
                    <input type="radio" name={questions[qi].id} className="size-4 accent-[var(--c-brand)]" checked={answers[questions[qi].id] === o.score} onChange={() => pick(questions[qi].id, o.score)} />{o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <div className="space-y-3 py-4 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-pos/15 text-pos"><Check className="size-7" /></span>
              <h1 className="font-display text-2xl font-semibold">You're ready</h1>
              <p className="text-sm text-muted">We'll use your answers to match funds and stocks to your comfort with risk. You can retake the quiz any time.</p>
            </div>
          ))}

          <div className="mt-7 flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => (step === 2 && qi > 0 ? setQi(qi - 1) : setStep(Math.max(0, step - 1)))} disabled={step === 0} icon={<ArrowLeft className="size-4" />}>Back</Button>
            {step === 0 && <Button onClick={() => setStep(1)} disabled={!valid0} icon={<ArrowRight className="size-4" />} className="flex-row-reverse">Continue</Button>}
            {step === 1 && <div className="flex gap-2"><Button variant="ghost" onClick={() => finish(false)} loading={busy}>Skip & finish</Button><Button onClick={() => setStep(2)} icon={<ArrowRight className="size-4" />} className="flex-row-reverse">Continue</Button></div>}
            {step === 2 && (qi < questions.length
              ? <Button variant="ghost" onClick={() => finish(false)} loading={busy}>Skip for now</Button>
              : <Button onClick={() => finish(true)} loading={busy} size="lg">Go to my dashboard</Button>)}
          </div>
        </Card>
      </div>
    </div>
  );
}
