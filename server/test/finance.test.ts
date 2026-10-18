import { test } from "node:test";
import assert from "node:assert/strict";
import { fvTotal, requiredMonthly, monthsToTarget, suggestAllocation, round } from "../src/finance/math.ts";
import { planRetirement, planGoal, projectWealth } from "../src/finance/planning.ts";
import { analyzeBudget, optimizeExpenses, savingsPlan } from "../src/finance/budget.ts";
import { federalTax, planTax } from "../src/finance/tax.ts";
import { planInsurance } from "../src/finance/insurance.ts";
import { assessRisk } from "../src/finance/risk.ts";

const near = (a: number, b: number, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} !≈ ${b}`);

test("requiredMonthly is the inverse of fvTotal", () => {
  const m = requiredMonthly(100_000, 10_000, 0.07, 120);
  near(fvTotal(10_000, m, 0.07, 120), 100_000, 1);
});

test("requiredMonthly is zero when the lump sum already grows past the target", () => {
  assert.equal(requiredMonthly(10_000, 50_000, 0.05, 60), 0);
});

test("zero-rate edge case is linear", () => {
  near(requiredMonthly(12_000, 0, 0, 12), 1000, 0.001);
});

test("monthsToTarget agrees with fvTotal", () => {
  const m = monthsToTarget(50_000, 5_000, 800, 0.06)!;
  assert.ok(fvTotal(5_000, 800, 0.06, m) >= 50_000);
  assert.ok(fvTotal(5_000, 800, 0.06, m - 1) < 50_000);
});

test("allocation shrinks equity as the horizon shortens and always sums to ~100", () => {
  const long = suggestAllocation(3, 25);
  const short = suggestAllocation(3, 2);
  assert.ok(long.equity > short.equity);
  for (const a of [long, short]) near(a.equity + a.bonds + a.cash, 100, 1.5);
});

test("goal plan: required contribution puts you on track", () => {
  const p = planGoal({ target: 60_000, current: 5_000, months: 60, annualReturn: 0.05, monthlyContribution: 0 });
  assert.equal(p.onTrack, false);
  const q = planGoal({ target: 60_000, current: 5_000, months: 60, annualReturn: 0.05, monthlyContribution: p.requiredMonthly });
  assert.equal(q.onTrack, true);
});

test("retirement: contributing the extra monthly closes the gap", () => {
  const base = { age: 30, retirementAge: 65, currentSavings: 20_000, monthlyContribution: 300, desiredMonthlyIncomeToday: 5_000 };
  const p = planRetirement(base);
  assert.ok(p.corpusNeeded > p.projectedCorpus);
  const fixed = planRetirement({ ...base, monthlyContribution: 300 + p.extraMonthlyNeeded });
  assert.ok(fixed.onTrack, "should be on track after the extra contribution");
});

test("retirement: pension income lowers the corpus needed", () => {
  const base = { age: 40, retirementAge: 65, currentSavings: 0, monthlyContribution: 0, desiredMonthlyIncomeToday: 4_000 };
  assert.ok(planRetirement({ ...base, otherIncomeToday: 1_500 }).corpusNeeded < planRetirement(base).corpusNeeded);
});

test("wealth projection: scenarios are ordered and contributions tracked", () => {
  const w = projectWealth({ currentWealth: 10_000, monthlyContribution: 500, years: 20 });
  assert.ok(w.scenarios.conservative.finalNominal < w.scenarios.base.finalNominal);
  assert.ok(w.scenarios.base.finalNominal < w.scenarios.optimistic.finalNominal);
  assert.ok(w.scenarios.base.finalReal < w.scenarios.base.finalNominal);
  assert.equal(w.totalContributed, 10_000 + 500 * 240);
  assert.equal(w.yearly.length, 21);
});

test("budget analysis flags overspend and computes savings rate", () => {
  const a = analyzeBudget(5_000, [
    { name: "Rent", bucket: "need", planned: 1_500, actual: 1_500 },
    { name: "Dining", bucket: "want", planned: 300, actual: 600 },
    { name: "Fun", bucket: "want", planned: 200, actual: 200 },
  ]);
  assert.equal(a.spent, 2_300);
  assert.equal(a.saved, 2_700);
  near(a.savingsRate, 0.54, 0.001);
  assert.equal(a.overBudget[0].name, "Dining");
  assert.equal(a.overBudget[0].over, 300);
  assert.ok(a.insights.some((i) => i.level === "good"));
});

test("budget analysis warns when spending exceeds income", () => {
  const a = analyzeBudget(1_000, [{ name: "Rent", bucket: "need", planned: 900, actual: 1_200 }]);
  assert.equal(a.saved, 0);
  assert.ok(a.insights.some((i) => i.level === "danger"));
});

test("expense optimisation ranks by potential saving and never exceeds 50% of a category", () => {
  const o = optimizeExpenses([
    { name: "Dining out", bucket: "want", planned: 200, actual: 700 },
    { name: "Rent", bucket: "need", planned: 1500, actual: 1500 },
  ]);
  assert.equal(o.items[0].category, "Dining out");
  for (const it of o.items) assert.ok(it.potentialSaving <= it.current * 0.5 + 0.01);
  near(o.totalAnnual, o.totalMonthly * 12, 0.05);
});

test("expense optimisation never suggests cutting rent or mortgage", () => {
  const o = optimizeExpenses([
    { name: "Rent / Mortgage", bucket: "need", planned: 1500, actual: 1800 },
    { name: "Dining out", bucket: "want", planned: 200, actual: 500 },
  ]);
  assert.deepEqual(o.items.map((i) => i.category), ["Dining out"]);
});

test("savings plan sizes the emergency fund by household", () => {
  assert.equal(savingsPlan({ income: 5000, expenses: 3000, savings: 0, debt: 0, age: 28, dependents: 0 }).emergencyFundMonths, 3);
  assert.equal(savingsPlan({ income: 5000, expenses: 3000, savings: 0, debt: 0, age: 28, dependents: 2 }).emergencyFundMonths, 6);
});

test("federal tax matches a hand calculation", () => {
  // 11925*10% + (48475-11925)*12% + (50000-48475)*22%
  near(federalTax(50_000).tax, 1192.5 + 4386 + 335.5, 0.01);
  assert.equal(federalTax(50_000).marginalRate, 0.22);
  assert.equal(federalTax(0).tax, 0);
});

test("tax plan only offers an HSA with a high-deductible plan", () => {
  assert.ok(!planTax({ annualIncome: 90_000 }).strategies.some((s) => s.name.includes("HSA")));
  assert.ok(planTax({ annualIncome: 90_000, hasHighDeductibleHealthPlan: true }).strategies.some((s) => s.name.includes("HSA")));
});

test("insurance: dependents raise recommended life cover; no health cover is critical", () => {
  const solo = planInsurance({ annualIncome: 80_000, age: 35, dependents: 0, debt: 20_000, liquidSavings: 10_000, existingHealthCover: true });
  const fam = planInsurance({ annualIncome: 80_000, age: 35, dependents: 2, debt: 20_000, liquidSavings: 10_000, existingHealthCover: false });
  assert.ok(fam.life.recommendedCover > solo.life.recommendedCover);
  assert.equal(fam.health.priority, "critical");
  assert.ok(fam.life.estimatedPremiumMonthly > 0);
});

test("risk assessment averages answers and applies the age cap", () => {
  const a = { horizon: 5, drop: 5, goal: 5, experience: 5, stability: 5, loss: 5 };
  assert.equal(assessRisk(a).profile, "aggressive");
  assert.ok(assessRisk(a, { age: 62 }).score < assessRisk(a).score);
  assert.throws(() => assessRisk({}));
  assert.equal(round(assessRisk({ horizon: 1, drop: 1 }).score, 1), 1);
});
