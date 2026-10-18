import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx } from "../db.ts";
import { requireAuth, uid } from "../lib/auth.ts";
import { describeIssue, HttpError, intParam, parse } from "../lib/http.ts";
import { monthSummary, monthlyTrend, financialContext } from "../lib/snapshot.ts";
import { optimizeExpenses, savingsPlan } from "../finance/budget.ts";
import { detectRecurring } from "../finance/recurring.ts";
import { round } from "../finance/math.ts";

export const budget = Router();
budget.use(requireAuth);

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---- categories
const CatBody = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["income", "expense"]),
  bucket: z.enum(["need", "want", "savings"]).default("need"),
  planned: z.number().min(0).max(1e8).default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0f766e"),
});

budget.get("/categories", (req, res) => res.json({ categories: all("SELECT * FROM categories WHERE user_id = ? ORDER BY kind DESC, id", uid(req)) }));

budget.post("/categories", (req, res) => {
  const b = parse(CatBody, req.body);
  if (get("SELECT 1 FROM categories WHERE user_id=? AND name=?", uid(req), b.name)) throw new HttpError(409, "A category with that name already exists");
  const id = run("INSERT INTO categories(user_id,name,kind,bucket,planned,color) VALUES(?,?,?,?,?,?)", uid(req), b.name, b.kind, b.bucket, b.planned, b.color).id;
  res.status(201).json({ category: get("SELECT * FROM categories WHERE id = ?", id) });
});

budget.put("/categories/:id", (req, res) => {
  const id = intParam(req.params.id);
  const b = parse(CatBody.partial(), req.body);
  const cur = get<any>("SELECT * FROM categories WHERE id = ? AND user_id = ?", id, uid(req));
  if (!cur) throw new HttpError(404, "Category not found");
  run("UPDATE categories SET name=?, bucket=?, planned=?, color=? WHERE id=?", b.name ?? cur.name, b.bucket ?? cur.bucket, b.planned ?? cur.planned, b.color ?? cur.color, id);
  res.json({ category: get("SELECT * FROM categories WHERE id = ?", id) });
});

budget.delete("/categories/:id", (req, res) => {
  const r = run("DELETE FROM categories WHERE id = ? AND user_id = ?", intParam(req.params.id), uid(req));
  if (!r.changes) throw new HttpError(404, "Category not found");
  res.json({ ok: true });
});

// ---- summary / analytics
budget.get("/summary", (req, res) => {
  const month = req.query.month ? parse(Month, req.query.month) : undefined;
  const ms = monthSummary(uid(req), month);
  const ctx = financialContext(uid(req));
  res.json({
    ...ms,
    optimization: optimizeExpenses(ms.expenseCategories),
    savingsPlan: savingsPlan({ income: ctx.income, expenses: ctx.expenses, savings: ctx.savings, debt: ctx.debt, age: ctx.age, dependents: ctx.dependents }),
  });
});

budget.get("/trend", (req, res) => {
  const months = Math.min(24, Math.max(2, Number(req.query.months) || 6));
  res.json({ trend: monthlyTrend(uid(req), months) });
});

// ---- recurring bills & subscriptions
budget.get("/recurring", (req, res) => {
  const rows = all<any>(
    `SELECT t.date, t.amount, t.note, c.name AS category, c.id AS categoryId, c.kind, c.bucket
       FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND t.date >= date('now','-14 months')`,
    uid(req),
  );
  // transfers into savings are not bills
  const r = detectRecurring(rows.filter((t) => t.bucket !== "savings"));
  const income = r.items.filter((i) => i.kind === "income");
  res.json({ ...r, items: r.items.filter((i) => i.kind === "expense"), upcoming: r.upcoming.filter((i) => i.kind === "expense"), income, monthlyIncome: round(income.reduce((a, i) => a + i.amount, 0), 2) });
});

