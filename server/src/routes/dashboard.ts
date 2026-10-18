import { Router } from "express";
import { all } from "../db.ts";
import { requireAuth, uid } from "../lib/auth.ts";
import { financialContext, monthlyTrend } from "../lib/snapshot.ts";
import { analyzePortfolio } from "../portfolio.ts";
import { getFund, getStock, movers } from "../market.ts";
import { monthsUntil, round } from "../finance/math.ts";
import { planGoal } from "../finance/planning.ts";
import { recommendFunds, recommendStocks, recProfileFor } from "../recommend.ts";
import { netWorthHistory, recordSnapshot } from "../networth.ts";
import { checklistFor } from "../lib/checklist.ts";

export const dashboard = Router();
dashboard.use(requireAuth);

dashboard.get("/", (req, res) => {
  const id = uid(req);
  const ctx = financialContext(id);
  const trend = monthlyTrend(id, 6);
  const portfolio = analyzePortfolio(id, ctx.riskScore);
  const goals = all<any>("SELECT * FROM savings_goals WHERE user_id = ?", id);
  const milestones = all<any>("SELECT * FROM milestones WHERE user_id = ? ORDER BY target_date", id).map((m) => {
    const plan = planGoal({ target: m.target_amount, current: m.current_savings, months: Math.max(0, monthsUntil(m.target_date)), annualReturn: m.expected_return, monthlyContribution: m.monthly_contribution });
    return { id: m.id, name: m.name, type: m.type, targetDate: m.target_date, targetAmount: m.target_amount, currentSavings: m.current_savings, progressPct: plan.progressPct, onTrack: plan.onTrack, requiredMonthly: plan.requiredMonthly, projectedAtDeadline: plan.projectedAtDeadline };
  });
  const profile = recProfileFor(id);
  const nw = recordSnapshot(id);
  const history = netWorthHistory(id, "1Y");
  const watch = all<{ kind: "fund" | "stock"; symbol: string }>("SELECT kind, symbol FROM watchlist WHERE user_id=? ORDER BY created_at DESC LIMIT 6", id)
    .map((w) => ({ kind: w.kind, symbol: w.symbol, asset: w.kind === "fund" ? getFund(w.symbol) : getStock(w.symbol) }))
    .filter((w) => w.asset);
  const checklist = checklistFor(id);
  res.json({
    user: { name: ctx.name },
    asOf: new Date().toISOString(),
    netWorth: { ...nw, history: history.points, change: history.change },
    checklist,
    month: {
      month: ctx.month.month, income: ctx.month.income, spent: ctx.month.analysis.spent, saved: ctx.month.analysis.saved,
      hasSpending: ctx.month.analysis.spent > 0,
      savingsRate: ctx.month.analysis.savingsRate, plannedExpenses: ctx.month.plannedExpenses,
      budgetUsedPct: ctx.month.plannedExpenses ? round((ctx.month.analysis.spent / ctx.month.plannedExpenses) * 100, 1) : 0,
      insights: ctx.month.analysis.insights.slice(0, 3),
      topCategories: ctx.month.categories.filter((c) => c.kind === "expense" && c.bucket !== "savings").sort((a, b) => b.actual - a.actual).slice(0, 5),
    },
    trend,
    savingsGoals: goals,
    milestones,
    portfolio: portfolio.empty
      ? { empty: true }
      : { empty: false, totalValue: portfolio.totalValue, totalGain: portfolio.totalGain, totalGainPct: portfolio.totalGainPct, categories: portfolio.categories, findings: portfolio.findings.slice(0, 3), holdings: portfolio.holdings.slice(0, 5) },
    watchlist: watch,
    movers: movers(3),
    picks: {
      funds: recommendFunds(profile, 3).map((r) => ({ symbol: r.item.symbol, name: r.item.name, category: r.item.category, match: r.match, reason: r.reasons[0] })),
      stocks: recommendStocks(profile, 3).map((r) => ({ symbol: r.item.symbol, name: r.item.name, sector: r.item.sector, match: r.match, reason: r.reasons[0] })),
    },
    risk: { score: ctx.profile?.risk_score ?? null, profile: ctx.profile?.risk_profile ?? null },
  });
});

/** Net-worth history for any range (the dashboard embeds the 1Y view). */
dashboard.get("/networth", (req, res) => {
  const range = ["3M", "6M", "1Y", "ALL"].includes(String(req.query.range)) ? String(req.query.range) : "1Y";
  res.json(netWorthHistory(uid(req), range));
});
