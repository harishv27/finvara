import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.ts";
import { all, get, getSetting, run } from "../db.ts";
import { financialContext } from "../lib/snapshot.ts";
import { AGENTS, systemPrompt } from "./agents.ts";
import { usd } from "./format.ts";
import { inputSchemaOf, toolByName, toolsFor } from "./tools.ts";
import type { AgentId, AgentTool, ToolContext } from "./types.ts";

export type ChatEvent =
  | { type: "start"; conversationId: number; mode: "live" | "demo" }
  | { type: "tool_start"; id: string; name: string; title: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; ms: number }
  | { type: "text"; delta: string }
  | { type: "done"; messageId: number; mode: string; usage: { input: number; output: number }; latencyMs: number }
  | { type: "error"; message: string };

export const isLive = () => !!config.anthropicKey;
const EFFORT = (["low", "medium", "high"] as const).find((x) => x === process.env.ANTHROPIC_EFFORT) ?? "medium";
const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 20; // most recent messages replayed to the model
const HISTORY_CHARS = 4000; // per-message cap when replaying

export interface ToolLog { name: string; input: unknown; output: unknown; ok: boolean; ms: number }

/** Validate → execute one tool. Never throws: failures are returned as an error payload for the model. */
export function executeTool(tool: AgentTool, tc: ToolContext, rawInput: unknown): ToolLog & { rendered?: string } {
  const started = Date.now();
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { name: tool.name, input: rawInput, output: { error: `Invalid input — ${issues}` }, ok: false, ms: Date.now() - started };
  }
  try {
    const out = tool.run(tc, parsed.data);
    return { name: tool.name, input: parsed.data, output: out, ok: true, ms: Date.now() - started, rendered: tool.render(out, parsed.data) };
  } catch (e: any) {
    return { name: tool.name, input: parsed.data, output: { error: e?.message ?? "Tool failed" }, ok: false, ms: Date.now() - started };
  }
}

const trimForModel = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 14_000 ? s.slice(0, 14_000) + '…[truncated]' : s;
};

// ------------------------------------------------------------------ persistence
export function createConversation(userId: number, agent: AgentId, firstMessage: string) {
  const title = firstMessage.replace(/\s+/g, " ").slice(0, 60) || "New conversation";
  return run("INSERT INTO conversations(user_id,agent,title) VALUES(?,?,?)", userId, agent, title).id;
}

function recentHistory(conversationId: number): { role: "user" | "assistant"; content: string }[] {
  return all<{ role: "user" | "assistant"; content: string }>(
    "SELECT role, content FROM (SELECT id, role, content FROM messages WHERE conversation_id = ? AND mode != 'error' ORDER BY id DESC LIMIT ?) ORDER BY id",
    conversationId, HISTORY_LIMIT,
  ).map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CHARS) }));
}

/** Lightweight preference learning: which tools/topics the user keeps asking about. */
function learnPreferences(userId: number, agent: AgentId, tools: ToolLog[]) {
  const bump = (key: string) =>
    run(
      `INSERT INTO user_prefs(user_id,key,value) VALUES(?,?,'1')
       ON CONFLICT(user_id,key) DO UPDATE SET value = CAST(value AS INTEGER) + 1, updated_at = datetime('now')`,
      userId, key,
    );
  for (const t of tools) if (t.ok) bump(`topic:${t.name}`);
  bump(`agent:${agent}`);
}
const topPrefs = (userId: number) =>
  all<{ key: string; value: string }>("SELECT key, value FROM user_prefs WHERE user_id = ? AND key LIKE 'topic:%' ORDER BY CAST(value AS INTEGER) DESC LIMIT 4", userId)
    .map((r) => ({ topic: r.key.slice(6).replace(/_/g, " "), count: Number(r.value) }));

export function messagesToday(userId: number) {
  return get<{ n: number }>(
    `SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = ? AND m.role = 'user' AND date(m.created_at) = date('now')`,
    userId,
  )!.n;
}

