import { OPTIMIZATION_BENCHMARKS } from "./constants.ts";
import { round, sum } from "./math.ts";

export interface CategorySpend {
  id?: number;
  name: string;
  bucket: "need" | "want" | "savings";
  planned: number;
  actual: number;
}

export interface BudgetInsight {
  level: "good" | "info" | "warning" | "danger";
  title: string;
  detail: string;
}

export interface BudgetAnalysis {
  income: number;
  spent: number;
  saved: number;
  savingsRate: number; // 0..1
  buckets: Record<"need" | "want" | "savings", { amount: number; pct: number; target: number }>;
  overBudget: { name: string; planned: number; actual: number; over: number; overPct: number }[];
  unbudgeted: string[];
  insights: BudgetInsight[];
  wastage: number;
}

/** 50/30/20-style analysis of one month of categories (income is separate). */
export function analyzeBudget(income: number, categories: CategorySpend[]): BudgetAnalysis {
  const expenseCats = categories.filter((c) => c.bucket !== "savings" || c.actual > 0 || c.planned > 0);
  const bucketAmt = { need: 0, want: 0, savings: 0 };
  for (const c of expenseCats) bucketAmt[c.bucket] += c.actual;
  const spentOnly = bucketAmt.need + bucketAmt.want;
  const saved = Math.max(0, income - spentOnly);
  const savingsRate = income > 0 ? saved / income : 0;

  const pct = (n: number) => (income > 0 ? n / income : 0);
  const buckets = {
    need: { amount: round(bucketAmt.need), pct: round(pct(bucketAmt.need), 3), target: 0.5 },
    want: { amount: round(bucketAmt.want), pct: round(pct(bucketAmt.want), 3), target: 0.3 },
    savings: { amount: round(saved), pct: round(savingsRate, 3), target: 0.2 },
  };

  const overBudget = categories
    .filter((c) => c.bucket !== "savings" && c.planned > 0 && c.actual > c.planned * 1.0001)
    .map((c) => ({
      name: c.name,
      planned: round(c.planned),
      actual: round(c.actual),
      over: round(c.actual - c.planned),
      overPct: round((c.actual - c.planned) / c.planned, 3),
    }))
    .sort((a, b) => b.over - a.over);

  const unbudgeted = categories.filter((c) => c.bucket !== "savings" && c.planned === 0 && c.actual > 0).map((c) => c.name);

  const insights: BudgetInsight[] = [];
  if (income <= 0) {
    insights.push({ level: "info", title: "No income recorded", detail: "Add your income categories so savings rate and ratios can be calculated." });
  } else {
    if (savingsRate >= 0.2)
      insights.push({ level: "good", title: `Saving ${Math.round(savingsRate * 100)}% of income`, detail: "You are at or above the 20% savings guideline. Keep it automated." });
    else if (savingsRate >= 0.1)
      insights.push({ level: "info", title: `Savings rate is ${Math.round(savingsRate * 100)}%`, detail: `About ${Math.round((0.2 - savingsRate) * income).toLocaleString()} more per month would reach the 20% guideline.` });
    else if (savingsRate > 0)
      insights.push({ level: "warning", title: `Savings rate is only ${Math.round(savingsRate * 100)}%`, detail: "Aim to move at least 10% of income into savings first, before discretionary spending." });
    else
      insights.push({ level: "danger", title: "Spending meets or exceeds income", detail: "You are not saving anything this month. Trim wants first, then renegotiate recurring needs." });

    if (buckets.want.pct > 0.3)
      insights.push({ level: "warning", title: `Wants are ${Math.round(buckets.want.pct * 100)}% of income`, detail: "Above the 30% guideline — discretionary categories are the quickest place to free up cash." });
    if (buckets.need.pct > 0.5)
      insights.push({ level: "warning", title: `Needs are ${Math.round(buckets.need.pct * 100)}% of income`, detail: "Above the 50% guideline. Housing, transport and insurance are usually the levers to review." });
  }
  for (const o of overBudget.slice(0, 3))
    insights.push({ level: o.overPct > 0.25 ? "danger" : "warning", title: `${o.name} is ${Math.round(o.overPct * 100)}% over plan`, detail: `Planned ${Math.round(o.planned).toLocaleString()}, spent ${Math.round(o.actual).toLocaleString()}.` });
  if (unbudgeted.length)
    insights.push({ level: "info", title: "Spending without a planned amount", detail: `${unbudgeted.join(", ")} has no budget set.` });

  return {
    income: round(income),
    spent: round(spentOnly),
    saved: round(saved),
    savingsRate: round(savingsRate, 3),
    buckets,
    overBudget,
    unbudgeted,
    insights,
    wastage: round(sum(overBudget.map((o) => o.over))),
  };
}

