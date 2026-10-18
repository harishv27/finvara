import { all, get, run } from "./db.ts";
import { rng } from "./lib/rng.ts";
import { round } from "./finance/math.ts";

/**
 * Market data access. In this portfolio build prices come from a seeded random-walk
 * generator plus an in-memory "live tick" overlay. To use real data, implement
 * `MarketDataProvider` against a vendor API and swap it in `provider` below — the rest
 * of the app only talks to the functions exported from this module.
 */
export interface MarketDataProvider {
  livePrice(symbol: string): number | undefined;
}

const live = new Map<string, number>();
const tickRng = rng(Date.now());

export const provider: MarketDataProvider = { livePrice: (s) => live.get(s) };

export interface StockRow {
  symbol: string; name: string; sector: string; price: number; prev_close: number; market_cap_bn: number;
  pe: number; dividend_yield: number; beta: number; eps_growth: number; week52_high: number; week52_low: number;
  volatility: number; description: string; featured: number; active: number;
}
export interface FundRow {
  symbol: string; name: string; category: string; fund_house: string; risk: number; expense_ratio: number;
  aum_bn: number; min_investment: number; nav: number; return_1y: number; return_3y: number; return_5y: number;
  volatility: number; sharpe: number; allocation: string; description: string; featured: number; active: number;
}

export function initLive() {
  for (const s of all<StockRow>("SELECT symbol, price FROM stocks")) live.set(s.symbol, s.price);
}

/** Random-walk tick with mean reversion toward the day's reference so prices stay plausible. */
export function tick() {
  for (const s of all<StockRow>("SELECT symbol, prev_close, volatility FROM stocks WHERE active = 1")) {
    const cur = live.get(s.symbol) ?? s.prev_close;
    const sigma = (s.volatility / Math.sqrt(252)) * 0.02; // small per-tick move
    const reversion = ((s.prev_close - cur) / s.prev_close) * 0.01;
    const next = cur * (1 + tickRng.normal() * sigma + reversion);
    live.set(s.symbol, round(Math.max(0.5, next), 2));
  }
}

let timer: NodeJS.Timeout | undefined;
export function startTicker(ms = 4000) {
  initLive();
  timer = setInterval(tick, ms);
  timer.unref();
}

// Reference closes (1M / 3M / 1Y ago) computed from history; cached briefly.
let refCache: { at: number; map: Map<string, { m1: number; m3: number; y1: number }> } | undefined;
function refs() {
  if (refCache && Date.now() - refCache.at < 60_000) return refCache.map;
  const map = new Map<string, { m1: number; m3: number; y1: number }>();
  const rows = all<{ symbol: string; date: string; close: number }>(
    "SELECT symbol, date, close FROM price_history ORDER BY symbol, date",
  );
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!by.has(r.symbol)) by.set(r.symbol, []);
    by.get(r.symbol)!.push(r.close);
  }
  for (const [sym, c] of by) map.set(sym, { m1: c[Math.max(0, c.length - 22)], m3: c[Math.max(0, c.length - 64)], y1: c[0] });
  refCache = { at: Date.now(), map };
  return map;
}
export const invalidateRefs = () => (refCache = undefined);

const pct = (a: number, b: number) => (b ? round(((a - b) / b) * 100, 2) : 0);

export function stockView(s: StockRow) {
  const price = provider.livePrice(s.symbol) ?? s.price;
  const r = refs().get(s.symbol);
  return {
    ...s,
    price,
    change: round(price - s.prev_close, 2),
    changePct: pct(price, s.prev_close),
    return1m: r ? pct(price, r.m1) : 0,
    return3m: r ? pct(price, r.m3) : 0,
    return1y: r ? pct(price, r.y1) : 0,
    featured: !!s.featured,
    active: !!s.active,
  };
}
export type StockView = ReturnType<typeof stockView>;

export function fundView(f: FundRow) {
  const h = all<{ close: number }>("SELECT close FROM price_history WHERE symbol=? ORDER BY date DESC LIMIT 2", f.symbol);
  const r = refs().get(f.symbol);
  return {
    ...f,
    allocation: JSON.parse(f.allocation) as Record<string, number>,
    changePct: h.length === 2 ? pct(h[0].close, h[1].close) : 0,
    return1m: r ? pct(f.nav, r.m1) : 0,
    return3m: r ? pct(f.nav, r.m3) : 0,
    featured: !!f.featured,
    active: !!f.active,
  };
}
export type FundView = ReturnType<typeof fundView>;

export const getStock = (symbol: string) => {
  const s = get<StockRow>("SELECT * FROM stocks WHERE symbol = ?", symbol.toUpperCase());
  return s ? stockView(s) : undefined;
};
export const getFund = (symbol: string) => {
  const f = get<FundRow>("SELECT * FROM funds WHERE symbol = ?", symbol.toUpperCase());
  return f ? fundView(f) : undefined;
};
export const allStocks = (includeInactive = false) =>
  all<StockRow>(`SELECT * FROM stocks ${includeInactive ? "" : "WHERE active = 1"} ORDER BY symbol`).map(stockView);
