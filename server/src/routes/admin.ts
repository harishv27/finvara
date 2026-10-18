import { Router } from "express";
import { z } from "zod";
import { all, allSettings, db, get, run, setSetting, SETTING_DEFAULTS, tx, type SettingKey } from "../db.ts";
import { requireAdmin, requireAuth, uid } from "../lib/auth.ts";
import { HttpError, intParam, parse } from "../lib/http.ts";
import { adminSetStockPrice, getFund, getStock, invalidateRefs, allFunds, allStocks } from "../market.ts";
import { recommendFunds, recommendStocks } from "../recommend.ts";
import { DAYS, series, tradingDates } from "../seed.ts";
import { toolsFor } from "../ai/tools.ts";
import { isLive } from "../ai/engine.ts";
import { config } from "../config.ts";
import { round } from "../finance/math.ts";

export const admin = Router();
admin.use(requireAuth, requireAdmin);

// ------------------------------------------------------------- overview
admin.get("/overview", (_req, res) => {
  const one = <T = any>(sql: string, ...p: any[]) => get<T>(sql, ...p)!;
  const users = one("SELECT COUNT(*) total, SUM(active) active, SUM(CASE WHEN date(created_at) >= date('now','-7 day') THEN 1 ELSE 0 END) new7d, SUM(CASE WHEN onboarded=1 THEN 1 ELSE 0 END) onboarded FROM users u LEFT JOIN profiles p ON p.user_id = u.id");
  const chat = one("SELECT COUNT(*) conversations FROM conversations");
  const msgs = one("SELECT COUNT(*) total, SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) userMsgs, COALESCE(AVG(CASE WHEN role='assistant' THEN latency_ms END),0) avgLatency, COALESCE(SUM(input_tokens),0) inTok, COALESCE(SUM(output_tokens),0) outTok, SUM(CASE WHEN mode='error' THEN 1 ELSE 0 END) errors FROM messages");
  const signups = all<{ day: string; n: number }>("SELECT date(created_at) day, COUNT(*) n FROM users WHERE date(created_at) >= date('now','-13 day') GROUP BY day ORDER BY day");
  const activity = all<{ day: string; n: number }>("SELECT date(m.created_at) day, COUNT(*) n FROM messages m WHERE m.role='user' AND date(m.created_at) >= date('now','-13 day') GROUP BY day ORDER BY day");
  const fill = (rows: { day: string; n: number }[]) => {
    const map = new Map(rows.map((r) => [r.day, r.n]));
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const k = d.toISOString().slice(0, 10);
      return { day: k, n: map.get(k) ?? 0 };
    });
  };
  const byAgent = all("SELECT agent, COUNT(*) conversations FROM conversations GROUP BY agent");
  res.json({
    users: { total: users.total, active: users.active ?? 0, new7d: users.new7d ?? 0, onboarded: users.onboarded ?? 0 },
    chat: {
      conversations: chat.conversations, messages: msgs.total, userMessages: msgs.userMsgs ?? 0,
      avgLatencyMs: Math.round(msgs.avgLatency), inputTokens: msgs.inTok, outputTokens: msgs.outTok,
      errorRate: msgs.userMsgs ? round((msgs.errors ?? 0) / msgs.userMsgs, 3) : 0, byAgent,
    },
    content: {
      funds: one("SELECT COUNT(*) n FROM funds WHERE active=1").n, stocks: one("SELECT COUNT(*) n FROM stocks WHERE active=1").n,
      holdings: one("SELECT COUNT(*) n FROM holdings").n, wills: one("SELECT COUNT(*) n FROM wills WHERE status='generated'").n,
      transactions: one("SELECT COUNT(*) n FROM transactions").n,
    },
    signups: fill(signups), activity: fill(activity),
    system: { aiMode: isLive() ? "live" : "demo", model: isLive() ? allSettings().chat_model || config.defaultModel : null, node: process.version, uptimeSec: Math.round(process.uptime()) },
  });
});