// ------------------------------------------------------------------ main entry
export interface ChatInput { userId: number; agent: AgentId; conversationId: number; message: string }

export async function runChat(input: ChatInput, emit: (e: ChatEvent) => void) {
  const started = Date.now();
  const agent = AGENTS[input.agent];
  const history = recentHistory(input.conversationId);
  run("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)", input.conversationId, "user", input.message);

  let ctxCache: ReturnType<typeof financialContext> | undefined;
  const tc: ToolContext = { userId: input.userId, ctx: () => (ctxCache ??= financialContext(input.userId)) };
  const logs: ToolLog[] = [];
  let text = "";
  let mode: "live" | "demo" | "error" = isLive() ? "live" : "demo";
  const usage = { input: 0, output: 0 };
  const push = (d: string) => { text += d; emit({ type: "text", delta: d }); };

  emit({ type: "start", conversationId: input.conversationId, mode });

  try {
    if (isLive()) await liveLoop(input, agent.id, history, tc, logs, push, emit, usage, () => text);
    else await demoLoop(input, agent.id, tc, logs, push, emit);
  } catch (err) {
    mode = "error";
    const msg = friendlyError(err);
    console.error("[chat]", err instanceof Error ? err.message : err);
    if (text) push("\n\n");
    push(`⚠️ ${msg}`);
  }

  const latency = Date.now() - started;
  const mid = run(
    "INSERT INTO messages(conversation_id,role,content,input_tokens,output_tokens,latency_ms,mode) VALUES(?,?,?,?,?,?,?)",
    input.conversationId, "assistant", text || "(no response)", usage.input, usage.output, latency, mode,
  ).id;
  const ins = (l: ToolLog) =>
    run("INSERT INTO tool_calls(conversation_id,message_id,agent,tool,input,output,ok,duration_ms) VALUES(?,?,?,?,?,?,?,?)",
      input.conversationId, mid, input.agent, l.name, JSON.stringify(l.input ?? {}).slice(0, 4000), JSON.stringify(l.output ?? {}).slice(0, 20000), l.ok ? 1 : 0, l.ms);
  logs.forEach(ins);
  run("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", input.conversationId);
  learnPreferences(input.userId, input.agent, logs);
  emit({ type: "done", messageId: mid, mode, usage, latencyMs: latency });
}

function friendlyError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return "The AI service rejected the API key. An admin needs to check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "The AI service is rate-limited right now. Please try again in a moment.";
  if (err instanceof Anthropic.NotFoundError) return "The configured AI model was not found. An admin can change it under Admin → Settings.";
  if (err instanceof Anthropic.BadRequestError) return "The AI service could not process that request.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI service. Check the network connection and try again.";
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status}). Please try again.`;
  return "Something went wrong while generating a reply.";
}

// ------------------------------------------------------------------ live (Claude) mode
let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropicKey }));

async function liveLoop(
  input: ChatInput, agentId: AgentId, history: { role: "user" | "assistant"; content: string }[], tc: ToolContext,
  logs: ToolLog[], push: (d: string) => void, emit: (e: ChatEvent) => void, usage: { input: number; output: number }, getText: () => string,
) {
  const agent = AGENTS[agentId];
  const tools = toolsFor(agentId);
  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: inputSchemaOf(t) as Anthropic.Tool.InputSchema,
    eager_input_streaming: true,
  })) as Anthropic.Tool[];
  const system = systemPrompt(agent, tc.ctx(), topPrefs(input.userId));
  const model = getSetting("chat_model") || config.defaultModel;
  const maxTokens = getSetting("chat_max_tokens");
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: input.message }];
  let jsonRetries = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = getClient().messages.stream({
      model, max_tokens: maxTokens, system, tools: toolDefs, messages,
      output_config: { effort: EFFORT },
    });
    if (getText()) push("\n\n");
    stream.on("text", (d) => push(d));

    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // With eager input streaming a tool input can fail to parse; retry that turn, but never swallow API errors.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;

    if (message.stop_reason === "refusal") {
      push("I can't help with that request. Is there something else about your finances I can look at?");
      return;
    }
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (message.stop_reason === "max_tokens") {
      if (toolUses.length) throw new Error("tool input truncated at max_tokens");
      push("\n\n_(Reply was cut off — ask me to continue.)_");
      return;
    }
    if (message.stop_reason !== "tool_use" || !toolUses.length) return;

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const tool = toolByName(tu.name);
      emit({ type: "tool_start", id: tu.id, name: tu.name, title: tool?.title ?? tu.name, input: tu.input });
      if (!tool || tool.agent !== agentId) {
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` });
        emit({ type: "tool_result", id: tu.id, name: tu.name, ok: false, ms: 0 });
        continue;
      }
      const log = executeTool(tool, tc, tu.input);
      logs.push(log);
      emit({ type: "tool_result", id: tu.id, name: tu.name, ok: log.ok, ms: log.ms });
      results.push({ type: "tool_result", tool_use_id: tu.id, is_error: !log.ok, content: trimForModel(log.output) });
    }
    messages.push({ role: "user", content: results });
  }
  push("\n\n_(I hit my tool-call limit for one reply — ask a narrower question to continue.)_");
}

