import { Router } from "express";
import { z } from "zod";
import { all, get, getSetting, run } from "../db.ts";
import { requireAuth, uid } from "../lib/auth.ts";
import { HttpError, intParam, parse } from "../lib/http.ts";
import { AGENTS } from "../ai/agents.ts";
import { toolsFor } from "../ai/tools.ts";
import { createConversation, isLive, messagesToday, runChat, type ChatEvent } from "../ai/engine.ts";
import { config } from "../config.ts";
import type { AgentId } from "../ai/types.ts";

export const chat = Router();
chat.use(requireAuth);

const AgentEnum = z.enum(["personal", "investment", "wealth"]);

chat.get("/agents", (_req, res) => {
  res.json({
    mode: isLive() ? "live" : "demo",
    enabled: getSetting("chatbot_enabled"),
    model: isLive() ? getSetting("chat_model") || config.defaultModel : null,
    agents: Object.values(AGENTS).map((a) => ({
      id: a.id, name: a.name, tagline: a.tagline, focus: a.focus, color: a.color, starters: a.starters,
      tools: toolsFor(a.id).map((t) => ({ name: t.name, title: t.title, description: t.description })),
    })),
  });
});

chat.get("/conversations", (req, res) => {
  const agent = req.query.agent ? AgentEnum.parse(req.query.agent) : undefined;
  const rows = all(
    `SELECT id, agent, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations
      WHERE user_id = ? ${agent ? "AND agent = ?" : ""} ORDER BY updated_at DESC, id DESC LIMIT 50`,
    uid(req), ...(agent ? [agent] : []),
  );
  res.json({ conversations: rows });
});

function ownConversation(req: any, id: number) {
  const c = get<{ id: number; agent: AgentId; title: string }>("SELECT id, agent, title FROM conversations WHERE id = ? AND user_id = ?", id, uid(req));
  if (!c) throw new HttpError(404, "Conversation not found");
  return c;
}

chat.get("/conversations/:id", (req, res) => {
  const c = ownConversation(req, intParam(req.params.id));
  const messages = all<any>("SELECT id, role, content, mode, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY id", c.id);
  const calls = all<any>("SELECT message_id AS messageId, tool, input, ok, duration_ms AS ms FROM tool_calls WHERE conversation_id = ? ORDER BY id", c.id);
  res.json({
    conversation: c,
    messages: messages.map((m) => ({
      ...m,
      tools: calls.filter((t) => t.messageId === m.id).map((t) => ({
        name: t.tool, title: toolsFor(c.agent).find((x) => x.name === t.tool)?.title ?? t.tool, ok: !!t.ok, ms: t.ms,
      })),
    })),
  });
});

chat.delete("/conversations/:id", (req, res) => {
  const c = ownConversation(req, intParam(req.params.id));
  run("DELETE FROM conversations WHERE id = ?", c.id);
  res.json({ ok: true });
});

/** Streams server-sent events: start → (tool_start, tool_result)* → text* → done. */
chat.post("/message", async (req, res) => {
  const b = parse(z.object({ agent: AgentEnum, conversationId: z.number().int().positive().optional(), message: z.string().trim().min(1).max(4000) }), req.body);
  if (!getSetting("chatbot_enabled")) throw new HttpError(503, "The assistant is temporarily disabled by an administrator.");
  const limit = getSetting("chat_daily_limit");
  if (limit > 0 && messagesToday(uid(req)) >= limit) throw new HttpError(429, `Daily message limit of ${limit} reached. Try again tomorrow.`);

  let conversationId = b.conversationId;
  if (conversationId) {
    const c = ownConversation(req, conversationId);
    if (c.agent !== b.agent) throw new HttpError(400, "Conversation belongs to a different agent");
  } else conversationId = createConversation(uid(req), b.agent, b.message);

  res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  let open = true;
  res.on("close", () => (open = false));
  const emit = (e: ChatEvent) => { if (open) res.write(`data: ${JSON.stringify(e)}\n\n`); };

  await runChat({ userId: uid(req), agent: b.agent, conversationId, message: b.message }, emit);
  if (open) res.end();
});
