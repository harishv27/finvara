import { Router } from "express";
import { z } from "zod";
import { all, get, run } from "../db.ts";
import { requireAuth, uid } from "../lib/auth.ts";
import { HttpError, intParam, parse } from "../lib/http.ts";
import { monthsUntil } from "../finance/math.ts";
import { planGoal, planRetirement, strategyFor, projectWealth } from "../finance/planning.ts";
import { simulateRetirement } from "../finance/montecarlo.ts";
import { financialContext, getProfile, monthlyTrend } from "../lib/snapshot.ts";
import { portfolioFor } from "../portfolio.ts";
import { recommendFunds, recProfileFor } from "../recommend.ts";

export const planner = Router();
planner.use(requireAuth);

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MilestoneBody = z.object({
  type: z.enum(["home", "retirement", "education", "custom"]),
  name: z.string().trim().min(1).max(80),
  targetAmount: z.number().positive().max(1e10),
  currentSavings: z.number().min(0).max(1e10).default(0),
  monthlyContribution: z.number().min(0).max(1e8).default(0),
  targetDate: IsoDate,
  expectedReturn: z.number().min(0).max(0.2).default(0.06),
});

interface MRow { id: number; type: string; name: string; target_amount: number; current_savings: number; monthly_contribution: number; target_date: string; expected_return: number }

function enrich(m: MRow, riskScore: number, goals: string[]) {
  const months = Math.max(0, monthsUntil(m.target_date));
  const plan = planGoal({ target: m.target_amount, current: m.current_savings, months, annualReturn: m.expected_return, monthlyContribution: m.monthly_contribution });
  const strategy = strategyFor(riskScore, months / 12);
  const funds = recommendFunds({ riskScore: Math.max(1, Math.min(5, riskScore + (months < 36 ? -1 : 0))), horizonYears: months / 12, goals }, 3).map((r) => ({ symbol: r.item.symbol, name: r.item.name, category: r.item.category, match: r.match }));
  return {
    id: m.id, type: m.type, name: m.name, targetAmount: m.target_amount, currentSavings: m.current_savings,
    monthlyContribution: m.monthly_contribution, targetDate: m.target_date, expectedReturn: m.expected_return,
    plan, strategy, suggestedFunds: funds,
  };
}

planner.get("/milestones", (req, res) => {
  const p = getProfile(uid(req))!;
  const rows = all<MRow>("SELECT * FROM milestones WHERE user_id = ? ORDER BY target_date", uid(req));
  res.json({ milestones: rows.map((m) => enrich(m, p.risk_score ?? 3, p.goals)) });
});

planner.post("/milestones", (req, res) => {
  const b = parse(MilestoneBody, req.body);
  const id = run(
    "INSERT INTO milestones(user_id,type,name,target_amount,current_savings,monthly_contribution,target_date,expected_return) VALUES(?,?,?,?,?,?,?,?)",
    uid(req), b.type, b.name, b.targetAmount, b.currentSavings, b.monthlyContribution, b.targetDate, b.expectedReturn,
  ).id;
  const p = getProfile(uid(req))!;
  res.status(201).json({ milestone: enrich(get<MRow>("SELECT * FROM milestones WHERE id = ?", id)!, p.risk_score ?? 3, p.goals) });
});

planner.put("/milestones/:id", (req, res) => {
  const id = intParam(req.params.id);
  const b = parse(MilestoneBody, req.body);
  const r = run(
    "UPDATE milestones SET type=?, name=?, target_amount=?, current_savings=?, monthly_contribution=?, target_date=?, expected_return=? WHERE id=? AND user_id=?",
    b.type, b.name, b.targetAmount, b.currentSavings, b.monthlyContribution, b.targetDate, b.expectedReturn, id, uid(req),
  );
  if (!r.changes) throw new HttpError(404, "Milestone not found");
  const p = getProfile(uid(req))!;
  res.json({ milestone: enrich(get<MRow>("SELECT * FROM milestones WHERE id = ?", id)!, p.risk_score ?? 3, p.goals) });
});

planner.delete("/milestones/:id", (req, res) => {
  const r = run("DELETE FROM milestones WHERE id=? AND user_id=?", intParam(req.params.id), uid(req));
  if (!r.changes) throw new HttpError(404, "Milestone not found");
  res.json({ ok: true });
});

