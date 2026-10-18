import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { debtPayoff, lumpsum, sip } from "../finance/calculators.ts";
import { parse } from "../lib/http.ts";

/** Public, stateless calculators — no account needed (value first, sign-up later). */
export const calc = Router();
calc.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests, slow down a little." } }));

calc.post("/sip", (req, res) => {
  const b = parse(z.object({ monthly: z.number().positive().max(1e7), years: z.number().int().min(1).max(60), returnPct: z.number().min(0).max(30), stepUpPct: z.number().min(0).max(50).default(0) }), req.body);
  res.json(sip({ monthly: b.monthly, years: b.years, annualReturn: b.returnPct / 100, stepUpPct: b.stepUpPct }));
});

calc.post("/lumpsum", (req, res) => {
  const b = parse(z.object({ amount: z.number().positive().max(1e10), years: z.number().int().min(1).max(60), returnPct: z.number().min(0).max(30) }), req.body);
  res.json(lumpsum({ amount: b.amount, years: b.years, annualReturn: b.returnPct / 100 }));
});

calc.post("/debt", (req, res) => {
  const b = parse(z.object({ balance: z.number().positive().max(1e9), aprPct: z.number().min(0).max(100), payment: z.number().positive().max(1e8), extra: z.number().min(0).max(1e8).default(0) }), req.body);
  res.json(debtPayoff({ balance: b.balance, apr: b.aprPct, payment: b.payment, extra: b.extra }));
});
