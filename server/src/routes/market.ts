import { Router } from "express";
import { z } from "zod";
import { all, get, run } from "../db.ts";
import { requireAuth, uid } from "../lib/auth.ts";
import { HttpError, intParam, parse } from "../lib/http.ts";
import {
  getFund, getStock, history, listCategories, listSectors, movers, screenFunds, screenStocks, sectorPerformance, allFunds, allStocks,
} from "../market.ts";
import { analyzePortfolio, blendFunds, portfolioFor } from "../portfolio.ts";
import { recommendFunds, recommendStocks, recProfileFor } from "../recommend.ts";
import { getProfile } from "../lib/snapshot.ts";

export const market = Router();
market.use(requireAuth);

const n = (v: unknown) => {
  if (v === undefined || v === "") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const dir = (v: unknown) => (v === "asc" ? "asc" : "desc");
const RANGES: Record<string, number> = { "1M": 22, "3M": 64, "6M": 130, "1Y": 260 };
const rangeDays = (v: unknown) => RANGES[String(v ?? "1Y").toUpperCase()] ?? 260;

// ------------------------------------------------------------------ funds
market.get("/funds", (req, res) => {
  const q = req.query;
  const rows = screenFunds({ q: s(q.q), category: s(q.category), minRisk: n(q.minRisk), maxRisk: n(q.maxRisk), maxExpense: n(q.maxExpense), sort: s(q.sort), dir: dir(q.dir) });
  const watch = new Set(all<{ symbol: string }>("SELECT symbol FROM watchlist WHERE user_id=? AND kind='fund'", uid(req)).map((w) => w.symbol));
  res.json({ funds: rows.map((f) => ({ ...f, watchlisted: watch.has(f.symbol) })), categories: listCategories() });
});

market.get("/funds/recommendations", (req, res) => {
  const recs = recommendFunds(recProfileFor(uid(req)));
  res.json({ profile: recProfileFor(uid(req)), recommendations: recs.map((r) => ({ ...r, item: r.item })) });
});

market.get("/funds/compare", (req, res) => {
  const symbols = String(req.query.symbols ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 4);
  if (symbols.length < 2) throw new HttpError(400, "Pick at least two funds to compare");
  const funds = symbols.map((sym) => getFund(sym)).filter(Boolean);
  if (funds.length < 2) throw new HttpError(404, "Funds not found");
  // Rebase each NAV series to 100 for a fair performance overlay.
  const series = funds.map((f) => {
    const h = history(f!.symbol, 260);
    const base = h[0]?.close || 1;
    return { symbol: f!.symbol, points: h.map((p) => ({ date: p.date, value: Math.round((p.close / base) * 10000) / 100 })) };
  });
  const dates = series[0].points.map((p) => p.date);
  const merged = dates.map((d, i) => ({ date: d, ...Object.fromEntries(series.map((x) => [x.symbol, x.points[i]?.value])) }));
  res.json({ funds, performance: merged });
});

market.post("/funds/builder", (req, res) => {
  const b = parse(z.object({ picks: z.array(z.object({ symbol: z.string().max(12), amount: z.number().min(0).max(1e9) })).min(1).max(12) }), req.body);
  const blended = blendFunds(b.picks);
  if (!blended) throw new HttpError(400, "Enter an amount for at least one fund");
  res.json({ blend: blended });
});

market.get("/funds/:symbol", (req, res) => {
  const f = getFund(req.params.symbol);
  if (!f) throw new HttpError(404, "Fund not found");
  const peers = allFunds().filter((p) => p.category === f.category && p.symbol !== f.symbol).slice(0, 4);
  res.json({ fund: f, history: history(f.symbol, rangeDays(req.query.range)), peers });
});

// ----------------------------------------------------------------- stocks
market.get("/stocks", (req, res) => {
  const q = req.query;
  const rows = screenStocks({
    q: s(q.q), sector: s(q.sector), sort: s(q.sort), dir: dir(q.dir), minPe: n(q.minPe), maxPe: n(q.maxPe),
    minDividend: n(q.minDividend), minCap: n(q.minCap), maxBeta: n(q.maxBeta), minGrowth: n(q.minGrowth),
  });
  const watch = new Set(all<{ symbol: string }>("SELECT symbol FROM watchlist WHERE user_id=? AND kind='stock'", uid(req)).map((w) => w.symbol));
  res.json({ stocks: rows.map((x) => ({ ...x, watchlisted: watch.has(x.symbol) })), sectors: listSectors(), asOf: new Date().toISOString() });
});

market.get("/stocks/movers", (_req, res) => res.json(movers(5)));
market.get("/stocks/sectors", (_req, res) => res.json({ sectors: sectorPerformance() }));
market.get("/stocks/recommendations", (req, res) => {
  const p = recProfileFor(uid(req));
  res.json({ profile: p, recommendations: recommendStocks(p) });
});

market.get("/stocks/:symbol", (req, res) => {
  const st = getStock(req.params.symbol);
  if (!st) throw new HttpError(404, "Stock not found");
  const peers = allStocks().filter((p) => p.sector === st.sector && p.symbol !== st.symbol).slice(0, 4);
  res.json({ stock: st, history: history(st.symbol, rangeDays(req.query.range)), peers });
});

// -------------------------------------------------------------- watchlist
market.get("/watchlist", (req, res) => {
  const rows = all<{ kind: "fund" | "stock"; symbol: string }>("SELECT kind, symbol FROM watchlist WHERE user_id=? ORDER BY created_at DESC", uid(req));
  res.json({ items: rows.map((r) => ({ kind: r.kind, symbol: r.symbol, asset: r.kind === "fund" ? getFund(r.symbol) : getStock(r.symbol) })).filter((r) => r.asset) });
});

const WatchBody = z.object({ kind: z.enum(["fund", "stock"]), symbol: z.string().trim().toUpperCase().max(12) });
market.post("/watchlist", (req, res) => {
  const b = parse(WatchBody, req.body);
  if (!(b.kind === "fund" ? getFund(b.symbol) : getStock(b.symbol))) throw new HttpError(404, "Unknown symbol");
  run("INSERT OR IGNORE INTO watchlist(user_id,kind,symbol) VALUES(?,?,?)", uid(req), b.kind, b.symbol);
  run("INSERT INTO recommendation_feedback(user_id,kind,symbol,action) VALUES(?,?,?,'watchlisted')", uid(req), b.kind, b.symbol);
  res.status(201).json({ ok: true });
});
market.delete("/watchlist/:kind/:symbol", (req, res) => {
  const b = parse(WatchBody, { kind: req.params.kind, symbol: req.params.symbol });
  run("DELETE FROM watchlist WHERE user_id=? AND kind=? AND symbol=?", uid(req), b.kind, b.symbol);
  res.json({ ok: true });
});

// -------------------------------------------------------------- portfolio
market.get("/portfolio", (req, res) => {
  const p = getProfile(uid(req))!;
  res.json(analyzePortfolio(uid(req), p.risk_score ?? 3));
});

const HoldingBody = z.object({
  kind: z.enum(["fund", "stock"]),
  symbol: z.string().trim().toUpperCase().max(12),
  units: z.number().positive().max(1e9),
  price: z.number().positive().max(1e7).optional(), // purchase price; defaults to current
});
market.post("/portfolio/holdings", (req, res) => {
  const b = parse(HoldingBody, req.body);
  const asset: any = b.kind === "fund" ? getFund(b.symbol) : getStock(b.symbol);
  if (!asset) throw new HttpError(404, "Unknown symbol");
  const price = b.price ?? (b.kind === "fund" ? asset.nav : asset.price);
  const cur = get<{ id: number; units: number; avg_cost: number }>("SELECT id, units, avg_cost FROM holdings WHERE user_id=? AND kind=? AND symbol=?", uid(req), b.kind, b.symbol);
  if (cur) {
    const units = cur.units + b.units;
    run("UPDATE holdings SET units=?, avg_cost=? WHERE id=?", units, (cur.units * cur.avg_cost + b.units * price) / units, cur.id);
  } else run("INSERT INTO holdings(user_id,kind,symbol,units,avg_cost) VALUES(?,?,?,?,?)", uid(req), b.kind, b.symbol, b.units, price);
  run("INSERT INTO recommendation_feedback(user_id,kind,symbol,action) VALUES(?,?,?,'invested')", uid(req), b.kind, b.symbol);
  res.status(201).json(portfolioFor(uid(req)));
});
market.delete("/portfolio/holdings/:id", (req, res) => {
  const r = run("DELETE FROM holdings WHERE id=? AND user_id=?", intParam(req.params.id), uid(req));
  if (!r.changes) throw new HttpError(404, "Holding not found");
  res.json({ ok: true });
});

market.post("/recommendations/feedback", (req, res) => {
  const b = parse(z.object({ kind: z.enum(["fund", "stock"]), symbol: z.string().max(12), action: z.enum(["viewed", "dismissed"]) }), req.body);
  run("INSERT INTO recommendation_feedback(user_id,kind,symbol,action) VALUES(?,?,?,?)", uid(req), b.kind, b.symbol.toUpperCase(), b.action);
  res.json({ ok: true });
});