// ---------------------------------------------------------------- users
admin.get("/users", (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const role = req.query.role === "admin" || req.query.role === "user" ? req.query.role : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 20;
  const where = ["1=1"];
  const p: any[] = [];
  if (q) { where.push("(lower(u.email) LIKE ? OR lower(u.name) LIKE ?)"); p.push(`%${q}%`, `%${q}%`); }
  if (role) { where.push("u.role = ?"); p.push(role); }
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM users u WHERE ${where.join(" AND ")}`, ...p)!.n;
  const rows = all(
    `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
            COALESCE(pr.onboarded,0) AS onboarded,
            (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) AS conversations,
            (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS transactions
       FROM users u LEFT JOIN profiles pr ON pr.user_id = u.id WHERE ${where.join(" AND ")}
      ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    ...p, size, (page - 1) * size,
  );
  res.json({ users: rows, total, page, pages: Math.max(1, Math.ceil(total / size)) });
});

admin.patch("/users/:id", (req, res) => {
  const id = intParam(req.params.id);
  const b = parse(z.object({ active: z.boolean().optional(), role: z.enum(["user", "admin"]).optional(), name: z.string().trim().min(2).max(80).optional() }), req.body);
  if (id === uid(req) && (b.active === false || (b.role && b.role !== "admin"))) throw new HttpError(400, "You can't deactivate or demote yourself");
  const u = get<any>("SELECT * FROM users WHERE id = ?", id);
  if (!u) throw new HttpError(404, "User not found");
  run("UPDATE users SET active=?, role=?, name=? WHERE id=?", b.active == null ? u.active : b.active ? 1 : 0, b.role ?? u.role, b.name ?? u.name, id);
  res.json({ user: get("SELECT id,email,name,role,active FROM users WHERE id = ?", id) });
});

admin.delete("/users/:id", (req, res) => {
  const id = intParam(req.params.id);
  if (id === uid(req)) throw new HttpError(400, "You can't delete your own account here");
  const r = run("DELETE FROM users WHERE id = ?", id);
  if (!r.changes) throw new HttpError(404, "User not found");
  res.json({ ok: true });
});

// -------------------------------------------------------------- content
const FundBody = z.object({
  name: z.string().trim().min(2).max(100), category: z.string().trim().min(2).max(60), fund_house: z.string().trim().min(2).max(60),
  risk: z.number().int().min(1).max(5), expense_ratio: z.number().min(0).max(5), aum_bn: z.number().min(0).max(1e5), min_investment: z.number().min(0).max(1e8),
  nav: z.number().positive().max(1e6), return_1y: z.number().min(-100).max(500), return_3y: z.number().min(-100).max(200), return_5y: z.number().min(-100).max(200),
  volatility: z.number().min(0).max(2), sharpe: z.number().min(-5).max(10), description: z.string().max(500),
  featured: z.boolean(), active: z.boolean(),
});
const StockBody = z.object({
  name: z.string().trim().min(2).max(100), sector: z.string().trim().min(2).max(60), price: z.number().positive().max(1e7),
  market_cap_bn: z.number().min(0).max(1e5), pe: z.number().min(0).max(1e4), dividend_yield: z.number().min(0).max(50), beta: z.number().min(-2).max(5),
  eps_growth: z.number().min(-100).max(500), volatility: z.number().min(0).max(3), description: z.string().max(500), featured: z.boolean(), active: z.boolean(),
});
const Sym = z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,8}$/, "1–8 letters/digits");

function updateRow(table: "funds" | "stocks", symbol: string, data: Record<string, unknown>) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  run(`UPDATE ${table} SET ${sets} WHERE symbol = ?`, ...keys.map((k) => (typeof data[k] === "boolean" ? (data[k] ? 1 : 0) : (data[k] as any))), symbol);
}

