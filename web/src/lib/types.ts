export interface Fund {
  symbol: string; name: string; category: string; fund_house: string; risk: number; expense_ratio: number; aum_bn: number;
  min_investment: number; nav: number; return_1y: number; return_3y: number; return_5y: number; volatility: number; sharpe: number;
  allocation: Record<string, number>; description: string; featured: boolean; active: boolean; changePct: number; return1m: number; return3m: number; watchlisted?: boolean;
}
export interface Stock {
  symbol: string; name: string; sector: string; price: number; prev_close: number; market_cap_bn: number; pe: number; dividend_yield: number;
  beta: number; eps_growth: number; week52_high: number; week52_low: number; volatility: number; description: string; featured: boolean; active: boolean;
  change: number; changePct: number; return1m: number; return3m: number; return1y: number; watchlisted?: boolean;
}
export interface Rec<T> { item: T; match: number; reasons: string[]; components: { riskFit: number; returns: number; cost: number; quality: number } }
export interface Category { id: number; name: string; kind: "income" | "expense"; bucket: "need" | "want" | "savings"; planned: number; color: string; actual: number; remaining: number | null }
export interface Insight { level: "good" | "info" | "warning" | "danger"; title: string; detail: string }
export interface Profile {
  age: number | null; monthly_income: number | null; monthly_expenses: number | null; current_savings: number | null; total_debt: number | null;
  dependents: number | null; retirement_age: number | null; risk_score: number | null; risk_profile: string | null; goals: string[]; onboarded: boolean;
}
export interface Allocation { equity: number; bonds: number; cash: number }
export interface Strategy { allocation: Allocation; expectedReturn: number; style: string; summary: string }
export interface GoalPlan {
  months: number; requiredMonthly: number; currentMonthly: number; projectedAtDeadline: number; shortfall: number; onTrack: boolean; progressPct: number;
  monthsToGoalAtCurrentPace: number | null; milestones: { pct: number; amount: number; approxMonth: number | null }[];
  series: { month: number; label: string; balance: number; contributed: number }[];
}
export interface Milestone {
  id: number; type: "home" | "retirement" | "education" | "custom"; name: string; targetAmount: number; currentSavings: number; monthlyContribution: number;
  targetDate: string; expectedReturn: number; plan: GoalPlan; strategy: Strategy; suggestedFunds: { symbol: string; name: string; category: string; match: number }[];
}
export interface Holding { id: number; kind: "fund" | "stock"; symbol: string; name: string; category: string; units: number; avg_cost: number; price: number; value: number; cost: number; gain: number; gainPct: number; weight: number; risk: number; dayChangePct: number }
export interface HistoryPoint { date: string; close: number }
