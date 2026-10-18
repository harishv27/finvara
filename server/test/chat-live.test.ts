/**
 * Exercises the LIVE Claude code path (streaming, tool-use loop, error mapping) against a local fake of the
 * Anthropic Messages API, so it runs offline and costs nothing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "finvara-live-"));
const requests: any[] = [];
let scenario: "tool" | "unauthorized" | "refusal" = "tool";

const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
const msgStart = (stop: string | null = null) => ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "fake", content: [], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } }] as [string, unknown];
const text = (i: number, t: string): [string, unknown][] => [
  ["content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: t } }],
  ["content_block_stop", { type: "content_block_stop", index: i }],
];
const end = (reason: string, out: number): [string, unknown][] => [
  ["message_delta", { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: out } }],
  ["message_stop", { type: "message_stop" }],
];

const fake: Server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body || "{}");
    requests.push({ url: req.url, headers: req.headers, body: json });
    if (scenario === "unauthorized") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (scenario === "refusal") return res.end(sse([msgStart(), ...end("refusal", 1)]));
    const hasToolResult = json.messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result"));
    if (!hasToolResult) {
      res.end(sse([
        msgStart(), ...text(0, "Let me check your savings."),
        ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_abc", name: "recommend_savings", input: {} } }],
        ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"totalDebt":' } }],
        ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "0}" } }],
        ["content_block_stop", { type: "content_block_stop", index: 1 }],
        ...end("tool_use", 40),
      ]));
    } else {
      res.end(sse([msgStart(), ...text(0, "You should build a 6-month emergency fund first."), ...end("end_turn", 25)]));
    }
  });
});

let server: Server;
let base = "";
let token = "";

before(async () => {
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as any).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_MODEL = "claude-opus-5-5";
  process.env.DATABASE_PATH = path.join(tmp, "live.db");
  process.env.NODE_ENV = "test";
  const { createApp } = await import("../src/index.ts");
  const { seedAll } = await import("../src/seed.ts");
  seedAll(true);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  token = (await (await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo@finvara.app", password: "Demo1234!" }) })).json()).token;
});
after(() => { server.close(); fake.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function chat(agent: string, message: string, conversationId?: number) {
  const res = await fetch(base + "/chat/message", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ agent, message, conversationId }) });
  assert.equal(res.status, 200);
  const events = (await res.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")));
  return { events, text: events.filter((e) => e.type === "text").map((e) => e.delta).join("") };
}

test("live: streams text, runs the requested tool, feeds the result back, and persists everything", async () => {
  scenario = "tool";
  requests.length = 0;
  const { events, text: out } = await chat("personal", "How much should I save?");

  assert.equal(events[0].mode, "live");
  assert.equal(requests.length, 2, "one request for the tool call, one for the final answer");
  assert.match(out, /Let me check your savings\./);
  assert.match(out, /build a 6-month emergency fund/);
  const names = events.filter((e) => e.type === "tool_start").map((e) => e.name);
  assert.deepEqual(names, ["recommend_savings"]);
  assert.ok(events.find((e) => e.type === "tool_result").ok);
  const done = events.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.usage.input, 240);

  // request #1: correct model, auth, 5 agent-scoped tools with clean JSON schemas, and the user's context in the system prompt
  const r1 = requests[0];
  assert.equal(r1.url, "/v1/messages");
  assert.equal(r1.headers["x-api-key"], "test-key");
  assert.equal(r1.body.model, "claude-opus-5-5");
  assert.equal(r1.body.stream, true);
  assert.deepEqual(r1.body.tools.map((t: any) => t.name).sort(), ["analyze_budget", "assess_risk", "optimize_expenses", "plan_goal", "recommend_savings"]);
  for (const t of r1.body.tools) {
    assert.equal(t.input_schema.type, "object");
    assert.equal(t.input_schema.$schema, undefined);
    assert.equal(t.input_schema.additionalProperties, false);
  }
  const system = typeof r1.body.system === "string" ? r1.body.system : r1.body.system.map((b: any) => b.text).join("");
  assert.match(system, /<user_context>/);
  assert.match(system, /Alex Morgan/);
  assert.match(system, /PERSONAL FINANCE AGENT/);

  // request #2 carries the assistant tool_use turn plus a matching tool_result
  const msgs = requests[1].body.messages;
  const last = msgs.at(-1);
  assert.equal(last.role, "user");
  assert.equal(last.content[0].type, "tool_result");
  assert.equal(last.content[0].tool_use_id, "toolu_abc");
  assert.ok(!last.content[0].is_error);
  assert.match(last.content[0].content, /emergencyFundTarget/);
  assert.equal(msgs.at(-2).content.find((b: any) => b.type === "tool_use").input.totalDebt, 0);

  // persistence + admin-visible tool log
  const conv = await (await fetch(`${base}/chat/conversations/${done.messageId ? events[0].conversationId : 0}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(conv.messages.length, 2);
  assert.equal(conv.messages[1].mode, "live");
  assert.equal(conv.messages[1].tools[0].name, "recommend_savings");
});

test("live: prior turns are replayed as plain text history", async () => {
  scenario = "tool";
  const first = await chat("personal", "Remember I like index funds");
  requests.length = 0;
  await chat("personal", "What did I just say?", first.events[0].conversationId);
  const msgs = requests[0].body.messages;
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].content, "Remember I like index funds");
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs.at(-1).content, "What did I just say?");
});

test("live: API auth failures become a friendly in-chat message (and are logged as errors)", async () => {
  scenario = "unauthorized";
  const { events, text: out } = await chat("investment", "hello");
  assert.match(out, /rejected the API key/);
  assert.equal(events.at(-1).mode, "error");
});

test("live: refusals are handled without running tools", async () => {
  scenario = "refusal";
  const { events, text: out } = await chat("wealth", "something disallowed");
  assert.match(out, /can't help with that/);
  assert.equal(events.filter((e) => e.type === "tool_start").length, 0);
});