admin.get("/funds", (_req, res) => res.json({ funds: allFunds(true) }));
admin.put("/funds/:symbol", (req, res) => {
  const symbol = Sym.parse(req.params.symbol);
  if (!getFund(symbol)) throw new HttpError(404, "Fund not found");
  updateRow("funds", symbol, parse(FundBody.partial(), req.body));
  invalidateRefs();
  res.json({ fund: getFund(symbol) });
});
admin.post("/funds", (req, res) => {
  const b = parse(FundBody.extend({ symbol: Sym, allocation: z.record(z.string(), z.number()).default({ Other: 100 }) }), req.body);
  if (getFund(b.symbol) || getStock(b.symbol)) throw new HttpError(409, "Symbol already exists");
  tx(() => {
    run(
      `INSERT INTO funds(symbol,name,category,fund_house,risk,expense_ratio,aum_bn,min_investment,nav,return_1y,return_3y,return_5y,volatility,sharpe,allocation,description,featured,active)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.symbol, b.name, b.category, b.fund_house, b.risk, b.expense_ratio, b.aum_bn, b.min_investment, b.nav, b.return_1y, b.return_3y, b.return_5y, b.volatility, b.sharpe, JSON.stringify(b.allocation), b.description, b.featured ? 1 : 0, b.active ? 1 : 0,
    );
    const dates = tradingDates(DAYS);
    const s = series(b.symbol, b.nav, b.return_1y / 100, Math.max(0.02, b.volatility));
    const ins = db.prepare("INSERT INTO price_history(symbol,date,close) VALUES(?,?,?)");
    s.forEach((c, i) => ins.run(b.symbol, dates[i], c));
  });
  invalidateRefs();
  res.status(201).json({ fund: getFund(b.symbol) });
});

admin.get("/stocks", (_req, res) => res.json({ stocks: allStocks(true) }));
admin.put("/stocks/:symbol", (req, res) => {
  const symbol = Sym.parse(req.params.symbol);
  if (!getStock(symbol)) throw new HttpError(404, "Stock not found");
  const { price, ...rest } = parse(StockBody.partial(), req.body);
  updateRow("stocks", symbol, rest);
  if (price != null) adminSetStockPrice(symbol, price);
  invalidateRefs();
  res.json({ stock: getStock(symbol) });
});
admin.post("/stocks", (req, res) => {
  const b = parse(StockBody.extend({ symbol: Sym }), req.body);
  if (getFund(b.symbol) || getStock(b.symbol)) throw new HttpError(409, "Symbol already exists");
  tx(() => {
    const dates = tradingDates(DAYS);
    const s = series(b.symbol, b.price, 0.08, Math.max(0.05, b.volatility));
    run(
      `INSERT INTO stocks(symbol,name,sector,price,prev_close,market_cap_bn,pe,dividend_yield,beta,eps_growth,week52_high,week52_low,volatility,description,featured,active)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.symbol, b.name, b.sector, b.price, s[s.length - 2], b.market_cap_bn, b.pe, b.dividend_yield, b.beta, b.eps_growth, Math.max(...s), Math.min(...s), b.volatility, b.description, b.featured ? 1 : 0, b.active ? 1 : 0,
    );
    const ins = db.prepare("INSERT INTO price_history(symbol,date,close) VALUES(?,?,?)");
    s.forEach((c, i) => ins.run(b.symbol, dates[i], c));
  });
  adminSetStockPrice(b.symbol, b.price);
  invalidateRefs();
  res.status(201).json({ stock: getStock(b.symbol) });
});

// ------------------------------------------------- recommendation config
const REC_KEYS = ["rec_weight_risk_fit", "rec_weight_return", "rec_weight_cost", "rec_weight_quality", "rec_min_match", "rec_top_n"] as const;

admin.get("/recommendations", (_req, res) => {
  const s = allSettings();
  res.json({
    config: Object.fromEntries(REC_KEYS.map((k) => [k, s[k]])),
    feedback: all("SELECT action, COUNT(*) n FROM recommendation_feedback GROUP BY action"),
    topWatchlisted: all("SELECT kind, symbol, COUNT(*) n FROM watchlist GROUP BY kind, symbol ORDER BY n DESC LIMIT 8"),
    featured: { funds: allFunds(true).filter((f) => f.featured).map((f) => f.symbol), stocks: allStocks(true).filter((f) => f.featured).map((f) => f.symbol) },
  });
});
admin.put("/recommendations", (req, res) => {
  const b = parse(z.object({
    rec_weight_risk_fit: z.number().min(0).max(1), rec_weight_return: z.number().min(0).max(1), rec_weight_cost: z.number().min(0).max(1),
    rec_weight_quality: z.number().min(0).max(1), rec_min_match: z.number().min(0).max(100), rec_top_n: z.number().int().min(1).max(20),
  }).partial(), req.body);
  for (const [k, v] of Object.entries(b)) setSetting(k as SettingKey, v);
  res.json({ ok: true });
});
admin.get("/recommendations/preview", (req, res) => {
  const risk = Math.min(5, Math.max(1, Number(req.query.risk) || 3));
  const horizon = Math.min(50, Math.max(1, Number(req.query.horizon) || 10));
  const p = { riskScore: risk, horizonYears: horizon, goals: [] as string[] };
  const lite = (r: any) => ({ symbol: r.item.symbol, name: r.item.name, match: r.match, reasons: r.reasons });
  res.json({ funds: recommendFunds(p).map(lite), stocks: recommendStocks(p).map(lite) });
});

