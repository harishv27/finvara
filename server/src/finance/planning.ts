import {
  clamp, expectedReturn, fvTotal, monthlyRate, monthsToTarget, projectSeries, requiredMonthly,
  round, suggestAllocation, type SeriesPoint,
} from "./math.ts";

// ---------------------------------------------------------------- goals

export interface GoalPlanInput {
  target: number;
  current: number;
  months: number;
  annualReturn: number;
  monthlyContribution?: number; // what the user currently saves toward it
}

export interface GoalPlan {
  months: number;
  requiredMonthly: number;
  currentMonthly: number;
  projectedAtDeadline: number;
  shortfall: number;
  onTrack: boolean;
  progressPct: number;
  monthsToGoalAtCurrentPace: number | null;
  milestones: { pct: number; amount: number; approxMonth: number | null }[];
  series: SeriesPoint[];
}

export function planGoal(i: GoalPlanInput): GoalPlan {
  const months = Math.max(0, Math.round(i.months));
  const req = requiredMonthly(i.target, i.current, i.annualReturn, months);
  const cur = i.monthlyContribution ?? 0;
  const projected = fvTotal(i.current, cur, i.annualReturn, months);
  const step = months > 240 ? 12 : months > 60 ? 3 : 1;
  const required = projectSeries(i.current, req, i.annualReturn, months, new Date(), step);
  const atPace = projectSeries(i.current, cur, i.annualReturn, months, new Date(), step);
  const series = required.map((p, idx) => ({ ...p, contributed: atPace[idx]?.balance ?? 0 }));
  return {
    months,
    requiredMonthly: round(req),
    currentMonthly: round(cur),
    projectedAtDeadline: round(projected),
    shortfall: round(Math.max(0, i.target - projected)),
    onTrack: projected >= i.target * 0.999,
    progressPct: round(clamp(i.current / i.target, 0, 1) * 100, 1),
    monthsToGoalAtCurrentPace: monthsToTarget(i.target, i.current, cur, i.annualReturn),
    milestones: [0.25, 0.5, 0.75, 1].map((p) => ({
      pct: p * 100,
      amount: round(i.target * p),
      approxMonth: monthsToTarget(i.target * p, i.current, req, i.annualReturn),
    })),
    series,
  };
}

// ----------------------------------------------------------- retirement

export interface RetirementInput {
  age: number;
  retirementAge: number;
  lifeExpectancy?: number;
  currentSavings: number;
  monthlyContribution: number;
  desiredMonthlyIncomeToday: number; // in today's money
  otherIncomeToday?: number; // pension / social security, today's money per month
  inflation?: number;
  preReturn?: number;
  postReturn?: number;
}

export interface RetirementPlan {
  yearsToRetirement: number;
  yearsInRetirement: number;
  inflatedMonthlyNeed: number;
  corpusNeeded: number;
  projectedCorpus: number;
  gap: number;
  fundedPct: number;
  extraMonthlyNeeded: number;
  onTrack: boolean;
  sustainableMonthlyIncomeToday: number;
  series: SeriesPoint[];
  assumptions: { inflation: number; preReturn: number; postReturn: number; lifeExpectancy: number };
}

export function planRetirement(i: RetirementInput): RetirementPlan {
  const inflation = i.inflation ?? 0.03;
  const preReturn = i.preReturn ?? 0.07;
  const postReturn = i.postReturn ?? 0.05;
  const life = i.lifeExpectancy ?? 90;
  const yrsTo = Math.max(0, i.retirementAge - i.age);
  const yrsIn = Math.max(1, life - i.retirementAge);
  const months = yrsTo * 12;
  const needToday = Math.max(0, i.desiredMonthlyIncomeToday - (i.otherIncomeToday ?? 0));
  const inflatedMonthly = needToday * (1 + inflation) ** yrsTo;
  const annualFirstYear = inflatedMonthly * 12;
  // Present value (at retirement) of a growing annuity: withdrawals rise with inflation, balance earns postReturn.
  const corpus =
    Math.abs(postReturn - inflation) < 1e-9
      ? (annualFirstYear * yrsIn) / (1 + postReturn)
      : (annualFirstYear * (1 - ((1 + inflation) / (1 + postReturn)) ** yrsIn)) / (postReturn - inflation);
  const projected = fvTotal(i.currentSavings, i.monthlyContribution, preReturn, months);
  const gap = Math.max(0, corpus - projected);
  const extra = requiredMonthly(corpus, i.currentSavings, preReturn, months) - i.monthlyContribution;
  // Inverse: how much monthly (today's money) can the projected corpus sustain?
  const factor = corpus > 0 ? annualFirstYear / corpus : 0;
  const sustainableFirstYear = projected * factor;
  const sustainableToday = sustainableFirstYear / 12 / (1 + inflation) ** yrsTo + (i.otherIncomeToday ?? 0);
  const step = months > 240 ? 12 : months > 60 ? 6 : 1;
  return {
    yearsToRetirement: yrsTo,
    yearsInRetirement: yrsIn,
    inflatedMonthlyNeed: round(inflatedMonthly),
    corpusNeeded: round(corpus),
    projectedCorpus: round(projected),
    gap: round(gap),
    fundedPct: corpus > 0 ? round(clamp(projected / corpus, 0, 5) * 100, 1) : 100,
    extraMonthlyNeeded: round(Math.max(0, extra)),
    onTrack: projected >= corpus * 0.999,
    sustainableMonthlyIncomeToday: round(sustainableToday),
    series: projectSeries(i.currentSavings, i.monthlyContribution, preReturn, months, new Date(), step),
    assumptions: { inflation, preReturn, postReturn, lifeExpectancy: life },
  };
}

