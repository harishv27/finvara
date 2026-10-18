import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bot, Database, Search, Settings2, Sliders, Users as UsersIcon } from "lucide-react";
import { useState } from "react";
import { Bars } from "../../components/charts";
import { Badge, Button, Callout, Card, ErrorBox, Field, Input, NumInput, PageHeader, PageLoader, Select, Stat, Tabs, Td, Textarea, Th, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { dateShort, num, timeAgo } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import { ChatMonitor } from "./ChatMonitor";
import { Content, Recommendations } from "./Content";

type TabId = "overview" | "users" | "content" | "recs" | "chat" | "settings";

export default function Admin() {
  const [tab, setTab] = useState<TabId>("overview");
  return (
    <div className="space-y-6">
      <PageHeader title="Admin" subtitle="Run the platform: people, content, recommendations, the chatbot and system settings." />
      <Tabs<TabId> value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Overview", icon: <Activity className="size-4" /> }, { id: "users", label: "Users", icon: <UsersIcon className="size-4" /> },
        { id: "content", label: "Funds & stocks", icon: <Database className="size-4" /> }, { id: "recs", label: "Recommendations", icon: <Sliders className="size-4" /> },
        { id: "chat", label: "Chatbot", icon: <Bot className="size-4" /> }, { id: "settings", label: "Settings", icon: <Settings2 className="size-4" /> },
      ]} />
      {tab === "overview" && <Overview />}
      {tab === "users" && <Users />}
      {tab === "content" && <Content />}
      {tab === "recs" && <Recommendations />}
      {tab === "chat" && <ChatMonitor />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api.get<any>("/admin/overview"), refetchInterval: 20_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  const o = q.data;
  const fmtDay = (d: string) => dateShort(d);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Users" value={num(o.users.total)} sub={`${o.users.active} active · ${o.users.new7d} new this week`} />
        <Stat label="Onboarded" value={`${o.users.total ? Math.round((o.users.onboarded / o.users.total) * 100) : 0}%`} sub={`${o.users.onboarded} completed setup`} />
        <Stat label="Conversations" value={num(o.chat.conversations)} sub={`${num(o.chat.userMessages)} user messages`} />
        <Stat label="Chat health" value={`${Math.round((1 - o.chat.errorRate) * 100)}% ok`} tone={o.chat.errorRate > 0.1 ? "neg" : "pos"} sub={`avg reply ${num(o.chat.avgLatencyMs)} ms`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Sign-ups" subtitle="Last 14 days"><Bars data={o.signups} xKey="day" xFmt={fmtDay} fmt={(n) => String(n)} series={[{ key: "n", label: "New users", color: "#0f766e" }]} height={200} /></Card>
        <Card title="Chat activity" subtitle="User messages per day"><Bars data={o.activity} xKey="day" xFmt={fmtDay} fmt={(n) => String(n)} series={[{ key: "n", label: "Messages", color: "#4f46e5" }]} height={200} /></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Platform content"><dl className="grid grid-cols-2 gap-3 text-sm">{[["Funds", o.content.funds], ["Stocks", o.content.stocks], ["Holdings", o.content.holdings], ["Transactions", o.content.transactions], ["Wills generated", o.content.wills]].map(([k, v]) => <div key={k} className="rounded-xl bg-surface2 p-3"><dt className="text-xs text-muted">{k}</dt><dd className="tabular text-lg font-semibold">{num(v)}</dd></div>)}</dl></Card>
        <Card title="Tokens used"><div className="space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted">Input</span><b className="tabular">{num(o.chat.inputTokens)}</b></div><div className="flex justify-between"><span className="text-muted">Output</span><b className="tabular">{num(o.chat.outputTokens)}</b></div>
          <div className="pt-2 text-xs text-muted">{o.system.aiMode === "live" ? "Live Claude calls only; demo mode uses no tokens." : "Demo mode is on, so no tokens are used."}</div></div></Card>
        <Card title="System"><dl className="space-y-2 text-sm">{[["AI mode", <Badge key="m" tone={o.system.aiMode === "live" ? "pos" : "warn"}>{o.system.aiMode}</Badge>], ["Model", o.system.model ?? "—"], ["Node", o.system.node], ["Uptime", `${Math.floor(o.system.uptimeSec / 60)} min`]].map(([k, v]) => <div key={k as string} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl></Card>
      </div>
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { toast, error, confirm } = useToast();
  const [f, setF] = useState({ q: "", role: "", page: 1 });
  const d = useDebounced(f, 300);
  const q = useQuery({ queryKey: ["admin", "users", d], queryFn: () => api.get<any>(`/admin/users?q=${encodeURIComponent(d.q)}&role=${d.role}&page=${d.page}`) });
  const patch = useMutation({ mutationFn: ({ id, ...b }: any) => api.patch(`/admin/users/${id}`, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast("User updated"); }, onError: error });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/admin/users/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast("User deleted"); }, onError: error });
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div className="relative min-w-60 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input className="pl-9" aria-label="Search users" placeholder="Search name or email" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} /></div>
        <Select aria-label="Role" className="!w-36" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, page: 1 })}><option value="">All roles</option><option value="user">Users</option><option value="admin">Admins</option></Select>
        <span className="text-sm text-muted">{q.data?.total ?? "…"} users</span>
      </div>
      {!q.data ? <PageLoader /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
          <thead className="border-b border-line"><tr><Th>User</Th><Th>Role</Th><Th>Status</Th><Th>Joined</Th><Th>Last login</Th><Th className="text-right">Chats</Th><Th className="text-right">Txns</Th><Th /></tr></thead>
          <tbody>{q.data.users.map((u: any) => (
            <tr key={u.id} className="border-b border-line last:border-0">
              <Td><div className="font-medium">{u.name}{u.id === me?.id && <span className="ml-1 text-xs text-muted">(you)</span>}</div><div className="text-xs text-muted">{u.email}</div></Td>
              <Td><Select aria-label={`Role of ${u.email}`} className="!w-24 !py-1 text-xs" value={u.role} disabled={u.id === me?.id} onChange={(e) => patch.mutate({ id: u.id, role: e.target.value })}><option value="user">user</option><option value="admin">admin</option></Select></Td>
              <Td><Badge tone={u.active ? "pos" : "neg"}>{u.active ? "Active" : "Deactivated"}</Badge>{!u.onboarded && u.role === "user" && <Badge className="ml-1">no profile</Badge>}</Td>
              <Td className="whitespace-nowrap text-muted">{dateShort(u.createdAt)}</Td><Td className="whitespace-nowrap text-muted">{timeAgo(u.lastLoginAt)}</Td>
              <Td className="tabular text-right">{u.conversations}</Td><Td className="tabular text-right">{u.transactions}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" disabled={u.id === me?.id} onClick={() => patch.mutate({ id: u.id, active: !u.active })}>{u.active ? "Deactivate" : "Reactivate"}</Button>
                <Button size="sm" variant="ghost" disabled={u.id === me?.id} className="!text-neg" onClick={async () => (await confirm({ title: `Delete ${u.email}?`, body: "This permanently deletes the user and all of their data.", confirmLabel: "Delete user", danger: true })) && del.mutate(u.id)}>Delete</Button>
              </Td>
            </tr>))}</tbody>
        </table></div>
      )}
      {q.data && q.data.pages > 1 && <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm"><Button size="sm" variant="secondary" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</Button><span className="text-muted">Page {q.data.page} of {q.data.pages}</span><Button size="sm" variant="secondary" disabled={f.page >= q.data.pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</Button></div>}
    </Card>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const q = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api.get<any>("/admin/settings") });
  const [f, setF] = useState<any>(null);
  const s = q.data?.settings;
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const cur = f ?? { registration_open: s.registration_open, chatbot_enabled: s.chatbot_enabled, chat_model: s.chat_model, chat_max_tokens: s.chat_max_tokens, chat_daily_limit: s.chat_daily_limit, announcement: s.announcement };
  const set = (k: string, v: any) => setF({ ...cur, [k]: v });
  const save = async () => { try { await api.put("/admin/settings", cur); qc.invalidateQueries(); setF(null); toast("Settings saved"); } catch (e) { error(e); } };
  const Toggle = ({ k, label, hint }: { k: string; label: string; hint: string }) => (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line p-4">
      <span><span className="block font-medium">{label}</span><span className="text-sm text-muted">{hint}</span></span>
      <input type="checkbox" role="switch" checked={cur[k]} onChange={(e) => set(k, e.target.checked)} className="mt-1 size-5 shrink-0 cursor-pointer accent-[var(--c-brand)]" />
    </label>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Access & availability" action={<Button size="sm" onClick={save} disabled={!f}>Save changes</Button>}>
        <div className="space-y-3">
          <Toggle k="registration_open" label="Open registration" hint="Turn off to stop new sign-ups." />
          <Toggle k="chatbot_enabled" label="AI advisors enabled" hint="Kill switch for the chatbot." />
          <Field label="Site announcement" hint="Shown as a banner on every page. Leave empty to hide."><Textarea value={cur.announcement} maxLength={300} onChange={(e) => set("announcement", e.target.value)} className="!min-h-16" /></Field>
        </div>
      </Card>
      <Card title="Chatbot configuration">
        <div className="space-y-4">
          <Callout tone={q.data.ai.mode === "live" ? "good" : "warn"} title={q.data.ai.mode === "live" ? "Connected to Claude" : "Offline demo mode"}>{q.data.ai.mode === "live" ? `Environment default model: ${q.data.ai.envModel}` : "Set ANTHROPIC_API_KEY in the server environment to enable live responses."}</Callout>
          <Field label="Model override" hint={`Leave blank to use ${q.data.ai.envModel}. Any Claude model id.`}><Input value={cur.chat_model} onChange={(e) => set("chat_model", e.target.value)} placeholder={q.data.ai.envModel} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max output tokens"><NumInput value={cur.chat_max_tokens} onChange={(v) => set("chat_max_tokens", v ?? 4096)} step="256" min={256} max={32000} /></Field>
            <Field label="Daily messages / user" hint="0 = unlimited"><NumInput value={cur.chat_daily_limit} onChange={(v) => set("chat_daily_limit", v ?? 0)} step="1" min={0} /></Field>
          </div>
        </div>
      </Card>
    </div>
  );
}