// -------------------------------------------------------- chatbot monitor
admin.get("/chat/stats", (_req, res) => {
  const tools = all<any>("SELECT agent, tool, COUNT(*) calls, SUM(ok) ok, AVG(duration_ms) avgMs FROM tool_calls GROUP BY agent, tool ORDER BY calls DESC");
  const known = [...["personal", "investment", "wealth"].flatMap((a) => toolsFor(a as any).map((t) => ({ agent: a, tool: t.name, title: t.title })))];
  const merged = known.map((k) => {
    const u = tools.find((t: any) => t.tool === k.tool);
    return { ...k, calls: u?.calls ?? 0, successRate: u?.calls ? round(u.ok / u.calls, 3) : null, avgMs: u ? Math.round(u.avgMs) : null };
  });
  const daily = all("SELECT date(created_at) day, COUNT(*) messages, SUM(CASE WHEN mode='error' THEN 1 ELSE 0 END) errors, COALESCE(AVG(latency_ms),0) avgMs FROM messages WHERE role='assistant' AND date(created_at) >= date('now','-13 day') GROUP BY day ORDER BY day");
  const modes = all("SELECT mode, COUNT(*) n FROM messages WHERE role='assistant' GROUP BY mode");
  const errors = all("SELECT m.id, m.content, m.created_at AS createdAt, u.email FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN users u ON u.id=c.user_id WHERE m.mode='error' ORDER BY m.id DESC LIMIT 8");
  res.json({ tools: merged, daily, modes, errors, aiMode: isLive() ? "live" : "demo" });
});

admin.get("/chat/conversations", (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const agent = ["personal", "investment", "wealth"].includes(String(req.query.agent)) ? String(req.query.agent) : undefined;
  const size = 15;
  const where = agent ? "WHERE c.agent = ?" : "";
  const p = agent ? [agent] : [];
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM conversations c ${where}`, ...p)!.n;
  const rows = all(
    `SELECT c.id, c.agent, c.title, c.updated_at AS updatedAt, u.email,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS messages,
            (SELECT COUNT(*) FROM tool_calls t WHERE t.conversation_id=c.id) AS toolCalls,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.mode='error') AS errors
       FROM conversations c JOIN users u ON u.id=c.user_id ${where} ORDER BY c.updated_at DESC, c.id DESC LIMIT ? OFFSET ?`,
    ...p, size, (page - 1) * size,
  );
  res.json({ conversations: rows, total, page, pages: Math.max(1, Math.ceil(total / size)) });
});

admin.get("/chat/conversations/:id", (req, res) => {
  const id = intParam(req.params.id);
  const c = get<any>("SELECT c.*, u.email FROM conversations c JOIN users u ON u.id=c.user_id WHERE c.id = ?", id);
  if (!c) throw new HttpError(404, "Conversation not found");
  const messages = all("SELECT id, role, content, mode, input_tokens AS inputTokens, output_tokens AS outputTokens, latency_ms AS latencyMs, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY id", id);
  const tools = all("SELECT message_id AS messageId, tool, input, output, ok, duration_ms AS ms FROM tool_calls WHERE conversation_id = ? ORDER BY id", id);
  res.json({ conversation: c, messages, tools });
});

// -------------------------------------------------------------- settings
const SettingsBody = z.object({
  registration_open: z.boolean(), chatbot_enabled: z.boolean(), chat_model: z.string().trim().max(80),
  chat_max_tokens: z.number().int().min(256).max(32000), chat_daily_limit: z.number().int().min(0).max(10000), announcement: z.string().trim().max(300),
}).partial();

admin.get("/settings", (_req, res) => res.json({ settings: allSettings(), defaults: SETTING_DEFAULTS, ai: { mode: isLive() ? "live" : "demo", envModel: config.defaultModel } }));
admin.put("/settings", (req, res) => {
  const b = parse(SettingsBody, req.body);
  for (const [k, v] of Object.entries(b)) setSetting(k as SettingKey, v);
  res.json({ settings: allSettings() });
});
