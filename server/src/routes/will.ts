import { Router } from "express";
import { get, run } from "../db.ts";
import { requireAuth, uid } from "../lib/auth.ts";
import { describeIssue, HttpError, parse } from "../lib/http.ts";
import { checkWill, generateWill, WillSchema } from "../will.ts";

export const will = Router();
will.use(requireAuth);

const row = (userId: number) => get<{ id: number; data: string; status: string; generated_at: string | null; updated_at: string }>("SELECT * FROM wills WHERE user_id = ? ORDER BY id DESC LIMIT 1", userId);

will.get("/", (req, res) => {
  const r = row(uid(req));
  res.json(r ? { draft: JSON.parse(r.data), status: r.status, generatedAt: r.generated_at, updatedAt: r.updated_at } : { draft: null, status: "none" });
});

/** Drafts may be incomplete, so only require a JSON object here; strict validation happens on generate. */
will.put("/", (req, res) => {
  if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) throw new HttpError(400, "Draft must be an object");
  const json = JSON.stringify(req.body);
  if (json.length > 200_000) throw new HttpError(413, "Draft too large");
  const r = row(uid(req));
  if (r) run("UPDATE wills SET data=?, status='draft', updated_at=datetime('now') WHERE id=?", json, r.id);
  else run("INSERT INTO wills(user_id,data) VALUES(?,?)", uid(req), json);
  res.json({ ok: true });
});

will.post("/validate", (req, res) => {
  const r = WillSchema.safeParse(req.body);
  if (!r.success) return res.json({ valid: false, errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: describeIssue(i) })), checks: [] });
  res.json({ valid: true, errors: [], checks: checkWill(r.data) });
});

will.post("/generate", (req, res) => {
  const data = parse(WillSchema, req.body);
  const checks = checkWill(data);
  const blocking = checks.filter((c) => c.level === "error");
  if (blocking.length) throw new HttpError(422, blocking.map((b) => b.message).join(" "), checks);
  const doc = generateWill(data);
  const json = JSON.stringify(data);
  const r = row(uid(req));
  if (r) run("UPDATE wills SET data=?, status='generated', generated_at=datetime('now'), updated_at=datetime('now') WHERE id=?", json, r.id);
  else run("INSERT INTO wills(user_id,data,status,generated_at) VALUES(?,?,'generated',datetime('now'))", uid(req), json);
  res.json({ ...doc, checks });
});

will.get("/download", (req, res) => {
  const r = row(uid(req));
  if (!r || r.status !== "generated") throw new HttpError(404, "Generate your will first");
  const doc = generateWill(WillSchema.parse(JSON.parse(r.data)));
  const fmt = req.query.format === "md" ? "md" : "html";
  res.setHeader("Content-Type", fmt === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="last-will-and-testament.${fmt}"`);
  res.send(fmt === "md" ? doc.markdown : doc.html);
});

will.delete("/", (req, res) => {
  run("DELETE FROM wills WHERE user_id = ?", uid(req));
  res.json({ ok: true });
});
