import { all, getSetting } from "./db.ts";
import { clamp, round } from "./finance/math.ts";
import { allFunds, allStocks, type FundView, type StockView } from "./market.ts";

export interface RecProfile {
  riskScore: number; // 1..5
  horizonYears: number;
  goals: string[];
}

export interface Rec<T> {
  item: T;
  match: number; // 0..100
  reasons: string[];
  components: { riskFit: number; returns: number; cost: number; quality: number };
}

const weights = () => {
  const w = {
    risk: getSetting("rec_weight_risk_fit"), ret: getSetting("rec_weight_return"),
    cost: getSetting("rec_weight_cost"), quality: getSetting("rec_weight_quality"),
  };
  const total = w.risk + w.ret + w.cost + w.quality || 1;
  return { risk: w.risk / total, ret: w.ret / total, cost: w.cost / total, quality: w.quality / total };
};

/** Penalise assets riskier than the investor's tolerance more heavily than safer ones. */
const riskFit = (assetRisk: number, userRisk: number) => {
  const d = assetRisk - userRisk;
  return clamp(1 - (d > 0 ? d * 0.3 : -d * 0.15), 0, 1);
};

const stockRiskLevel = (s: StockView) => (s.beta < 0.7 ? 1 : s.beta < 0.95 ? 2 : s.beta < 1.2 ? 3 : s.beta < 1.5 ? 4 : 5);

export function recommendFunds(p: RecProfile, limit?: number): Rec<FundView>[] {
  const w = weights();
  const out = allFunds().map((f) => {
    const rf = riskFit(f.risk, p.riskScore);
    const returns = clamp(0.6 * (f.return_3y / 14) + 0.4 * (Math.max(f.return_1y, 0) / 22), 0, 1);
    const cost = clamp(1 - f.expense_ratio / 1.2, 0, 1);
    const quality = clamp(f.sharpe / 1.3, 0, 1);
    let score = 100 * (w.risk * rf + w.ret * returns + w.cost * cost + w.quality * quality);
    const reasons: string[] = [];
    if (rf >= 0.85) reasons.push(`Risk level ${f.risk}/5 fits your ${p.riskScore}/5 tolerance`);
    else if (f.risk > p.riskScore) reasons.push(`Riskier than your tolerance (${f.risk} vs ${p.riskScore})`);
    if (f.expense_ratio <= 0.25) reasons.push(`Very low cost (${f.expense_ratio.toFixed(2)}% expense ratio)`);
    if (f.return_3y >= 11) reasons.push(`Strong 3-year return of ${f.return_3y.toFixed(1)}% a year`);
    if (f.sharpe >= 0.9) reasons.push(`Efficient risk-adjusted returns (Sharpe ${f.sharpe.toFixed(2)})`);
    if (p.horizonYears < 3 && f.risk >= 4) {
      score -= 15;
      reasons.push("Short horizon: volatile funds can fall right when you need the money");
    }
    if (p.horizonYears >= 10 && f.category === "Target Date") reasons.push("Auto-rebalancing suits a long horizon");
    if (p.goals.some((g) => /income|dividend/i.test(g)) && /Dividend|Bond/.test(f.category)) {
      score += 4;
      reasons.push("Aligned with your income goal");
    }
    if (f.featured) {
      score += 3;
      reasons.push("Editor's pick");
    }
    return {
      item: f,
      match: round(clamp(score, 0, 100), 0),
      reasons: reasons.slice(0, 4),
      components: { riskFit: round(rf, 2), returns: round(returns, 2), cost: round(cost, 2), quality: round(quality, 2) },
    };
  });
  out.sort((a, b) => b.match - a.match);
  const min = getSetting("rec_min_match");
  const filtered = out.filter((r) => r.match >= min);
  return filtered.slice(0, limit ?? getSetting("rec_top_n"));
}

export function recommendStocks(p: RecProfile, limit?: number): Rec<StockView>[] {
  const w = weights();
  const incomeFocus = p.riskScore <= 2 || p.goals.some((g) => /income|dividend/i.test(g));
  const out = allStocks().map((s) => {
    const level = stockRiskLevel(s);
    const rf = riskFit(level, p.riskScore);
    const returns = clamp(0.5 * (Math.max(s.return1y, 0) / 40) + 0.5 * (s.eps_growth / 25), 0, 1);
    const valuation = clamp(1 - (s.pe - 10) / 40, 0, 1); // cheaper → higher
    const quality = incomeFocus
      ? clamp(0.6 * (s.dividend_yield / 4) + 0.4 * (s.market_cap_bn / 200), 0, 1)
      : clamp(0.5 * (s.market_cap_bn / 300) + 0.5 * (s.eps_growth / 20), 0, 1);
    let score = 100 * (w.risk * rf + w.ret * returns + w.cost * valuation + w.quality * quality);
    const reasons: string[] = [];
    if (rf >= 0.85) reasons.push(`Volatility profile (β ${s.beta.toFixed(2)}) suits a ${p.riskScore}/5 investor`);
    else if (level > p.riskScore) reasons.push(`Higher volatility than you prefer (β ${s.beta.toFixed(2)})`);
    if (s.eps_growth >= 15) reasons.push(`Earnings growing ${s.eps_growth}% a year`);
    if (s.dividend_yield >= 3) reasons.push(`${s.dividend_yield.toFixed(1)}% dividend yield`);
    if (s.pe < 15) reasons.push(`Reasonable valuation (P/E ${s.pe.toFixed(1)})`);
    else if (s.pe > 35) reasons.push(`Rich valuation (P/E ${s.pe.toFixed(1)}) — expectations are high`);
    if (s.return1y > 20) reasons.push(`${s.return1y.toFixed(0)}% gain over the past year`);
    if (incomeFocus && s.dividend_yield < 1) score -= 8;
    if (p.horizonYears < 3 && level >= 4) score -= 12;
    if (s.featured) {
      score += 3;
      reasons.push("Editor's pick");
    }
    return {
      item: s,
      match: round(clamp(score, 0, 100), 0),
      reasons: reasons.slice(0, 4),
      components: { riskFit: round(rf, 2), returns: round(returns, 2), cost: round(valuation, 2), quality: round(quality, 2) },
    };
  });
  out.sort((a, b) => b.match - a.match);
  const min = getSetting("rec_min_match");
  return out.filter((r) => r.match >= min).slice(0, limit ?? getSetting("rec_top_n"));
}

/** Load a user's recommendation profile from their stored financial profile. */
export function recProfileFor(userId: number): RecProfile {
  const p = all<any>("SELECT age, retirement_age, risk_score, goals FROM profiles WHERE user_id = ?", userId)[0];
  let goals: string[] = [];
  try { goals = JSON.parse(p?.goals ?? "[]"); } catch { /* ignore */ }
  const horizon = p?.age && p?.retirement_age ? Math.max(1, p.retirement_age - p.age) : 10;
  return { riskScore: p?.risk_score ?? 3, horizonYears: horizon, goals };
}
