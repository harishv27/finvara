import { all, run } from "./db.ts";
import { round, sum } from "./finance/math.ts";
import { getProfile } from "./lib/snapshot.ts";
import { portfolioFor } from "./portfolio.ts";

export interface NetWorth { cash: number; invested: number; goals: number; debt: number; total: number }

/** Cash (savings-goal balances, else the profile figure) + investments + milestone funds − debt. */
export function computeNetWorth(userId: number): NetWorth {
  const profile = getProfile(userId);
  const cash = sum(all<{ current: number }>("SELECT current FROM savings_goals WHERE user_id = ?", userId).map((g) => g.current)) || (profile?.current_savings ?? 0);
  const invested = portfolioFor(userId).totalValue;
  const goals = sum(all<{ current_savings: number }>("SELECT current_savings FROM milestones WHERE user_id = ?", userId).map((m) => m.current_savings));
  const debt = profile?.total_debt ?? 0;
  return { cash: round(cash), invested: round(invested), goals: round(goals), debt: round(debt), total: round(cash + invested + goals - debt) };
}

const isoToday = () => new Date().toISOString().slice(0, 10);

/** One snapshot per day (the latest wins), taken whenever the dashboard is viewed. */
export function recordSnapshot(userId: number) {
  const n = computeNetWorth(userId);
  run("INSERT OR REPLACE INTO net_worth_snapshots(user_id,date,cash,invested,goals,debt,total) VALUES(?,?,?,?,?,?,?)", userId, isoToday(), n.cash, n.invested, n.goals, n.debt, n.total);
  return n;
}

const RANGE_DAYS: Record<string, number> = { "3M": 92, "6M": 183, "1Y": 366, ALL: 36_500 };

export function netWorthHistory(userId: number, range = "1Y", maxPoints = 80) {
  const days = RANGE_DAYS[range] ?? 366;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const rows = all<{ date: string; total: number; cash: number; invested: number; goals: number; debt: number }>(
    "SELECT date, total, cash, invested, goals, debt FROM net_worth_snapshots WHERE user_id = ? AND date >= ? ORDER BY date",
    userId, from.toISOString().slice(0, 10),
  );
  const stride = Math.max(1, Math.ceil(rows.length / maxPoints));
  const points = rows.filter((_, i) => i % stride === 0 || i === rows.length - 1);
  const first = points[0];
  const last = points[points.length - 1];
  return {
    range,
    points,
    change: first && last && first !== last ? { amount: round(last.total - first.total), pct: first.total ? round(((last.total - first.total) / Math.abs(first.total)) * 100, 1) : 0, since: first.date } : null,
  };
}
