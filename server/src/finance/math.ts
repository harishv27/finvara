// Pure financial math. No I/O — everything here is unit-tested.

export const round = (n: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Monthly rate equivalent to an annual effective rate. */
export const monthlyRate = (annual: number) => (1 + annual) ** (1 / 12) - 1;

/** Future value of a lump sum after `months`. */
export function fvLump(principal: number, annualRate: number, months: number) {
  return principal * (1 + monthlyRate(annualRate)) ** months;
}

/** Future value of equal end-of-month contributions. */
export function fvContributions(monthly: number, annualRate: number, months: number) {
  const r = monthlyRate(annualRate);
  if (months <= 0) return 0;
  if (Math.abs(r) < 1e-12) return monthly * months;
  return (monthly * ((1 + r) ** months - 1)) / r;
}

export const fvTotal = (current: number, monthly: number, annualRate: number, months: number) =>
  fvLump(current, annualRate, months) + fvContributions(monthly, annualRate, months);

/** Monthly contribution needed to reach `target` (0 if already on track from the lump sum alone). */
export function requiredMonthly(target: number, current: number, annualRate: number, months: number) {
  if (months <= 0) return Math.max(0, target - current);
  const gap = target - fvLump(current, annualRate, months);
  if (gap <= 0) return 0;
  const r = monthlyRate(annualRate);
  if (Math.abs(r) < 1e-12) return gap / months;
  return (gap * r) / ((1 + r) ** months - 1);
}

/** Months until balance reaches target (null when unreachable within `cap` months). */
export function monthsToTarget(
  target: number,
  current: number,
  monthly: number,
  annualRate: number,
  cap = 12 * 80,
) {
  if (current >= target) return 0;
  const r = monthlyRate(annualRate);
  let bal = current;
  for (let m = 1; m <= cap; m++) {
    bal = bal * (1 + r) + monthly;
    if (bal >= target) return m;
  }
  return null;
}

export interface SeriesPoint {
  month: number;
  label: string;
  balance: number;
  contributed: number;
}

/** Month-by-month projection, sampled every `step` months (always includes the last month). */
export function projectSeries(
  current: number,
  monthly: number,
  annualRate: number,
  months: number,
  startDate = new Date(),
  step = 1,
): SeriesPoint[] {
  const r = monthlyRate(annualRate);
  const out: SeriesPoint[] = [];
  let bal = current;
  let contributed = current;
  for (let m = 0; m <= months; m++) {
    if (m > 0) {
      bal = bal * (1 + r) + monthly;
      contributed += monthly;
    }
    if (m % step === 0 || m === months) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth() + m, 1);
      out.push({
        month: m,
        label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        balance: round(bal),
        contributed: round(contributed),
      });
    }
  }
  return out;
}

export function monthsUntil(dateStr: string, from = new Date()) {
  const d = new Date(dateStr + "T00:00:00");
  return (d.getFullYear() - from.getFullYear()) * 12 + (d.getMonth() - from.getMonth());
}

export const today = () => new Date().toISOString().slice(0, 10);
export const monthKey = (d: Date | string) =>
  (typeof d === "string" ? d : d.toISOString()).slice(0, 7);

/**
 * Suggested asset mix from risk (1..5) and horizon in years.
 * Equity share falls as the horizon shortens (glide path), bounded by the risk profile.
 */
export function suggestAllocation(riskScore: number, horizonYears: number) {
  const base = { 1: 25, 2: 40, 3: 55, 4: 70, 5: 85 }[clamp(Math.round(riskScore), 1, 5) as 1 | 2 | 3 | 4 | 5];
  const horizonAdj =
    horizonYears >= 15 ? 10 : horizonYears >= 10 ? 5 : horizonYears >= 5 ? 0 : horizonYears >= 3 ? -15 : -30;
  const equity = clamp(base + horizonAdj, 5, 95);
  const cash = horizonYears < 3 ? 25 : horizonYears < 7 ? 10 : 5;
  const bonds = clamp(100 - equity - cash, 0, 100);
  const total = equity + bonds + cash;
  return {
    equity: round((equity / total) * 100, 0),
    bonds: round((bonds / total) * 100, 0),
    cash: round((cash / total) * 100, 0),
  };
}

/** Expected nominal annual return for an allocation (long-run illustrative assumptions). */
export function expectedReturn(a: { equity: number; bonds: number; cash: number }) {
  return (a.equity * 0.085 + a.bonds * 0.04 + a.cash * 0.02) / 100;
}

export const riskProfileFromScore = (score: number): "conservative" | "moderate" | "aggressive" =>
  score <= 2 ? "conservative" : score >= 4 ? "aggressive" : "moderate";
