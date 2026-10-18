import { ArrowRight, Bot, CandlestickChart, PieChart, ScrollText, ShieldCheck, Sparkles, Target, Wallet } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";
import { Button, useToast } from "../components/ui";
import { Spark } from "../components/charts";

const FEATURES = [
  { icon: Wallet, title: "Budgeting that explains itself", body: "Track spending against a plan, import your bank CSV, auto-detect subscriptions and bills, and see where the gaps are in plain language." },
  { icon: Target, title: "Goal & retirement planner", body: "Turn “buy a home in 5 years” into a monthly number — and see the real chance your retirement plan works across 1,000 simulated markets." },
  { icon: ScrollText, title: "Guided will writing", body: "Answer questions about assets, beneficiaries and guardians; download a clean document to sign and notarise." },
  { icon: PieChart, title: "Mutual fund research", body: "Screen, compare side by side, and build a blended portfolio with live risk, cost and allocation read-outs." },
  { icon: CandlestickChart, title: "Stock screening", body: "Gainers, losers, sector heat-maps and valuation filters — with picks scored against your own risk profile." },
  { icon: ShieldCheck, title: "Admin control room", body: "User management, curated content, recommendation weights and full chatbot monitoring." },
];

const AGENTS = [
  { name: "Personal Finance", color: "#0d9488", tools: ["Budget analysis", "Savings recommendation", "Goal planning", "Risk assessment", "Expense optimization"] },
  { name: "Investment Advisory", color: "#4f46e5", tools: ["Stock recommendation", "Mutual fund matching", "Portfolio analysis", "Market insight", "Sector analysis"] },
  { name: "Wealth & Retirement", color: "#b45309", tools: ["Retirement planning", "Tax optimization", "Wealth projection", "Insurance needs", "Estate planning"] },
];

export default function Landing() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { error } = useToast();
  const [busy, setBusy] = useState(false);
  const demo = async () => {
    setBusy(true);
    try { await login("demo@finvara.app", "Demo1234!"); nav("/dashboard"); } catch (e) { error(e); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <a href="#features" className="hidden px-3 py-2 text-muted hover:text-text sm:block">Features</a>
          <a href="#agents" className="hidden px-3 py-2 text-muted hover:text-text sm:block">AI advisors</a>
          <Link to="/calculators" className="hidden px-3 py-2 text-muted hover:text-text sm:block">Free calculators</Link>
          <Link to="/login" className="px-3 py-2 font-medium hover:text-brand">Sign in</Link>
          <Link to="/signup"><Button size="sm">Get started</Button></Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 lg:grid-cols-[1.1fr_0.9fr] lg:pt-16">
        <div className="fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted"><Sparkles className="size-3.5 text-accent" />Three AI advisors · fifteen financial tools</span>
          <h1 className="font-display mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">Know where your money goes — and where it could go next.</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">Finvara brings budgeting, goal planning, fund and stock research, will writing and a team of AI advisors into one calm workspace.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup"><Button size="lg" icon={<ArrowRight className="size-5" />} className="flex-row-reverse">Create free account</Button></Link>
            <Button size="lg" variant="secondary" loading={busy} onClick={demo}>Explore the live demo</Button>
          </div>
          <p className="mt-4 text-xs text-muted">The demo account comes pre-filled with six months of data. Market data is simulated. Or <Link to="/calculators" className="font-medium text-brand hover:underline">try the free calculators</Link> — no sign-up.</p>
        </div>

        <div className="fade-up relative" style={{ animationDelay: "120ms" }} aria-hidden>
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-brand/15 via-transparent to-accent/15 blur-2xl" />
          <div className="rounded-3xl border border-line bg-surface p-6 shadow-xl">
            <div className="flex items-center justify-between text-xs text-muted"><span>Net worth</span><span className="rounded-full bg-pos/12 px-2 py-0.5 font-medium text-pos">+4.2% this quarter</span></div>
            <div className="tabular mt-1 text-4xl font-semibold tracking-tight">$55,825</div>
            <div className="-mx-2 mt-2"><Spark height={80} data={[31, 33, 32, 36, 35, 39, 41, 40, 44, 47, 46, 52, 55]} /></div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
              {[["Savings rate", "49%"], ["Budget used", "75%"], ["Goal on track", "2 / 3"]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-surface2 p-3"><div className="text-muted">{k}</div><div className="tabular mt-1 text-lg font-semibold">{v}</div></div>
              ))}
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand/25 bg-brand-soft/60 p-3 text-sm">
              <Bot className="mt-0.5 size-4 shrink-0 text-brand" />
              <p><span className="font-medium">Advisor:</span> Dining is 23% above plan. Trimming it to budget frees about <b>$150/month</b> toward your down payment.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-y border-line bg-surface/60 py-20">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Everything in one place</h2>
          <p className="mt-2 max-w-xl text-muted">From the first coffee you track to the will you leave behind.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><f.icon className="size-5" /></div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="agents" className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Three specialists, one conversation</h2>
        <p className="mt-2 max-w-2xl text-muted">Each advisor is a Claude-powered agent with its own focus and its own toolbox. They call real calculators on your data instead of guessing.</p>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {AGENTS.map((a) => (
            <div key={a.name} className="rounded-2xl border border-line bg-surface p-6">
              <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl text-white" style={{ background: a.color }}><Bot className="size-5" /></span><h3 className="font-semibold">{a.name}</h3></div>
              <ul className="mt-4 space-y-2 text-sm">
                {a.tools.map((t, i) => <li key={t} className="flex items-center gap-2 text-muted"><span className="tabular grid size-5 place-items-center rounded-full bg-surface2 text-[0.65rem] font-semibold">{i + 1}</span>{t}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="rounded-3xl bg-ink px-8 py-14 text-center text-white">
          <h2 className="font-display text-3xl font-semibold sm:text-4xl">Give your money a plan.</h2>
          <p className="mx-auto mt-3 max-w-lg text-white/70">Set up takes two minutes: your income, your goals and a short risk questionnaire.</p>
          <div className="mt-7 flex justify-center gap-3"><Link to="/signup"><Button size="lg" variant="accent">Get started — it's free</Button></Link></div>
        </div>
      </section>

      <footer className="border-t border-line py-8 text-center text-xs text-muted">
        <p>© {new Date().getFullYear()} Finvara. A portfolio project — educational guidance only, not financial, tax or legal advice. All market data is simulated.</p>
      </footer>
    </div>
  );
}