// ---------------------------------------------------------- wealth path

export interface WealthInput {
  currentWealth: number;
  monthlyContribution: number;
  years: number;
  annualReturn?: number;
  inflation?: number;
  annualContributionIncrease?: number; // e.g. 0.03 = step up 3% a year
}

export interface WealthProjection {
  years: number;
  scenarios: Record<"conservative" | "base" | "optimistic", { rate: number; finalNominal: number; finalReal: number }>;
  yearly: { year: number; conservative: number; base: number; optimistic: number; contributed: number }[];
  totalContributed: number;
  growthShare: number;
}

function simulate(i: WealthInput, rate: number) {
  const r = monthlyRate(rate);
  let bal = i.currentWealth;
  let monthly = i.monthlyContribution;
  let contributed = i.currentWealth;
  const byYear: { balance: number; contributed: number }[] = [{ balance: bal, contributed }];
  for (let y = 1; y <= i.years; y++) {
    for (let m = 0; m < 12; m++) {
      bal = bal * (1 + r) + monthly;
      contributed += monthly;
    }
    monthly *= 1 + (i.annualContributionIncrease ?? 0);
    byYear.push({ balance: bal, contributed });
  }
  return byYear;
}

export function projectWealth(i: WealthInput): WealthProjection {
  const base = i.annualReturn ?? 0.07;
  const inflation = i.inflation ?? 0.03;
  const rates = { conservative: Math.max(0.01, base - 0.025), base, optimistic: base + 0.025 };
  const sims = {
    conservative: simulate(i, rates.conservative),
    base: simulate(i, rates.base),
    optimistic: simulate(i, rates.optimistic),
  };
  const real = (v: number) => v / (1 + inflation) ** i.years;
  const last = (k: keyof typeof sims) => sims[k][i.years].balance;
  const scenarios = Object.fromEntries(
    (Object.keys(sims) as (keyof typeof sims)[]).map((k) => [
      k,
      { rate: rates[k], finalNominal: round(last(k)), finalReal: round(real(last(k))) },
    ]),
  ) as WealthProjection["scenarios"];
  const contributed = sims.base[i.years].contributed;
  return {
    years: i.years,
    scenarios,
    yearly: sims.base.map((p, y) => ({
      year: y,
      conservative: round(sims.conservative[y].balance),
      base: round(p.balance),
      optimistic: round(sims.optimistic[y].balance),
      contributed: round(p.contributed),
    })),
    totalContributed: round(contributed),
    growthShare: last("base") > 0 ? round(1 - contributed / last("base"), 3) : 0,
  };
}

/** Investment-strategy blurb for a goal: allocation + expected return + what it means. */
export function strategyFor(riskScore: number, horizonYears: number) {
  const allocation = suggestAllocation(riskScore, horizonYears);
  const exp = expectedReturn(allocation);
  const style =
    allocation.equity >= 70
      ? "growth-oriented"
      : allocation.equity >= 45
        ? "balanced"
        : "capital-preservation focused";
  return {
    allocation,
    expectedReturn: round(exp, 4),
    style,
    summary: `${allocation.equity}% equity / ${allocation.bonds}% bonds / ${allocation.cash}% cash — ${style}, expecting roughly ${(exp * 100).toFixed(1)}% a year over ${horizonYears.toFixed(0)} years (not guaranteed).`,
  };
}