// ---- reports: category trends and top merchants
budget.get("/report", (req, res) => {
  const n = Math.min(12, Math.max(2, Number(req.query.months) || 6));
  const months = monthlyTrend(uid(req), n);
  const keys = months.map((m) => m.month);
  const rows = all<{ m: string; id: number; name: string; color: string; bucket: string; total: number }>(
    `SELECT substr(t.date,1,7) m, c.id, c.name, c.color, c.bucket, SUM(t.amount) total
       FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND c.kind = 'expense' AND c.bucket != 'savings' AND substr(t.date,1,7) BETWEEN ? AND ?
      GROUP BY m, c.id`,
    uid(req), keys[0], keys[keys.length - 1],
  );
  const byCat = new Map<number, { id: number; name: string; color: string; bucket: string; totals: number[] }>();
  for (const r of rows) {
    if (!byCat.has(r.id)) byCat.set(r.id, { id: r.id, name: r.name, color: r.color, bucket: r.bucket, totals: keys.map(() => 0) });
    byCat.get(r.id)!.totals[keys.indexOf(r.m)] = round(r.total);
  }
  const completed = Math.max(1, keys.length - (keys[keys.length - 1] === new Date().toISOString().slice(0, 7) ? 1 : 0));
  const categories = [...byCat.values()].map((c) => {
    const done = c.totals.slice(0, completed); // average over finished months only — the current month is partial
    const avg = done.reduce((a, b) => a + b, 0) / done.length;
    const prev = done.length >= 2 ? done[done.length - 2] : 0;
    const last = done[done.length - 1];
    return { ...c, avg: round(avg), last: round(last), changePct: prev > 0 ? round(((last - prev) / prev) * 100, 1) : null, total: round(c.totals.reduce((a, b) => a + b, 0)) };
  }).sort((a, b) => b.total - a.total);
  const merchants = all<any>(
    `SELECT MIN(t.note) name, c.name category, ROUND(SUM(t.amount),2) total, COUNT(*) count
       FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND c.kind = 'expense' AND c.bucket != 'savings' AND t.note != '' AND substr(t.date,1,7) >= ?
      GROUP BY lower(trim(t.note)), c.id ORDER BY total DESC LIMIT 10`,
    uid(req), keys[0],
  );
  res.json({ months: keys, totals: months, categories, merchants });
});

// ---- CSV export / import
const csvText = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

budget.get("/transactions/export", (req, res) => {
  const month = req.query.month ? parse(Month, req.query.month) : undefined;
  const rows = all<any>(
    `SELECT t.date, c.kind, c.name AS category, t.amount, t.note FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? ${month ? "AND substr(t.date,1,7) = ?" : ""} ORDER BY t.date, t.id`,
    uid(req), ...(month ? [month] : []),
  );
  const csv = ["date,type,category,amount,note", ...rows.map((r) => [r.date, r.kind, csvText(r.category), r.amount.toFixed(2), csvText(r.note)].join(","))].join("\r\n") + "\r\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="finvara-transactions${month ? `-${month}` : ""}.csv"`);
  res.send(csv);
});

const ImportRow = z.object({
  date: IsoDate,
  amount: z.number().positive().max(1e9),
  kind: z.enum(["income", "expense"]),
  category: z.string().trim().min(1).max(40),
  note: z.string().trim().max(200).default(""),
});
const COLORS = ["#0f766e", "#4f46e5", "#d97706", "#db2777", "#0284c7", "#65a30d", "#7c3aed", "#e11d48"];

budget.post("/transactions/import", (req, res) => {
  const body = z.object({ rows: z.array(z.unknown()).min(1, "No rows to import").max(1000, "Import at most 1,000 rows at a time") }).safeParse(req.body);
  if (!body.success) throw new HttpError(400, body.error.issues[0].message);
  const errors: { row: number; message: string }[] = [];
  const valid: z.infer<typeof ImportRow>[] = [];
  body.data.rows.forEach((raw, i) => {
    const r = ImportRow.safeParse(raw);
    if (r.success) valid.push(r.data);
    else errors.push({ row: i + 1, message: describeIssue(r.error.issues[0]) });
  });
  let imported = 0, skipped = 0;
  const created: string[] = [];
  tx(() => {
    const cats = new Map(all<any>("SELECT id, name, kind FROM categories WHERE user_id = ?", uid(req)).map((c) => [`${c.kind}|${c.name.toLowerCase()}`, c.id as number]));
    const seen = new Set(all<any>("SELECT date, amount, note, category_id FROM transactions WHERE user_id = ?", uid(req)).map((t) => `${t.date}|${Number(t.amount).toFixed(2)}|${t.note.toLowerCase()}|${t.category_id}`));
    for (const r of valid) {
      const key = `${r.kind}|${r.category.toLowerCase()}`;
      let id = cats.get(key);
      if (!id) {
        id = run("INSERT INTO categories(user_id,name,kind,bucket,planned,color) VALUES(?,?,?,?,0,?)", uid(req), r.category, r.kind, r.kind === "income" ? "need" : "want", COLORS[cats.size % COLORS.length]).id;
        cats.set(key, id);
        created.push(r.category);
      }
      const dupe = `${r.date}|${r.amount.toFixed(2)}|${r.note.toLowerCase()}|${id}`;
      if (seen.has(dupe)) { skipped++; continue; }
      seen.add(dupe);
      run("INSERT INTO transactions(user_id,category_id,amount,date,note) VALUES(?,?,?,?,?)", uid(req), id, r.amount, r.date, r.note);
      imported++;
    }
  });
  res.status(201).json({ imported, skipped, createdCategories: [...new Set(created)], errors: errors.slice(0, 20), errorCount: errors.length });
});

