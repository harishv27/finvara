import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bars } from "../../components/charts";
import { Badge, Button, Card, ErrorBox, Modal, PageLoader, Select, Td, Th, cn } from "../../components/ui";
import { api } from "../../lib/api";
import { dateShort, dateTime, num, pct, timeAgo } from "../../lib/format";

const AGENT = { personal: "Personal Finance", investment: "Investment Advisory", wealth: "Wealth & Retirement" } as const;

export function ChatMonitor() {
  const stats = useQuery({ queryKey: ["admin", "chat-stats"], queryFn: () => api.get<any>("/admin/chat/stats"), refetchInterval: 20_000 });
  const [page, setPage] = useState(1);
  const [agent, setAgent] = useState("");
  const convs = useQuery({ queryKey: ["admin", "chat-convs", page, agent], queryFn: () => api.get<any>(`/admin/chat/conversations?page=${page}&agent=${agent}`) });
  const [open, setOpen] = useState<number | null>(null);
  if (stats.isLoading) return <PageLoader />;
  if (stats.error) return <ErrorBox error={stats.error} />;
  const s = stats.data;
  const maxCalls = Math.max(1, ...s.tools.map((t: any) => t.calls));
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Replies per day" subtitle="Assistant messages and errors, last 14 days">
          <Bars data={s.daily} xKey="day" xFmt={dateShort} fmt={(n) => String(n)} height={210} series={[{ key: "messages", label: "Replies", color: "#4f46e5" }, { key: "errors", label: "Errors", color: "#b91c1c" }]} />
          <div className="mt-2 flex flex-wrap gap-2">{s.modes.map((m: any) => <Badge key={m.mode} tone={m.mode === "error" ? "neg" : m.mode === "live" ? "pos" : "warn"}>{m.mode}: {m.n}</Badge>)}</div>
        </Card>
        <Card pad={false} className="lg:col-span-3" title="Tool usage" subtitle="All 15 tools across the three agents">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="border-b border-line"><tr><Th>Tool</Th><Th>Agent</Th><Th className="min-w-28">Calls</Th><Th className="text-right">Success</Th><Th className="text-right">Avg</Th></tr></thead>
            <tbody>{s.tools.map((t: any) => (
              <tr key={t.tool} className="border-b border-line last:border-0">
                <Td><div className="font-medium">{t.title}</div><div className="font-mono text-[0.7rem] text-muted">{t.tool}</div></Td>
                <Td className="text-xs text-muted">{AGENT[t.agent as keyof typeof AGENT]}</Td>
                <Td><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-brand" style={{ width: `${(t.calls / maxCalls) * 100}%` }} /></div><span className="tabular text-xs">{t.calls}</span></div></Td>
                <Td className={cn("tabular text-right", t.successRate != null && t.successRate < 0.9 && "text-neg")}>{t.successRate == null ? "—" : pct(t.successRate * 100, 0)}</Td>
                <Td className="tabular text-right text-muted">{t.avgMs == null ? "—" : `${t.avgMs} ms`}</Td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      </div>

      {s.errors.length > 0 && (
        <Card title="Recent errors">
          <ul className="divide-y divide-line text-sm">{s.errors.map((e: any) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0 flex-1 truncate">{e.content}</span><span className="text-xs text-muted">{e.email} · {timeAgo(e.createdAt)}</span></li>)}</ul>
        </Card>
      )}

      <Card pad={false} title="Conversations" action={<Select aria-label="Filter by agent" className="!w-48 !py-1.5 text-xs" value={agent} onChange={(e) => { setAgent(e.target.value); setPage(1); }}><option value="">All agents</option>{Object.entries(AGENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}>
        {!convs.data ? <PageLoader /> : (
          <>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px]">
              <thead className="border-b border-line"><tr><Th>Conversation</Th><Th>Agent</Th><Th>User</Th><Th className="text-right">Msgs</Th><Th className="text-right">Tools</Th><Th className="text-right">Errors</Th><Th>Updated</Th></tr></thead>
              <tbody>{convs.data.conversations.map((c: any) => (
                <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface2/60">
                  <Td className="max-w-[18rem] truncate font-medium">{c.title}</Td><Td className="text-xs text-muted">{AGENT[c.agent as keyof typeof AGENT]}</Td><Td className="text-xs text-muted">{c.email}</Td>
                  <Td className="tabular text-right">{c.messages}</Td><Td className="tabular text-right">{c.toolCalls}</Td><Td className={cn("tabular text-right", c.errors && "font-semibold text-neg")}>{c.errors}</Td><Td className="whitespace-nowrap text-xs text-muted">{timeAgo(c.updatedAt)}</Td>
                </tr>))}</tbody>
            </table></div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-muted">{num(convs.data.total)} conversations · page {convs.data.page} of {convs.data.pages}</span><Button size="sm" variant="secondary" disabled={page >= convs.data.pages} onClick={() => setPage(page + 1)}>Next</Button></div>
          </>
        )}
      </Card>
      <Transcript id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Transcript({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useQuery({ enabled: id != null, queryKey: ["admin", "transcript", id], queryFn: () => api.get<any>(`/admin/chat/conversations/${id}`) });
  const d = q.data;
  return (
    <Modal open={id != null} onClose={onClose} wide title={d ? `${d.conversation.title}` : "Transcript"}>
      {!d ? <PageLoader /> : (
        <div className="space-y-4">
          <p className="text-xs text-muted">{AGENT[d.conversation.agent as keyof typeof AGENT]} · {d.conversation.email}</p>
          {d.messages.map((m: any) => (
            <div key={m.id} className={cn("rounded-xl border p-3", m.role === "user" ? "border-brand/30 bg-brand-soft/40" : m.mode === "error" ? "border-neg/40 bg-neg/5" : "border-line")}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted"><b className="text-text">{m.role === "user" ? "User" : "Assistant"}</b><span>{dateTime(m.createdAt)}</span>
                {m.role === "assistant" && <><Badge tone={m.mode === "live" ? "pos" : m.mode === "error" ? "neg" : "warn"}>{m.mode}</Badge><span className="tabular">{m.latencyMs} ms</span>{m.inputTokens > 0 && <span className="tabular">{num(m.inputTokens)} in / {num(m.outputTokens)} out tokens</span>}</>}</div>
              {m.role === "assistant" ? <div className="prose-chat"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div> : <p className="whitespace-pre-wrap text-sm">{m.content}</p>}
              {d.tools.filter((t: any) => t.messageId === m.id).map((t: any, i: number) => <ToolRow key={i} t={t} />)}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ToolRow({ t }: { t: any }) {
  const [open, setOpen] = useState(false);
  const pretty = (s: string) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
  return (
    <div className="mt-2 rounded-lg bg-surface2/70 text-xs">
      <button onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2" aria-expanded={open}><span className="flex items-center gap-2"><Bot className="size-3.5" /><b className="font-mono">{t.tool}</b><Badge tone={t.ok ? "pos" : "neg"}>{t.ok ? "ok" : "failed"}</Badge><span className="tabular text-muted">{t.ms} ms</span></span><ChevronDown className={cn("size-4 transition", open && "rotate-180")} /></button>
      {open && <div className="space-y-2 border-t border-line p-3"><div><p className="mb-1 font-semibold">Input</p><pre className="max-h-40 overflow-auto rounded bg-bg p-2">{pretty(t.input)}</pre></div><div><p className="mb-1 font-semibold">Output</p><pre className="max-h-64 overflow-auto rounded bg-bg p-2">{pretty(t.output)}</pre></div></div>}
    </div>
  );
}