/** Stateless "what-if" for the goal form — nothing is saved. */
planner.post("/preview", (req, res) => {
  const b = parse(MilestoneBody.pick({ targetAmount: true, currentSavings: true, monthlyContribution: true, targetDate: true, expectedReturn: true }), req.body);
  const months = Math.max(0, monthsUntil(b.targetDate));
  const p = getProfile(uid(req))!;
  res.json({
    plan: planGoal({ target: b.targetAmount, current: b.currentSavings, months, annualReturn: b.expectedReturn, monthlyContribution: b.monthlyContribution }),
    strategy: strategyFor(p.risk_score ?? 3, months / 12),
  });
});

const RetBody = z.object({
  age: z.number().min(16).max(90),
  retirementAge: z.number().min(40).max(90),
  lifeExpectancy: z.number().min(60).max(110).default(90),
  currentSavings: z.number().min(0).max(1e10),
  monthlyContribution: z.number().min(0).max(1e8),
  desiredMonthlyIncomeToday: z.number().min(0).max(1e8),
  otherIncomeToday: z.number().min(0).max(1e8).default(0),
  inflation: z.number().min(0).max(0.2).default(0.03),
  preReturn: z.number().min(0).max(0.2).default(0.07),
  postReturn: z.number().min(0).max(0.2).default(0.05),
}).refine((v) => v.retirementAge > v.age, { message: "Retirement age must be above current age", path: ["retirementAge"] })
  .refine((v) => v.lifeExpectancy > v.retirementAge, { message: "Life expectancy must be above retirement age", path: ["lifeExpectancy"] });

planner.post("/retirement", (req, res) => {
  const b = parse(RetBody, req.body);
  const plan = planRetirement(b);
  const years = Math.max(1, b.retirementAge - b.age);
  const p = recProfileFor(uid(req));
  const strategy = strategyFor(p.riskScore, years);
  // volatility follows the suggested mix: equity-heavy plans swing more, and retirees hold a tamer portfolio
  const eq = strategy.allocation.equity / 100;
  const preVol = Math.round((eq * 0.17 + (1 - eq) * 0.05) * 1000) / 1000;
  const monteCarlo = simulateRetirement({
    age: b.age, retirementAge: b.retirementAge, lifeExpectancy: b.lifeExpectancy, currentSavings: b.currentSavings, monthlyContribution: b.monthlyContribution,
    annualNeedToday: Math.max(0, b.desiredMonthlyIncomeToday - b.otherIncomeToday) * 12, inflation: b.inflation, preReturn: b.preReturn, postReturn: b.postReturn,
    preVolatility: preVol, postVolatility: Math.round(preVol * 0.7 * 1000) / 1000,
  });
  res.json({
    plan,
    monteCarlo,
    strategy,
    wealth: projectWealth({ currentWealth: b.currentSavings, monthlyContribution: b.monthlyContribution, years, annualReturn: b.preReturn, inflation: b.inflation }),
  });
});

/**
 * Starting values for the retirement calculator, taken from what the user actually does:
 * average amount kept over the last three finished months, current savings + investments, 70% income replacement.
 */
planner.get("/defaults", (req, res) => {
  const c = financialContext(uid(req));
  const done = monthlyTrend(uid(req), 4).slice(0, -1).filter((t) => t.income > 0); // finished months only
  const avgKept = done.length ? done.reduce((a, t) => a + t.saved, 0) / done.length : c.income * 0.1;
  const round50 = (n: number) => Math.round(n / 50) * 50;
  res.json({
    age: c.age ?? 35,
    retirementAge: c.retirementAge,
    currentSavings: Math.round(c.savings + portfolioFor(uid(req)).totalValue),
    monthlyContribution: Math.max(0, round50(Math.min(avgKept, c.income * 0.5))),
    desiredMonthlyIncomeToday: Math.max(500, Math.round((c.income * 0.7) / 100) * 100),
    basis: done.length ? `your average over the last ${done.length} full months` : "10% of your income",
  });
});

planner.get("/strategy", (req, res) => {
  const risk = Math.min(5, Math.max(1, Number(req.query.risk) || 3));
  const years = Math.min(60, Math.max(0.5, Number(req.query.years) || 10));
  res.json(strategyFor(risk, years));
});