export interface OptimizationItem {
  category: string;
  current: number;
  potentialSaving: number;
  pct: number;
  tips: string[];
}

/** Suggest low-impact trims. Needs are trimmed conservatively; wants more freely. */
export function optimizeExpenses(categories: CategorySpend[]): { items: OptimizationItem[]; totalMonthly: number; totalAnnual: number } {
  const items = categories
    // rent/mortgage is a fixed obligation: "spend 4% less" is not advice anyone can act on
    .filter((c) => c.bucket !== "savings" && c.actual > 0 && !/\b(rent|mortgage)\b/i.test(c.name))
    .map((c) => {
      const key = Object.keys(OPTIMIZATION_BENCHMARKS).find((k) => c.name.toLowerCase().includes(k)) ?? "default";
      const bench = OPTIMIZATION_BENCHMARKS[key];
      const pct = bench.pct * (c.bucket === "need" ? 0.8 : 1);
      // Over-plan spend is the cheapest saving — at least reclaim that.
      const overPlan = Math.max(0, c.actual - c.planned);
      const saving = Math.max(c.actual * pct, c.planned > 0 ? overPlan : 0);
      return {
        category: c.name,
        current: round(c.actual),
        potentialSaving: round(Math.min(saving, c.actual * 0.5)),
        pct: round(Math.min(saving, c.actual * 0.5) / c.actual, 3),
        tips: bench.tips,
      };
    })
    .filter((i) => i.potentialSaving >= 1)
    .sort((a, b) => b.potentialSaving - a.potentialSaving);
  const totalMonthly = round(sum(items.map((i) => i.potentialSaving)));
  return { items, totalMonthly, totalAnnual: round(totalMonthly * 12) };
}

export interface SavingsPlan {
  emergencyFundTarget: number;
  emergencyFundMonths: number;
  currentSavings: number;
  emergencyGap: number;
  targetSavingsRate: number;
  recommendedMonthly: number;
  currentMonthlySurplus: number;
  steps: { order: number; title: string; detail: string }[];
}

export function savingsPlan(p: {
  income: number;
  expenses: number;
  savings: number;
  debt: number;
  age?: number | null;
  dependents?: number | null;
}): SavingsPlan {
  const deps = p.dependents ?? 0;
  const months = deps > 0 || (p.age ?? 30) >= 50 ? 6 : 3;
  const target = months * p.expenses;
  const gap = Math.max(0, target - p.savings);
  const surplus = p.income - p.expenses;
  const rate = (p.age ?? 30) >= 45 ? 0.25 : 0.2;
  const recommended = Math.min(Math.max(surplus, 0), p.income * rate) || p.income * rate;
  const steps: SavingsPlan["steps"] = [];
  let n = 1;
  if (gap > 0)
    steps.push({ order: n++, title: `Build a ${months}-month emergency fund`, detail: `Target ${Math.round(target).toLocaleString()}; you are ${Math.round(gap).toLocaleString()} short. Keep it in a high-yield savings account.` });
  if (p.debt > 0)
    steps.push({ order: n++, title: "Pay down high-interest debt", detail: "Anything above ~8% APR beats most investment returns. Use avalanche (highest rate first)." });
  steps.push({ order: n++, title: "Capture any employer retirement match", detail: "It is an instant 50–100% return on those contributions." });
  steps.push({ order: n++, title: "Automate saving on payday", detail: `Move ${Math.round(recommended).toLocaleString()}/month (${Math.round((recommended / Math.max(p.income, 1)) * 100)}% of income) before you can spend it.` });
  steps.push({ order: n++, title: "Invest the surplus for long-term goals", detail: "Use diversified, low-cost funds matched to your risk profile and time horizon." });
  return {
    emergencyFundTarget: round(target),
    emergencyFundMonths: months,
    currentSavings: round(p.savings),
    emergencyGap: round(gap),
    targetSavingsRate: rate,
    recommendedMonthly: round(recommended),
    currentMonthlySurplus: round(surplus),
    steps,
  };
}