export const allFunds = (includeInactive = false) =>
  all<FundRow>(`SELECT * FROM funds ${includeInactive ? "" : "WHERE active = 1"} ORDER BY symbol`).map(fundView);

export interface StockFilter {
  q?: string; sector?: string; sort?: string; dir?: "asc" | "desc";
  minPe?: number; maxPe?: number; minDividend?: number; minCap?: number; maxBeta?: number; minGrowth?: number;
}
export function screenStocks(f: StockFilter) {
  let rows = allStocks();
  const q = f.q?.trim().toLowerCase();
  if (q) rows = rows.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  if (f.sector) rows = rows.filter((s) => s.sector === f.sector);
  if (f.minPe != null) rows = rows.filter((s) => s.pe >= f.minPe!);
  if (f.maxPe != null) rows = rows.filter((s) => s.pe <= f.maxPe!);
  if (f.minDividend != null) rows = rows.filter((s) => s.dividend_yield >= f.minDividend!);
  if (f.minCap != null) rows = rows.filter((s) => s.market_cap_bn >= f.minCap!);
  if (f.maxBeta != null) rows = rows.filter((s) => s.beta <= f.maxBeta!);
  if (f.minGrowth != null) rows = rows.filter((s) => s.eps_growth >= f.minGrowth!);
  const key = (f.sort ?? "market_cap_bn") as keyof StockView;
  const dir = f.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const x = a[key] as any, y = b[key] as any;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
  });
  return rows;
}

export interface FundFilter { q?: string; category?: string; maxRisk?: number; minRisk?: number; maxExpense?: number; sort?: string; dir?: "asc" | "desc" }
export function screenFunds(f: FundFilter) {
  let rows = allFunds();
  const q = f.q?.trim().toLowerCase();
  if (q) rows = rows.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.fund_house.toLowerCase().includes(q));
  if (f.category) rows = rows.filter((s) => s.category === f.category);
  if (f.minRisk != null) rows = rows.filter((s) => s.risk >= f.minRisk!);
  if (f.maxRisk != null) rows = rows.filter((s) => s.risk <= f.maxRisk!);
  if (f.maxExpense != null) rows = rows.filter((s) => s.expense_ratio <= f.maxExpense!);
  const key = (f.sort ?? "return_3y") as keyof FundView;
  const dir = f.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const x = a[key] as any, y = b[key] as any;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
  });
  return rows;
}

export function movers(n = 5) {
  const s = allStocks().sort((a, b) => b.changePct - a.changePct);
  return { gainers: s.slice(0, n), losers: s.slice(-n).reverse() };
}

export function sectorPerformance() {
  const by = new Map<string, StockView[]>();
  for (const s of allStocks()) {
    if (!by.has(s.sector)) by.set(s.sector, []);
    by.get(s.sector)!.push(s);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return [...by.entries()]
    .map(([sector, rows]) => ({
      sector,
      count: rows.length,
      dayChangePct: round(avg(rows.map((r) => r.changePct)), 2),
      return3m: round(avg(rows.map((r) => r.return3m)), 2),
      return1y: round(avg(rows.map((r) => r.return1y)), 2),
      avgPe: round(avg(rows.map((r) => r.pe)), 1),
      avgDividend: round(avg(rows.map((r) => r.dividend_yield)), 2),
    }))
    .sort((a, b) => b.return3m - a.return3m);
}

export function history(symbol: string, days: number) {
  const rows = all<{ date: string; close: number }>(
    "SELECT date, close FROM price_history WHERE symbol = ? ORDER BY date DESC LIMIT ?",
    symbol.toUpperCase(),
    days,
  ).reverse();
  const lp = provider.livePrice(symbol.toUpperCase());
  if (lp && rows.length) {
    const today = new Date().toISOString().slice(0, 10);
    if (rows[rows.length - 1].date !== today) rows.push({ date: today, close: lp });
    else rows[rows.length - 1].close = lp;
  }
  return rows;
}

export const listCategories = () =>
  all<{ category: string; n: number }>("SELECT category, COUNT(*) n FROM funds WHERE active=1 GROUP BY category ORDER BY category");
export const listSectors = () =>
  all<{ sector: string; n: number }>("SELECT sector, COUNT(*) n FROM stocks WHERE active=1 GROUP BY sector ORDER BY sector");

/** Admin price edit: keep prev_close, set price, refresh overlay. */
export function adminSetStockPrice(symbol: string, price: number) {
  run("UPDATE stocks SET price = ? WHERE symbol = ?", price, symbol);
  live.set(symbol, price);
}
