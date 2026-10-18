import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";
import { Button, Callout, Field, Input } from "../components/ui";

function Shell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  const pub = useQuery({ queryKey: ["public"], queryFn: () => api.get<{ announcement: string }>("/public") });
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <Link to="/" className="mb-10 inline-block w-fit"><Logo /></Link>
        <div className="mx-auto w-full max-w-sm">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          {pub.data?.announcement && <div className="mt-4"><Callout tone="info">{pub.data.announcement}</Callout></div>}
          <div className="mt-6">{children}</div>
          <p className="mt-6 text-center text-sm text-muted">{footer}</p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-ink lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_20%,rgba(45,212,191,0.25),transparent),radial-gradient(50%_40%_at_80%_80%,rgba(251,191,36,0.18),transparent)]" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <p className="font-display text-4xl font-semibold leading-tight">“A plan beats a guess — every time, with every dollar.”</p>
          <p className="mt-4 max-w-md text-white/65">Budgeting, planning, investing research and three AI advisors that call real calculators on your numbers.</p>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const go = async (e: string, p: string) => {
    setBusy(true); setErr(undefined);
    try { const u = await login(e, p); nav(loc.state?.from ?? (u.role === "admin" ? "/admin" : "/dashboard"), { replace: true }); }
    catch (x) { setErr(x instanceof ApiError ? x.message : "Couldn't sign in"); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void go(email, password); };

  return (
    <Shell title="Welcome back" subtitle="Sign in to your Finvara workspace." footer={<>New here? <Link to="/signup" className="font-medium text-brand hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <p className="text-sm text-neg" role="alert">{err}</p>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>Sign in</Button>
      </form>
      <div className="mt-5 rounded-xl border border-dashed border-line p-3 text-sm">
        <p className="font-medium">Just looking around?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => go("demo@finvara.app", "Demo1234!")}>Use demo account</Button>
          <Button variant="ghost" size="sm" onClick={() => go("admin@finvara.app", "Admin123!")}>Demo admin</Button>
        </div>
      </div>
    </Shell>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState<ApiError | string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(undefined);
    try { await signup(f.name, f.email, f.password); nav("/onboarding", { replace: true }); }
    catch (x) { setErr(x instanceof ApiError ? x : "Couldn't create account"); } finally { setBusy(false); }
  };
  const fields = err instanceof ApiError ? err.fields : {};
  return (
    <Shell title="Create your account" subtitle="Two minutes to a personalised plan." footer={<>Already have an account? <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" error={fields.name}><Input required autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email" error={fields.email}><Input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password" hint="At least 8 characters" error={fields.password}><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {err && !Object.keys(fields).length && <p className="text-sm text-neg" role="alert">{typeof err === "string" ? err : err.message}</p>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>Create account</Button>
      </form>
    </Shell>
  );
}
