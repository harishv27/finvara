import { Router } from "express";
import { z } from "zod";
import { all, get, run } from "../db.ts";
import { requireAuth, uid } from "../lib/auth.ts";
import { parse } from "../lib/http.ts";
import { currentMonth, getProfile, monthSummary } from "../lib/snapshot.ts";
import { monthsUntil } from "../finance/math.ts";
import { planGoal } from "../finance/planning.ts";
import { analyzePortfolio } from "../portfolio.ts";
import { getFund, getStock } from "../market.ts";

export const notifications = Router();
notifications.use(requireAuth);

export interface Notice {
  id: string; // deterministic, so a dismissal sticks (month-scoped where the alert is recurring)
  level: "info" | "warning" | "danger" | "good";
  title: string;
  body: string;
  link: string;
}

/**
 * Alerts and reminders are derived from the user's current data on demand — nothing to keep in sync.
 * Dismissals are remembered per notification id in `user_prefs`.
 */
export function buildNotices(userId: number): Notice[] {
  const out: Notice[] = [];
  const month = currentMonth();
  const profile = getProfile(userId);
  const ms = monthSummary(userId, month);

  for (const o of ms.analysis.overBudget.slice(0, 3))
    out.push({ id: `over:${o.name}:${month}`, level: o.overPct > 0.25 ? "danger" : "warning", title: `${o.name} is ${Math.round(o.overPct * 100)}% over budget`, body: `${Math.round(o.actual).toLocaleString()} spent against a ${Math.round(o.planned).toLocaleString()} plan this month.`, link: "/budget" });

  if (ms.plannedExpenses > 0) {
    const used = ms.analysis.spent / ms.plannedExpenses;
    if (used >= 0.9 && used < 1) out.push({ id: `budget90:${month}`, level: "warning", title: "You've used 90% of this month's budget", body: `${Math.round(ms.analysis.spent).toLocaleString()} of ${Math.round(ms.plannedExpenses).toLocaleString()} planned spending.`, link: "/budget" });
    if (used >= 1) out.push({ id: `budget100:${month}`, level: "danger", title: "Monthly budget exceeded", body: `You're ${Math.round((used - 1) * 100)}% above your planned spending.`, link: "/budget" });
  }

  for (const g of all<any>("SELECT * FROM savings_goals WHERE user_id = ? AND deadline IS NOT NULL AND current < target", userId)) {
    const m = monthsUntil(g.deadline);
    if (m >= 0 && m <= 2) out.push({ id: `goal-due:${g.id}:${g.deadline}`, level: "warning", title: `“${g.name}” is due soon`, body: `${Math.round(g.target - g.current).toLocaleString()} still to save by ${g.deadline}.`, link: "/budget" });
  }

  for (const m of all<any>("SELECT * FROM milestones WHERE user_id = ?", userId)) {
    const p = planGoal({ target: m.target_amount, current: m.current_savings, months: Math.max(0, monthsUntil(m.target_date)), annualReturn: m.expected_return, monthlyContribution: m.monthly_contribution });
    if (!p.onTrack) out.push({ id: `milestone:${m.id}:${month}`, level: "info", title: `“${m.name}” needs a boost`, body: `Save ${Math.round(Math.max(0, p.requiredMonthly - p.currentMonthly)).toLocaleString()} more per month to stay on track.`, link: "/planner" });
  }

  for (const w of all<{ kind: "fund" | "stock"; symbol: string }>("SELECT kind, symbol FROM watchlist WHERE user_id = ?", userId)) {
    const a: any = w.kind === "fund" ? getFund(w.symbol) : getStock(w.symbol);
    if (a && Math.abs(a.changePct) >= 2) out.push({ id: `move:${w.symbol}:${new Date().toISOString().slice(0, 10)}`, level: a.changePct > 0 ? "good" : "warning", title: `${w.symbol} ${a.changePct > 0 ? "up" : "down"} ${Math.abs(a.changePct).toFixed(1)}% today`, body: `${a.name} on your watchlist moved sharply.`, link: w.kind === "fund" ? "/funds" : "/stocks" });
  }

  const port = analyzePortfolio(userId, profile?.risk_score ?? 3);
  if (!port.empty) {
    const top = [...port.holdings].sort((a, b) => b.weight - a.weight)[0];
    if (top.weight > 40) out.push({ id: `concentration:${top.symbol}`, level: "warning", title: `${top.symbol} is ${top.weight}% of your portfolio`, body: "Heavy concentration raises risk — consider diversifying.", link: "/funds" });
  }

  // gentle reminders
  if (profile && profile.onboarded && !profile.risk_score) out.push({ id: "remind:risk", level: "info", title: "Take the risk questionnaire", body: "Recommendations get sharper once we know your comfort with risk.", link: "/profile" });
  const will = get<{ status: string }>("SELECT status FROM wills WHERE user_id = ? ORDER BY id DESC LIMIT 1", userId);
  if (profile?.onboarded && (profile.dependents ?? 0) > 0 && will?.status !== "generated") out.push({ id: "remind:will", level: "info", title: "You have dependents but no will", body: "A will lets you choose guardians and who inherits. It takes about ten minutes.", link: "/will" });

  const dismissed = new Set(all<{ key: string }>("SELECT key FROM user_prefs WHERE user_id = ? AND key LIKE 'dismiss:%'", userId).map((r) => r.key.slice(8)));
  const rank = { danger: 0, warning: 1, info: 2, good: 3 } as const;
  return out.filter((n) => !dismissed.has(n.id)).sort((a, b) => rank[a.level] - rank[b.level]);
}

notifications.get("/", (req, res) => res.json({ notifications: buildNotices(uid(req)) }));

notifications.post("/dismiss", (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().max(120)).min(1).max(50) }), req.body);
  for (const id of ids) run("INSERT INTO user_prefs(user_id,key,value) VALUES(?,?,'1') ON CONFLICT(user_id,key) DO NOTHING", uid(req), `dismiss:${id}`);
  res.json({ ok: true });
});
