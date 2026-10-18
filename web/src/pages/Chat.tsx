import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Copy, History, Loader2, MessageSquarePlus, SendHorizontal, Sparkles, Square, Trash2, User, Wrench, AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSearchParams } from "react-router-dom";
import { Badge, Callout, PageLoader, cn, useToast } from "../components/ui";
import { api, ApiError, streamChat } from "../lib/api";
import { timeAgo } from "../lib/format";

type AgentId = "personal" | "investment" | "wealth";
interface AgentInfo { id: AgentId; name: string; tagline: string; focus: string; color: string; starters: string[]; tools: { name: string; title: string; description: string }[] }
interface ToolChip { id: string; name: string; title: string; ok?: boolean; ms?: number; pending?: boolean }
interface Msg { key: string; role: "user" | "assistant"; content: string; tools: ToolChip[]; streaming?: boolean; error?: boolean }

/** Natural next questions, keyed by the tool that just ran — so the conversation never hits a dead end. */
const FOLLOW: Record<string, string[]> = {
  analyze_budget: ["Which of my expenses can I cut without hurting my lifestyle?", "How much should I be saving each month?"],
  recommend_savings: ["Help me plan for a $25,000 goal in 3 years", "Where is my money going this month?"],
  plan_goal: ["How should I invest money for this goal?", "What if I could save $200 more a month?"],
  assess_risk: ["Which mutual funds suit my risk profile?", "How should my portfolio be split between stocks and bonds?"],
  optimize_expenses: ["What would saving that much do for my retirement?", "Review my budget for this month"],
  recommend_stocks: ["Is my portfolio too concentrated?", "Which sectors look strongest right now?"],
  match_mutual_funds: ["Review my portfolio — is it diversified?", "How do fees affect my returns over 20 years?"],
  analyze_portfolio: ["Suggest funds that would diversify it", "What's the market doing today?"],
  market_insight: ["Which sectors should I lean toward?", "Suggest stocks that fit my risk profile"],
  analyze_sectors: ["Which stocks fit those sectors and my risk?", "Review my portfolio"],
  plan_retirement: ["Project my wealth over the next 25 years", "How can I invest more tax-efficiently?"],
  optimize_taxes: ["Am I on track to retire at my target age?", "Do I have enough life insurance?"],
  project_wealth: ["Am I on track to retire at 62?", "What if I increase my contributions by 3% a year?"],
  assess_insurance: ["Help me think through my will and beneficiaries", "How much emergency fund do I need?"],
  estate_planning: ["Do I have enough life insurance?", "Am I on track to retire comfortably?"],
};
const followUps = (tools: ToolChip[]) => [...new Set(tools.flatMap((t) => FOLLOW[t.name] ?? []))].slice(0, 3);

const uid = () => Math.random().toString(36).slice(2);

