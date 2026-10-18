import type { NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

// ---- human-readable validation messages ---------------------------------------------------------
// Raw zod text ("Too big: expected number to be <=20") names no field, so translate it.
const LABELS: Record<string, string> = {
  dependents: "Dependents", age: "Age", retirementAge: "Retirement age", lifeExpectancy: "Planning age",
  monthlyIncome: "Monthly income", monthlyExpenses: "Monthly spending", currentSavings: "Savings", totalDebt: "Debt",
  inflation: "Inflation", preReturn: "Return before retirement", postReturn: "Return after retirement", expectedReturn: "Expected return",
  rec_top_n: "Results shown", rec_min_match: "Minimum match score", chat_max_tokens: "Max output tokens", chat_daily_limit: "Daily message limit",
  monthly: "Monthly investment", years: "Years", returnPct: "Expected return", aprPct: "Interest rate", stepUpPct: "Annual step-up",
  balance: "Balance", payment: "Monthly payment", extra: "Extra payment",
  targetAmount: "Target amount", amount: "Amount", sharePct: "Share", fullName: "Full name", dateOfBirth: "Date of birth",
};
/** Fields the API stores as fractions (0.07) but people read as percentages (7%). */
const FRACTIONS = new Set(["inflation", "preReturn", "postReturn", "expectedReturn"]);
/** Fields already expressed in percentage points. */
const POINTS = new Set(["returnPct", "aprPct", "stepUpPct"]);

const labelOf = (path: PropertyKey[]) => {
  const seg = [...path].reverse().find((p) => typeof p === "string") as string | undefined;
  if (!seg) return "Value";
  return LABELS[seg] ?? seg.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
};

export function describeIssue(i: z.core.$ZodIssue): string {
  const seg = [...i.path].reverse().find((p) => typeof p === "string") as string | undefined;
  const fmt = (n: unknown) =>
    seg && FRACTIONS.has(seg) && typeof n === "number" ? `${+(n * 100).toFixed(2)}%` : seg && POINTS.has(seg) ? `${n}%` : String(n);
  const label = labelOf(i.path);
  const a: any = i;
  if (i.code === "custom") return i.message; // refine() messages are already complete sentences
  if (i.code === "too_small" && a.origin === "string" && a.minimum === 1) return `${label} is required`;
  if (i.code === "too_big") {
    const unit = a.origin === "string" ? " characters" : a.origin === "array" ? " items" : "";
    return `${label} must be ${a.inclusive === false ? "less than" : "at most"} ${fmt(a.maximum)}${unit}`;
  }
  if (i.code === "too_small") {
    const unit = a.origin === "string" ? " characters" : a.origin === "array" ? " items" : "";
    return `${label} must be ${a.inclusive === false ? "greater than" : "at least"} ${fmt(a.minimum)}${unit}`;
  }
  if (i.code === "invalid_type") return a.input === undefined || a.message?.includes("received undefined") ? `${label} is required` : `${label} must be a valid ${a.expected === "number" ? "number" : a.expected}`;
  return `${label}: ${i.message}`;
}

const summarize = (issues: z.core.$ZodIssue[]) => {
  const msgs = [...new Set(issues.map(describeIssue))];
  return msgs.slice(0, 3).join("; ") + (msgs.length > 3 ? ` (+${msgs.length - 3} more)` : "");
};

/** Parse + validate untrusted input; throws a 400 whose message names the offending fields. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, summarize(r.error.issues), r.error.issues.map((i) => ({ path: i.path.join("."), message: describeIssue(i) })));
  }
  return r.data;
}

export const intParam = (v: unknown, name = "id") => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
};

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: summarize(err.issues), details: err.issues.map((i) => ({ path: i.path.join("."), message: describeIssue(i) })) });
  }
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
}
