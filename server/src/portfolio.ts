import { all } from "./db.ts";
import { clamp, round, sum } from "./finance/math.ts";
import { getFund, getStock } from "./market.ts";

export interface HoldingRow { id: number; kind: "fund" | "stock"; symbol: string; units: number; avg_cost: number }

export function portfolioFor(userId: number) {
  const rows = all<HoldingRow>("SELECT id, kind, symbol, units, avg_cost FROM holdings WHERE user_id = ? ORDER BY id", userId);
  const holdings = rows.map((h) => {
    const asset = h.kind === "fund" ? getFund(h.symbol) : getStock(h.symbol);
    const price = h.kind === "fund" ? (asset as any)?.nav ?? h.avg_cost : (asset as any)?.price ?? h.avg_cost;
    const value = h.units * price;
    const cost = h.units * h.avg_cost;
    return {
      ...h,
      name: asset?.name ?? h.symbol,
      category: h.kind === "fund" ? (asset as any)?.category : (asset as any)?.sector,
      price: round(price),
      value: round(value),
      cost: round(cost),
      gain: round(value - cost),
      gainPct: cost ? round(((value - cost) / cost) * 100, 2) : 0,
      risk: h.kind === "fund" ? (asset as any)?.risk ?? 3 : stockRiskFromBeta((asset as any)?.beta ?? 1),
      dayChangePct: (asset as any)?.changePct ?? 0,
      expense: h.kind === "fund" ? (asset as any)?.expense_ratio ?? 0 : 0,
      volatility: (asset as any)?.volatility ?? 0.15,
    };
  });
  const total = sum(holdings.map((h) => h.value));
  const totalCost = sum(holdings.map((h) => h.cost));
  const withWeights = holdings.map((h) => ({ ...h, weight: total ? round((h.value / total) * 100, 1) : 0 }));
  return { holdings: withWeights, totalValue: round(total), totalCost: round(totalCost), totalGain: round(total - totalCost), totalGainPct: totalCost ? round(((total - totalCost) / totalCost) * 100, 2) : 0 };
}

const stockRiskFromBeta = (b: number) => (b < 0.7 ? 1 : b < 0.95 ? 2 : b < 1.2 ? 3 : b < 1.5 ? 4 : 5);

/** Diversification review used by the portfolio-analysis AI tool and the dashboard. */
export function analyzePortfolio(userId: number, riskScore: number) {
  const p = portfolioFor(userId);
  if (!p.holdings.length) return { empty: true as const, ...p };
  const byCategory: Record<string, number> = {};
  const byKind: Record<string, number> = { fund: 0, stock: 0 };
  for (const h of p.holdings) {
    byCategory[h.category ?? "Other"] = (byCategory[h.category ?? "Other"] ?? 0) + h.value;
    byKind[h.kind] += h.value;
  }
  const categories = Object.entries(byCategory)
    .map(([name, value]) => ({ name, value: round(value), weight: round((value / p.totalValue) * 100, 1) }))
    .sort((a, b) => b.value - a.value);
  const weightedRisk = sum(p.holdings.map((h) => h.risk * h.value)) / p.totalValue;
  const hhi = sum(p.holdings.map((h) => (h.value / p.totalValue) ** 2)); // concentration 0..1
  const weightedExpense = sum(p.holdings.filter((h) => h.kind === "fund").map((h) => h.expense * h.value)) / Math.max(1, byKind.fund);
  const top = [...p.holdings].sort((a, b) => b.value - a.value)[0];
  const findings: { level: "good" | "info" | "warning"; text: string }[] = [];
  if (top.weight > 35) findings.push({ level: "warning", text: `${top.symbol} is ${top.weight}% of the portfolio — consider trimming below ~25%.` });
  if (p.holdings.length < 4) findings.push({ level: "warning", text: `Only ${p.holdings.length} holding(s). Add more uncorrelated assets to diversify.` });
  else findings.push({ level: "good", text: `${p.holdings.length} holdings across ${categories.length} categories.` });
  const drift = weightedRisk - riskScore;
  if (drift > 0.8) findings.push({ level: "warning", text: `Portfolio risk (${weightedRisk.toFixed(1)}/5) is above your tolerance (${riskScore}/5).` });
  else if (drift < -0.8) findings.push({ level: "info", text: `Portfolio risk (${weightedRisk.toFixed(1)}/5) is well below your tolerance (${riskScore}/5) — you may be under-invested for growth.` });
  else findings.push({ level: "good", text: `Portfolio risk (${weightedRisk.toFixed(1)}/5) matches your tolerance (${riskScore}/5).` });
  if (weightedExpense > 0.8) findings.push({ level: "warning", text: `Average fund cost is ${weightedExpense.toFixed(2)}% — low-cost index alternatives could save money.` });
  if (byKind.stock / p.totalValue > 0.5 && riskScore <= 3) findings.push({ level: "info", text: "Over half is in individual stocks, which carry company-specific risk." });
  return {
    empty: false as const,
    ...p,
    categories,
    mix: { funds: round((byKind.fund / p.totalValue) * 100, 1), stocks: round((byKind.stock / p.totalValue) * 100, 1) },
    weightedRisk: round(weightedRisk, 2),
    concentration: round(clamp(hhi, 0, 1), 3),
    weightedExpenseRatio: round(weightedExpense, 3),
    findings,
  };
}

/** Blend funds the user picked in the portfolio builder. */
export function blendFunds(picks: { symbol: string; amount: number }[]) {
  const rows = picks.map((p) => ({ ...p, fund: getFund(p.symbol) })).filter((r) => r.fund && r.amount > 0);
  const total = sum(rows.map((r) => r.amount));
  if (!total) return null;
  const w = (r: (typeof rows)[number]) => r.amount / total;
  const sectors: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.fund!.allocation)) sectors[k] = (sectors[k] ?? 0) + v * w(r);
  return {
    total: round(total),
    expectedReturn: round(sum(rows.map((r) => r.fund!.return_3y * w(r))), 2),
    risk: round(sum(rows.map((r) => r.fund!.risk * w(r))), 2),
    expenseRatio: round(sum(rows.map((r) => r.fund!.expense_ratio * w(r))), 3),
    volatility: round(sum(rows.map((r) => r.fund!.volatility * w(r))) * 100, 1),
    annualFees: round(sum(rows.map((r) => (r.fund!.expense_ratio / 100) * r.amount)), 2),
    allocation: Object.entries(sectors).map(([name, v]) => ({ name, value: round(v, 1) })).sort((a, b) => b.value - a.value),
    positions: rows.map((r) => ({ symbol: r.symbol, name: r.fund!.name, amount: r.amount, weight: round(w(r) * 100, 1), units: round(r.amount / r.fund!.nav, 3), nav: r.fund!.nav })),
  };
}