export default function Chat() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { error: toastError, confirm } = useToast();
  const info = useQuery({ queryKey: ["chat-agents"], queryFn: () => api.get<{ mode: "live" | "demo"; enabled: boolean; model: string | null; agents: AgentInfo[] }>("/chat/agents") });
  const [agentId, setAgentId] = useState<AgentId>((params.get("agent") as AgentId) || "personal");
  const [convId, setConvId] = useState<number | undefined>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  const convs = useQuery({ queryKey: ["chat-convs", agentId], queryFn: () => api.get<{ conversations: { id: number; title: string; updatedAt: string }[] }>(`/chat/conversations?agent=${agentId}`) });
  const agent = info.data?.agents.find((a) => a.id === agentId);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  const reset = useCallback((a?: AgentId) => { abort.current?.abort(); setConvId(undefined); setMsgs([]); setBusy(false); if (a) setAgentId(a); }, []);

  const load = async (id: number) => {
    try {
      const r = await api.get<{ messages: any[] }>(`/chat/conversations/${id}`);
      setConvId(id); setShowHistory(false);
      setMsgs(r.messages.map((m) => ({ key: String(m.id), role: m.role, content: m.content, error: m.mode === "error", tools: (m.tools ?? []).map((t: any) => ({ id: uid(), name: t.name, title: t.title, ok: t.ok, ms: t.ms })) })));
    } catch (e) { toastError(e); }
  };

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput(""); setBusy(true);
    const aKey = uid();
    setMsgs((m) => [...m, { key: uid(), role: "user", content: t, tools: [] }, { key: aKey, role: "assistant", content: "", tools: [], streaming: true }]);
    const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.key === aKey ? fn(m) : m)));
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await streamChat({ agent: agentId, conversationId: convId, message: t }, (e) => {
        if (e.type === "start") setConvId(e.conversationId);
        else if (e.type === "tool_start") patch((m) => ({ ...m, tools: [...m.tools, { id: e.id, name: e.name, title: e.title, pending: true }] }));
        else if (e.type === "tool_result") patch((m) => ({ ...m, tools: m.tools.map((x) => (x.id === e.id ? { ...x, pending: false, ok: e.ok, ms: e.ms } : x)) }));
        else if (e.type === "text") patch((m) => ({ ...m, content: m.content + e.delta }));
        else if (e.type === "done") patch((m) => ({ ...m, streaming: false, error: e.mode === "error" }));
      }, ctl.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, content: m.content || (e instanceof ApiError ? e.message : "Couldn't reach the server."), error: true }));
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["chat-convs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    }
  }, [agentId, convId, busy, qc]);

  // `?agent=…&q=…` deep links (from the dashboard / fund pages) auto-send once.
  useEffect(() => {
    const q = params.get("q");
    if (q && info.data && !autoSent.current) { autoSent.current = true; setParams({ agent: agentId }, { replace: true }); void send(q); }
  }, [info.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const del = async (id: number) => {
    if (!(await confirm({ title: "Delete conversation?", confirmLabel: "Delete", danger: true }))) return;
    await api.del(`/chat/conversations/${id}`).catch(toastError);
    if (id === convId) reset();
    qc.invalidateQueries({ queryKey: ["chat-convs"] });
  };

  if (info.isLoading) return <PageLoader />;
  const live = info.data?.mode === "live";

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[520px] flex-col gap-4 lg:h-[calc(100dvh-5rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">AI advisors</h1><p className="mt-1 text-sm text-muted">Three specialists with fifteen tools between them. They calculate on your real data, then explain.</p></div>
        <Badge tone={live ? "pos" : "warn"}>{live ? `Live · ${info.data?.model}` : "Offline demo mode"}</Badge>
      </div>
      {!live && <Callout tone="info" title="Running without an API key">Replies are generated by the same tools the Claude agent uses, matched to your question by keyword. Add <code className="rounded bg-surface2 px-1">ANTHROPIC_API_KEY</code> to the server to chat freely with Claude.</Callout>}
      {info.data && !info.data.enabled && <Callout tone="danger" title="The assistant is disabled">An administrator has switched the chatbot off.</Callout>}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[17rem_1fr]">
        <aside className={cn("min-h-0 flex-col gap-3 overflow-y-auto lg:flex", showHistory ? "flex" : "hidden")}>
          <div className="space-y-2">
            {info.data?.agents.map((a) => (
              <button key={a.id} onClick={() => reset(a.id)} aria-pressed={a.id === agentId}
                className={cn("flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition", a.id === agentId ? "border-brand bg-brand-soft/60" : "border-line bg-surface hover:bg-surface2")}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: a.color }}><Bot className="size-[18px]" /></span>
                <span className="min-w-0"><span className="block text-sm font-semibold leading-tight">{a.name.replace(" Agent", "")}</span><span className="block text-xs text-muted">{a.tagline}</span></span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between px-1 pt-1"><span className="text-xs font-semibold uppercase tracking-wide text-muted">History</span><button onClick={() => { reset(); setShowHistory(false); }} className="flex cursor-pointer items-center gap-1 text-xs font-medium text-brand hover:underline"><MessageSquarePlus className="size-3.5" />New chat</button></div>
          <ul className="space-y-1">
            {convs.data?.conversations.length === 0 && <li className="px-1 text-xs text-muted">No conversations yet.</li>}
            {convs.data?.conversations.map((c) => (
              <li key={c.id} className={cn("group flex items-center gap-1 rounded-lg pr-1", c.id === convId ? "bg-surface2" : "hover:bg-surface2/70")}>
                <button onClick={() => load(c.id)} className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left"><span className="block truncate text-sm">{c.title}</span><span className="text-xs text-muted">{timeAgo(c.updatedAt)}</span></button>
                <button onClick={() => del(c.id)} aria-label="Delete conversation" className="cursor-pointer rounded p-1.5 text-muted opacity-0 hover:text-neg focus:opacity-100 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
              </li>))}
          </ul>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg text-white" style={{ background: agent?.color }}><Bot className="size-4" /></span><div><div className="text-sm font-semibold leading-tight">{agent?.name}</div><div className="text-xs text-muted">{agent?.tools.length} tools: {agent?.tools.map((t) => t.title).join(" · ")}</div></div></div>
            <button className="cursor-pointer rounded-lg p-2 text-muted hover:bg-surface2 lg:hidden" onClick={() => setShowHistory((s) => !s)} aria-label="Toggle history"><History className="size-5" /></button>
          </header>

          <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5" aria-live="polite">
            {msgs.length === 0 && (
              <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
                <span className="grid size-14 place-items-center rounded-2xl text-white" style={{ background: agent?.color }}><Sparkles className="size-7" /></span>
                <h2 className="mt-4 font-display text-xl font-semibold">How can I help with your money?</h2>
                <p className="mt-1 text-sm text-muted">I work from your profile, budget and portfolio. Try one of these:</p>
                <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">{agent?.starters.map((s) => <button key={s} onClick={() => send(s)} className="cursor-pointer rounded-xl border border-line p-3 text-left text-sm transition hover:border-brand hover:bg-brand-soft/50">{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => <Bubble key={m.key} m={m} color={agent?.color} suggestions={i === msgs.length - 1 && !busy && m.role === "assistant" && !m.error ? (followUps(m.tools).length ? followUps(m.tools) : ["Explain that more simply", "What should I do first?"]) : []} onAsk={(t) => void send(t)} />)}
          </div>

          <form className="border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <div className="flex items-end gap-2 rounded-xl border border-line bg-bg p-2 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/25">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={4000} aria-label="Message"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                placeholder={`Ask the ${agent?.name.replace(" Agent", "")} agent…`} className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted/60" />
              {busy ? <button type="button" onClick={() => abort.current?.abort()} className="grid size-9 cursor-pointer place-items-center rounded-lg bg-surface2 text-text hover:bg-line" aria-label="Stop"><Square className="size-4" /></button>
                : <button type="submit" disabled={!input.trim()} className="grid size-9 cursor-pointer place-items-center rounded-lg bg-brand text-white transition hover:bg-brand-strong disabled:opacity-40 [[data-theme=dark]_&]:text-ink" aria-label="Send"><SendHorizontal className="size-4" /></button>}
            </div>
            <p className="mt-2 text-center text-[0.7rem] text-muted">Educational guidance, not licensed financial advice. Market data in Finvara is simulated.</p>
          </form>
        </section>
      </div>
    </div>
  );
}

function Bubble({ m, color, suggestions = [], onAsk }: { m: Msg; color?: string; suggestions?: string[]; onAsk?: (t: string) => void }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") return (
    <div className="fade-up flex justify-end gap-2.5"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-brand px-4 py-2.5 text-sm text-white [[data-theme=dark]_&]:text-ink">{m.content}</div><span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface2 text-muted"><User className="size-4" /></span></div>
  );
  return (
    <div className="fade-up flex gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full text-white" style={{ background: color }}><Bot className="size-4" /></span>
      <div className="min-w-0 max-w-[92%] flex-1">
        {m.tools.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">{m.tools.map((t) => (
            <span key={t.id} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", t.pending ? "border-brand/40 bg-brand-soft text-brand" : t.ok === false ? "border-neg/40 text-neg" : "border-line text-muted")}>
              {t.pending ? <Loader2 className="size-3 animate-spin" /> : t.ok === false ? <AlertTriangle className="size-3" /> : <Check className="size-3 text-pos" />}<Wrench className="size-3" />{t.title}{t.ms != null && !t.pending && <span className="tabular opacity-70">{t.ms}ms</span>}
            </span>))}</div>
        )}
        <div className={cn("rounded-2xl rounded-tl-md border px-4 py-3", m.error ? "border-neg/40 bg-neg/5" : "border-line bg-surface2/50")}>
          {m.content ? <div className={cn("prose-chat", m.streaming && "caret")}><Markdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}>{m.content}</Markdown></div>
            : <span className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />{m.tools.some((t) => t.pending) ? "Running calculations…" : "Thinking…"}</span>}
        </div>
        {m.content && !m.streaming && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button onClick={() => { void navigator.clipboard?.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface2 hover:text-text" aria-label="Copy reply">{copied ? <Check className="size-3.5 text-pos" /> : <Copy className="size-3.5" />}{copied ? "Copied" : "Copy"}</button>
            {suggestions.map((t) => <button key={t} onClick={() => onAsk?.(t)} className="cursor-pointer rounded-full border border-line px-3 py-1 text-xs transition hover:border-brand hover:bg-brand-soft/50">{t}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}
