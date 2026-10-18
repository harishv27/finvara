import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { get, run, getSetting, tx } from "../db.ts";
import { hashPassword, requireAuth, signToken, verifyPassword, type AuthUser } from "../lib/auth.ts";
import { HttpError, parse } from "../lib/http.ts";
import { createDefaultCategories } from "../seed.ts";

export const auth = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts, try again later." } });

const SignupBody = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "At least 8 characters").max(100),
});

auth.post("/signup", limiter, (req, res) => {
  if (!getSetting("registration_open")) throw new HttpError(403, "Registration is currently closed");
  const b = parse(SignupBody, req.body);
  if (get("SELECT 1 FROM users WHERE email = ?", b.email)) throw new HttpError(409, "An account with this email already exists");
  const id = tx(() => {
    const id = run("INSERT INTO users(email,name,password_hash) VALUES(?,?,?)", b.email, b.name, hashPassword(b.password)).id;
    run("INSERT INTO profiles(user_id) VALUES(?)", id);
    createDefaultCategories(id);
    return id;
  });
  const user: AuthUser = { id, email: b.email, name: b.name, role: "user" };
  res.status(201).json({ token: signToken(user), user });
});

auth.post("/login", limiter, (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }), req.body);
  const row = get<{ id: number; email: string; name: string; role: "user" | "admin"; password_hash: string; active: number }>(
    "SELECT id,email,name,role,password_hash,active FROM users WHERE email = ?",
    b.email,
  );
  // Same message for unknown email and wrong password to avoid account enumeration.
  if (!row || !verifyPassword(b.password, row.password_hash)) throw new HttpError(401, "Invalid email or password");
  if (!row.active) throw new HttpError(403, "This account has been deactivated");
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", row.id);
  const user: AuthUser = { id: row.id, email: row.email, name: row.name, role: row.role };
  res.json({ token: signToken(user), user });
});

auth.get("/me", requireAuth, (req, res) => {
  const onboarded = get<{ onboarded: number }>("SELECT onboarded FROM profiles WHERE user_id = ?", req.user!.id)?.onboarded === 1;
  res.json({ user: req.user, onboarded });
});
