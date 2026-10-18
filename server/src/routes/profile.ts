import { Router } from "express";
import { z } from "zod";
import { get, run, tx } from "../db.ts";
import { hashPassword, requireAuth, uid, verifyPassword } from "../lib/auth.ts";
import { HttpError, parse } from "../lib/http.ts";
import { getProfile } from "../lib/snapshot.ts";
import { assessRisk, RISK_QUESTIONS } from "../finance/risk.ts";
import { createDefaultCategories } from "../seed.ts";

export const profile = Router();
profile.use(requireAuth);

const num = (min: number, max: number) => z.number().min(min).max(max);
const ProfileBody = z.object({
  age: num(16, 100).optional(),
  monthlyIncome: num(0, 1e7).optional(),
  monthlyExpenses: num(0, 1e7).optional(),
  currentSavings: num(0, 1e10).optional(),
  totalDebt: num(0, 1e10).optional(),
  dependents: num(0, 20).optional(),
  retirementAge: num(40, 90).optional(),
  goals: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
});

function saveProfile(userId: number, b: z.infer<typeof ProfileBody>) {
  const cur = getProfile(userId)!;
  run(
    `UPDATE profiles SET age=?, monthly_income=?, monthly_expenses=?, current_savings=?, total_debt=?, dependents=?, retirement_age=?, goals=?, updated_at=datetime('now') WHERE user_id=?`,
    b.age ?? cur.age, b.monthlyIncome ?? cur.monthly_income, b.monthlyExpenses ?? cur.monthly_expenses,
    b.currentSavings ?? cur.current_savings, b.totalDebt ?? cur.total_debt, b.dependents ?? cur.dependents,
    b.retirementAge ?? cur.retirement_age, JSON.stringify(b.goals ?? cur.goals), userId,
  );
}

profile.get("/", (req, res) => {
  const u = get("SELECT id,email,name,role,created_at FROM users WHERE id = ?", uid(req));
  res.json({ user: u, profile: getProfile(uid(req)) });
});

profile.put("/", (req, res) => {
  saveProfile(uid(req), parse(ProfileBody, req.body));
  res.json({ profile: getProfile(uid(req)) });
});

profile.get("/risk-questions", (_req, res) => res.json({ questions: RISK_QUESTIONS }));

profile.post("/risk", (req, res) => {
  const { answers } = parse(z.object({ answers: z.record(z.string(), z.number().int().min(1).max(5)) }), req.body);
  const p = getProfile(uid(req))!;
  let result;
  try {
    result = assessRisk(answers, { age: p.age, dependents: p.dependents });
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
  run("UPDATE profiles SET risk_score=?, risk_profile=?, updated_at=datetime('now') WHERE user_id=?", result.rounded, result.profile, uid(req));
  res.json({ result });
});

/** Finish onboarding: save the profile and size the default budget to the stated income. */
profile.post("/onboarding", (req, res) => {
  const b = parse(ProfileBody.extend({ monthlyIncome: num(1, 1e7), age: num(16, 100) }), req.body);
  tx(() => {
    saveProfile(uid(req), b);
    const hasPlanned = get<{ n: number }>("SELECT COUNT(*) n FROM categories WHERE user_id=? AND planned>0", uid(req))!.n;
    if (!hasPlanned) {
      run("DELETE FROM categories WHERE user_id = ?", uid(req));
      createDefaultCategories(uid(req), b.monthlyIncome);
    }
    run("UPDATE profiles SET onboarded = 1 WHERE user_id = ?", uid(req));
  });
  res.json({ profile: getProfile(uid(req)) });
});

profile.put("/account", (req, res) => {
  const b = parse(
    z.object({ name: z.string().trim().min(2).max(80).optional(), currentPassword: z.string().optional(), newPassword: z.string().min(8).max(100).optional() }),
    req.body,
  );
  if (b.name) run("UPDATE users SET name = ? WHERE id = ?", b.name, uid(req));
  if (b.newPassword) {
    const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", uid(req))!;
    if (!b.currentPassword || !verifyPassword(b.currentPassword, row.password_hash)) throw new HttpError(400, "Current password is incorrect");
    run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(b.newPassword), uid(req));
  }
  res.json({ user: get("SELECT id,email,name,role FROM users WHERE id = ?", uid(req)) });
});

profile.delete("/", (req, res) => {
  const b = parse(z.object({ password: z.string() }), req.body);
  const row = get<{ password_hash: string; role: string }>("SELECT password_hash, role FROM users WHERE id = ?", uid(req))!;
  if (!verifyPassword(b.password, row.password_hash)) throw new HttpError(400, "Password is incorrect");
  if (row.role === "admin") throw new HttpError(400, "Admin accounts cannot be self-deleted");
  run("DELETE FROM users WHERE id = ?", uid(req));
  res.json({ ok: true });
});