// ---- transactions
const TxBody = z.object({
  categoryId: z.number().int().positive(),
  amount: z.number().positive().max(1e9),
  date: IsoDate,
  note: z.string().trim().max(200).default(""),
});

function assertOwnsCategory(userId: number, categoryId: number) {
  if (!get("SELECT 1 FROM categories WHERE id = ? AND user_id = ?", categoryId, userId)) throw new HttpError(400, "Unknown category");
}

budget.get("/transactions", (req, res) => {
  const month = req.query.month ? parse(Month, req.query.month) : undefined;
  const cat = req.query.categoryId ? intParam(req.query.categoryId, "categoryId") : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60).toLowerCase() : "";
  const rows = all(
    `SELECT t.id, t.category_id AS categoryId, c.name AS category, c.kind, c.color, t.amount, t.date, t.note
       FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? ${month ? "AND substr(t.date,1,7) = ?" : ""} ${cat ? "AND t.category_id = ?" : ""} ${q ? "AND (lower(t.note) LIKE ? OR lower(c.name) LIKE ?)" : ""}
      ORDER BY t.date DESC, t.id DESC LIMIT 500`,
    uid(req), ...(month ? [month] : []), ...(cat ? [cat] : []), ...(q ? [`%${q}%`, `%${q}%`] : []),
  );
  res.json({ transactions: rows });
});

budget.post("/transactions", (req, res) => {
  const b = parse(TxBody, req.body);
  assertOwnsCategory(uid(req), b.categoryId);
  const id = run("INSERT INTO transactions(user_id,category_id,amount,date,note) VALUES(?,?,?,?,?)", uid(req), b.categoryId, b.amount, b.date, b.note).id;
  res.status(201).json({ id });
});

budget.put("/transactions/:id", (req, res) => {
  const id = intParam(req.params.id);
  const b = parse(TxBody, req.body);
  assertOwnsCategory(uid(req), b.categoryId);
  const r = run("UPDATE transactions SET category_id=?, amount=?, date=?, note=? WHERE id=? AND user_id=?", b.categoryId, b.amount, b.date, b.note, id, uid(req));
  if (!r.changes) throw new HttpError(404, "Transaction not found");
  res.json({ ok: true });
});

budget.delete("/transactions/:id", (req, res) => {
  const r = run("DELETE FROM transactions WHERE id = ? AND user_id = ?", intParam(req.params.id), uid(req));
  if (!r.changes) throw new HttpError(404, "Transaction not found");
  res.json({ ok: true });
});

// ---- savings goals
const GoalBody = z.object({ name: z.string().trim().min(1).max(80), target: z.number().positive().max(1e10), current: z.number().min(0).max(1e10).default(0), deadline: IsoDate.nullable().optional() });

budget.get("/goals", (req, res) => res.json({ goals: all("SELECT * FROM savings_goals WHERE user_id = ? ORDER BY id", uid(req)) }));
budget.post("/goals", (req, res) => {
  const b = parse(GoalBody, req.body);
  const id = run("INSERT INTO savings_goals(user_id,name,target,current,deadline) VALUES(?,?,?,?,?)", uid(req), b.name, b.target, b.current, b.deadline ?? null).id;
  res.status(201).json({ goal: get("SELECT * FROM savings_goals WHERE id = ?", id) });
});
budget.put("/goals/:id", (req, res) => {
  const id = intParam(req.params.id);
  const b = parse(GoalBody, req.body);
  const r = run("UPDATE savings_goals SET name=?, target=?, current=?, deadline=? WHERE id=? AND user_id=?", b.name, b.target, b.current, b.deadline ?? null, id, uid(req));
  if (!r.changes) throw new HttpError(404, "Goal not found");
  res.json({ goal: get("SELECT * FROM savings_goals WHERE id = ?", id) });
});
budget.post("/goals/:id/contribute", (req, res) => {
  const id = intParam(req.params.id);
  const { amount } = parse(z.object({ amount: z.number().positive().max(1e9) }), req.body);
  const r = run("UPDATE savings_goals SET current = current + ? WHERE id=? AND user_id=?", amount, id, uid(req));
  if (!r.changes) throw new HttpError(404, "Goal not found");
  res.json({ goal: get("SELECT * FROM savings_goals WHERE id = ?", id) });
});
budget.delete("/goals/:id", (req, res) => {
  const r = run("DELETE FROM savings_goals WHERE id=? AND user_id=?", intParam(req.params.id), uid(req));
  if (!r.changes) throw new HttpError(404, "Goal not found");
  res.json({ ok: true });
});