// ------------------------------------------------------------------ demo (offline) mode
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function routeTools(agentId: AgentId, message: string) {
  const m = message.toLowerCase();
  const scored = toolsFor(agentId)
    .map((t) => ({ t, score: t.keywords.reduce((s, k) => (m.includes(k) ? s + k.length : s), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  return scored.filter((x, i) => i === 0 || (i < 2 && x.score >= scored[0].score * 0.8)).map((x) => x.t);
}

async function demoLoop(
  input: ChatInput, agentId: AgentId, tc: ToolContext, logs: ToolLog[], push: (d: string) => void, emit: (e: ChatEvent) => void,
) {
  const agent = AGENTS[agentId];
  const picked = routeTools(agentId, input.message);
  const stream = async (md: string) => {
    const chars = Array.from(md); // code points, so emoji are never split across chunks
    for (let i = 0; i < chars.length; i += 14) {
      push(chars.slice(i, i + 14).join(""));
      await sleep(6);
    }
  };

  if (!picked.length) {
    const name = tc.ctx().name.split(" ")[0];
    const tools = toolsFor(agentId);
    await stream(
      [
        `Hi ${name}! I'm the **${agent.name}** running in **offline demo mode** — no \`ANTHROPIC_API_KEY\` is configured, so I answer with the same financial tools the live Claude agent uses, but I match your question by keyword instead of reasoning freely.`,
        `Here's what I can do right now:`,
        tools.map((t) => `- **${t.title}** — ${t.description.split(". ")[0].replace(/\.$/, "")}.`).join("\n"),
        `Try one of these:\n${agent.starters.map((s) => `- “${s}”`).join("\n")}`,
      ].join("\n\n"),
    );
    return;
  }

  const parts: string[] = [];
  for (const tool of picked) {
    const args = Object.fromEntries(Object.entries(tool.demoArgs?.(input.message) ?? {}).filter(([, v]) => v !== undefined));
    const id = `demo_${Date.now()}_${tool.name}`;
    emit({ type: "tool_start", id, name: tool.name, title: tool.title, input: args });
    await sleep(250);
    const log = executeTool(tool, tc, args);
    logs.push(log);
    emit({ type: "tool_result", id, name: tool.name, ok: log.ok, ms: log.ms });
    parts.push(log.ok ? log.rendered! : `I couldn't run **${tool.title}**: ${(log.output as any).error}`);
  }
  const first = tc.ctx().name.split(" ")[0];
  const intro = `Sure, ${first} — here's what I found using your Finvara data (${usd(tc.ctx().income)}/month income on file).`;
  await stream([intro, ...parts, "_Demo mode: set `ANTHROPIC_API_KEY` to chat freely with Claude, which can combine tools, ask follow-ups and tailor advice._"].join("\n\n"));
}
