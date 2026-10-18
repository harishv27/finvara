import { all, get } from "../db.ts";
import { analyzeBudget, type CategorySpend } from "../finance/budget.ts";
import { monthKey, round, sum } from "../finance/math.ts";

export interface Profile {
  user_id: number; age: number | null; monthly_income: number | null; monthly_expenses: number | null;
  current_savings: number | null; total_debt: number | null; dependents: number | null; retirement_age: number | null;
  risk_score: number | null; risk_profile: string | null; goals: string; onboarded: number;
}

export function getProfile(userId: number) {
  const p = get<Profile>("SELECT * FROM profiles WHERE user_id = ?", userId);
  let goals: string[] = [];
  try { goals = JSON.parse(p?.goals ?? "[]"); } catch { /* ignore */ }
  return p ? { ...p, goals, onboarded: !!p.onboarded } : undefined;
}

export const currentMonth = () => monthKey(new Date());

export function monthSummary(userId: number, month = currentMonth()) {
  const rows = all<{ id: number; name: string; kind: "income" | "expense"; bucket: "need" | "want" | "savings"; planned: number; color: string; actual: number }>(
    `SELECT c.id, c.name, c.kind, c.bucket, c.planned, c.color,
            COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.category_id = c.id AND substr(t.date,1,7) = ?), 0) AS actual
       FROM categories c WHERE c.user_id = ? ORDER BY c.kind DESC, c.id`,
    month, userId,
  );
  const incomeRows = rows.filter((r) => r.kind === "income");
  const expenseRows = rows.filter((r) => r.kind === "expense");
  const incomeActual = sum(incomeRows.map((r) => r.actual));
  const incomePlanned = sum(incomeRows.map((r) => r.planned));
  const categories: CategorySpend[] = expenseRows.map((r) => ({ id: r.id, name: r.name, bucket: r.bucket, planned: r.planned, actual: r.actual }));
  const income = incomeActual > 0 ? incomeActual : incomePlanned;
  // Savings contributions are tracked as an expense category in the "savings" bucket; analysis derives savings from income - spend.
  const analysis = analyzeBudget(income, categories);
  return {
    month,
    incomeActual: round(incomeActual),
    incomePlanned: round(incomePlanned),
    income: round(income),
    categories: rows.map((r) => ({ ...r, actual: round(r.actual), remaining: r.kind === "expense" ? round(r.planned - r.actual) : null })),
    expenseCategories: categories,
    plannedExpenses: round(sum(expenseRows.filter((r) => r.bucket !== "savings").map((r) => r.planned))),
    analysis,
  };
}

export function monthlyTrend(userId: number, months = 6) {
  const out: { month: string; income: number; spent: number; saved: number }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = months - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const m = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    const r = get<{ inc: number; spent: number }>(
      `SELECT COALESCE(SUM(CASE WHEN c.kind='income' THEN t.amount END),0) inc,
              COALESCE(SUM(CASE WHEN c.kind='expense' AND c.bucket!='savings' THEN t.amount END),0) spent
         FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND substr(t.date,1,7) = ?`,
      userId, m,
    )!;
    out.push({ month: m, income: round(r.inc), spent: round(r.spent), saved: round(Math.max(0, r.inc - r.spent)) });
  }
  return out;
}

/** One-stop financial picture used as AI context and as a fallback for tool inputs. */
export function financialContext(userId: number) {
  const user = get<{ name: string; email: string }>("SELECT name, email FROM users WHERE id = ?", userId)!;
  const profile = getProfile(userId);
  const ms = monthSummary(userId);
  const trend = monthlyTrend(userId, 3).filter((t) => t.income > 0);
  const avgIncome = trend.length ? sum(trend.map((t) => t.income)) / trend.length : 0;
  const avgSpent = trend.length ? sum(trend.map((t) => t.spent)) / trend.length : 0;
  const income = profile?.monthly_income ?? (avgIncome || ms.income);
  const expenses = profile?.monthly_expenses ?? (avgSpent || ms.analysis.spent);
  return {
    name: user.name,
    profile,
    income: round(income),
    expenses: round(expenses),
    savings: profile?.current_savings ?? 0,
    debt: profile?.total_debt ?? 0,
    age: profile?.age ?? null,
    dependents: profile?.dependents ?? 0,
    riskScore: profile?.risk_score ?? 3,
    retirementAge: profile?.retirement_age ?? 65,
    month: ms,
  };
}
export type FinancialContext = ReturnType<typeof financialContext>;
