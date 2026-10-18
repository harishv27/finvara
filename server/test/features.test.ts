import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateRetirement } from "../src/finance/montecarlo.ts";
import { debtPayoff, lumpsum, sip } from "../src/finance/calculators.ts";
import { detectRecurring, type TxLite } from "../src/finance/recurring.ts";
import { planRetirement } from "../src/finance/planning.ts";

const base = { age: 35, retirementAge: 65, lifeExpectancy: 90, currentSavings: 50_000, monthlyContribution: 800, annualNeedToday: 40_000, inflation: 0.03, preReturn: 0.07, postReturn: 0.05 };

test("monte carlo: deterministic for the same inputs, sane ranges, ordered percentiles", () => {
  const a = simulateRetirement(base);
  const b = simulateRetirement(base);
  assert.deepEqual(a, b);
  assert.ok(a.successProbability >= 0 && a.successProbability <= 1);
  assert.ok(a.atRetirement.p10 <= a.atRetirement.p50 && a.atRetirement.p50 <= a.atRetirement.p90);
  for (const p of a.bands) assert.ok(p.p10 <= p.p50 && p.p50 <= p.p90);
  assert.equal(a.bands.length, 90 - 35 + 1);
});

test("monte carlo: saving more raises the chance of success; needing more lowers it", () => {
  const lo = simulateRetirement({ ...base, monthlyContribution: 200 }).successProbability;
  const hi = simulateRetirement({ ...base, monthlyContribution: 2000 }).successProbability;
  assert.ok(hi > lo, `${hi} should beat ${lo}`);
  const hungry = simulateRetirement({ ...base, annualNeedToday: 120_000 }).successProbability;
  assert.ok(hungry < simulateRetirement(base).successProbability);
});

test("monte carlo: with zero volatility it agrees with the deterministic plan", () => {
  const det = planRetirement({ age: 35, retirementAge: 65, lifeExpectancy: 90, currentSavings: 50_000, monthlyContribution: 3000, desiredMonthlyIncomeToday: 3000, inflation: 0.03, preReturn: 0.07, postReturn: 0.05 });
  assert.equal(det.onTrack, true);
  const mc = simulateRetirement({ ...base, monthlyContribution: 3000, annualNeedToday: 36_000, preVolatility: 0, postVolatility: 0, runs: 50 });
  assert.equal(mc.successProbability, 1);
  const broke = simulateRetirement({ ...base, currentSavings: 0, monthlyContribution: 0, preVolatility: 0, postVolatility: 0, runs: 50 });
  assert.equal(broke.successProbability, 0);
  assert.equal(broke.medianDepletionAge, 65);
});

test("sip: matches the closed-form annuity-due and step-up beats flat", () => {
  const r = sip({ monthly: 500, years: 10, annualReturn: 0.12 });
  const i = (1.12) ** (1 / 12) - 1;
  const closed = 500 * ((((1 + i) ** 120 - 1) / i) * (1 + i));
  assert.ok(Math.abs(r.futureValue - closed) < 1, `${r.futureValue} vs ${closed}`);
  assert.equal(r.invested, 60_000);
  assert.equal(r.series.length, 11);
  assert.ok(sip({ monthly: 500, years: 10, annualReturn: 0.12, stepUpPct: 10 }).futureValue > r.futureValue);
});

test("lumpsum compounds annually", () => {
  const r = lumpsum({ amount: 10_000, years: 10, annualReturn: 0.07 });
  assert.ok(Math.abs(r.futureValue - 10_000 * 1.07 ** 10) < 1);
});

test("debt payoff: extra payments save time and interest; payments below interest never finish", () => {
  const d = debtPayoff({ balance: 10_000, apr: 18, payment: 300, extra: 100 });
  assert.ok(d.withExtra.months! < d.base.months!);
  assert.ok(d.interestSaved! > 0 && d.monthsSaved! > 0);
  assert.ok(d.base.totalInterest! > 0);
  // $10k at 18% accrues $150/mo interest, so $100/mo can never pay it off
  const never = debtPayoff({ balance: 10_000, apr: 18, payment: 100, extra: 0 });
  assert.equal(never.base.months, null);
  assert.ok(never.minimumToCoverInterest > 150);
  // a payment that fits exactly: total paid ≈ balance + interest
  const ok = debtPayoff({ balance: 1_000, apr: 12, payment: 100, extra: 0 });
  assert.ok(Math.abs(ok.base.totalPaid! - (1_000 + ok.base.totalInterest!)) < 0.01);
});

const tx = (date: string, amount: number, note: string, categoryId = 1, category = "Subscriptions"): TxLite => ({ date, amount, note, category, categoryId, kind: "expense" });

test("recurring: finds monthly subscriptions, ignores one-offs and frequent purchases", () => {
  const txs = [
    tx("2026-06-08", 15.49, "Netflix"), tx("2026-07-08", 15.49, "Netflix"), tx("2026-08-08", 15.49, "Netflix"), tx("2026-09-08", 15.49, "Netflix"), tx("2026-10-08", 15.49, "Netflix"),
    tx("2026-07-12", 120, "City Power", 2, "Utilities"), tx("2026-08-12", 131, "City Power", 2, "Utilities"), tx("2026-09-11", 109, "City Power", 2, "Utilities"),
    // coffee: many per month -> not a subscription
    ...["2026-07", "2026-08", "2026-09"].flatMap((m) => ["03", "07", "11", "15", "19", "23"].map((d) => tx(`${m}-${d}`, 4.5, "Starbucks", 3, "Dining out"))),
    // amount swings too much -> not a bill
    tx("2026-07-02", 40, "Concert", 4, "Entertainment"), tx("2026-08-02", 400, "Concert", 4, "Entertainment"), tx("2026-09-02", 25, "Concert", 4, "Entertainment"),
    // only two months
    tx("2026-08-20", 9.99, "Gym app", 5, "Subscriptions"), tx("2026-09-20", 9.99, "Gym app", 5, "Subscriptions"),
  ];
  const r = detectRecurring(txs, "2026-10-15");
  assert.deepEqual(r.items.map((i) => i.name).sort(), ["City Power", "Netflix"]);
  const nf = r.items.find((i) => i.name === "Netflix")!;
  assert.equal(nf.amount, 15.49);
  assert.equal(nf.nextDate, "2026-11-08");
  assert.equal(nf.daysUntil, 24);
  assert.equal(nf.varies, false);
  assert.equal(r.items.find((i) => i.name === "City Power")!.varies, true);
  assert.equal(r.monthlyTotal, +(15.49 + 120).toFixed(2));
  assert.equal(r.annualTotal, +((15.49 + 120) * 12).toFixed(2));
  assert.ok(r.upcoming.every((u) => u.daysUntil <= 30));
});
