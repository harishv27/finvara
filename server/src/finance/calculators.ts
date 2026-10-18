import { fvLump, monthlyRate, round } from "./math.ts";

export interface YearPoint { year: number; invested: number; value: number }

/** Systematic investment plan: monthly contribution, optional yearly step-up. */
export function sip(i: { monthly: number; years: number; annualReturn: number; stepUpPct?: number }) {
  const r = monthlyRate(i.annualReturn);
  const step = (i.stepUpPct ?? 0) / 100;
  let value = 0;
  let invested = 0;
  let monthly = i.monthly;
  const series: YearPoint[] = [{ year: 0, invested: 0, value: 0 }];
  for (let y = 1; y <= i.years; y++) {
    for (let m = 0; m < 12; m++) {
      value = (value + monthly) * (1 + r); // contribution at start of month
      invested += monthly;
    }
    monthly *= 1 + step;
    series.push({ year: y, invested: round(invested), value: round(value) });
  }
  return { invested: round(invested), futureValue: round(value), gain: round(value - invested), multiple: invested ? round(value / invested, 2) : 0, series };
}

export function lumpsum(i: { amount: number; years: number; annualReturn: number }) {
  const series: YearPoint[] = [];
  for (let y = 0; y <= i.years; y++) series.push({ year: y, invested: round(i.amount), value: round(fvLump(i.amount, i.annualReturn, y * 12)) });
  const fv = series[series.length - 1].value;
  return { invested: round(i.amount), futureValue: fv, gain: round(fv - i.amount), multiple: i.amount ? round(fv / i.amount, 2) : 0, series };
}

export interface DebtScenario { months: number | null; totalInterest: number | null; totalPaid: number | null }
function payoff(balance: number, apr: number, payment: number, cap = 12 * 100): DebtScenario & { balances: number[] } {
  const r = apr / 12;
  let bal = balance;
  let interest = 0;
  const balances = [round(bal)];
  for (let m = 1; m <= cap; m++) {
    const i = bal * r;
    if (payment <= i + 1e-9 && bal > 0) return { months: null, totalInterest: null, totalPaid: null, balances };
    interest += i;
    bal = bal + i - payment;
    if (bal <= 0) {
      balances.push(0); // the final payment is smaller than `payment`; total paid is still balance + interest
      return { months: m, totalInterest: round(interest), totalPaid: round(balance + interest), balances };
    }
    balances.push(round(bal));
  }
  return { months: null, totalInterest: null, totalPaid: null, balances };
}

/** Debt payoff with and without an extra monthly payment ("what does $100 more do?"). */
export function debtPayoff(i: { balance: number; apr: number; payment: number; extra: number }) {
  const apr = i.apr / 100;
  const base = payoff(i.balance, apr, i.payment);
  const boosted = payoff(i.balance, apr, i.payment + i.extra);
  const minPayment = (i.balance * apr) / 12;
  return {
    minimumToCoverInterest: round(minPayment + 0.01, 2),
    base: { months: base.months, totalInterest: base.totalInterest, totalPaid: base.totalPaid },
    withExtra: { months: boosted.months, totalInterest: boosted.totalInterest, totalPaid: boosted.totalPaid },
    interestSaved: base.totalInterest != null && boosted.totalInterest != null ? round(base.totalInterest - boosted.totalInterest) : null,
    monthsSaved: base.months != null && boosted.months != null ? base.months - boosted.months : null,
    series: Array.from({ length: Math.min(Math.max(base.balances.length, boosted.balances.length), 12 * 40) }, (_, m) => ({
      month: m, base: base.balances[m] ?? 0, withExtra: boosted.balances[m] ?? 0,
    })).filter((_, idx, arr) => arr.length <= 120 || idx % Math.ceil(arr.length / 120) === 0),
  };
}
