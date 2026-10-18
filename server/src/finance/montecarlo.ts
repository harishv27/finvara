import { hashString, rng } from "../lib/rng.ts";
import { clamp, round } from "./math.ts";

export interface MonteCarloInput {
  age: number;
  retirementAge: number;
  lifeExpectancy: number;
  currentSavings: number;
  monthlyContribution: number;
  /** Desired retirement spending per year, in today's dollars, net of pensions. */
  annualNeedToday: number;
  inflation: number;
  preReturn: number; // expected nominal return before retirement
  postReturn: number; // expected nominal return after retirement
  preVolatility?: number; // annual standard deviation
  postVolatility?: number;
  runs?: number;
}

export interface BandPoint { age: number; p10: number; p50: number; p90: number }
export interface MonteCarloResult {
  runs: number;
  successProbability: number; // 0..1 — money lasts to `lifeExpectancy`
  atRetirement: { p10: number; p50: number; p90: number };
  medianDepletionAge: number | null; // among failed runs
  bands: BandPoint[];
  assumptions: { preVolatility: number; postVolatility: number };
}

/** Lognormal annual return with a given arithmetic mean and standard deviation. */
function annualReturn(mean: number, vol: number, z: number) {
  if (vol <= 0) return mean;
  const sigma2 = Math.log(1 + (vol / (1 + mean)) ** 2);
  const mu = Math.log(1 + mean) - sigma2 / 2;
  return Math.exp(mu + Math.sqrt(sigma2) * z) - 1;
}

const pctile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

/**
 * Yearly Monte Carlo of the whole life path: accumulate until retirement, then withdraw an inflating
 * amount. Seeded from the inputs so the same plan always gives the same answer (no flicker in the UI).
 */
export function simulateRetirement(i: MonteCarloInput): MonteCarloResult {
  const runs = i.runs ?? 1000;
  const preVol = i.preVolatility ?? 0.12;
  const postVol = i.postVolatility ?? 0.08;
  const yrsTo = Math.max(0, Math.round(i.retirementAge - i.age));
  const total = Math.max(yrsTo + 1, Math.round(i.lifeExpectancy - i.age));
  const r = rng(hashString(JSON.stringify([i.age, i.retirementAge, i.lifeExpectancy, i.currentSavings, i.monthlyContribution, i.annualNeedToday, i.inflation, i.preReturn, i.postReturn, preVol, postVol])));

  const paths: number[][] = []; // balance at the START of each year index 0..total
  const retBalances: number[] = [];
  const depletion: number[] = [];
  let ok = 0;

  for (let n = 0; n < runs; n++) {
    let bal = i.currentSavings;
    const path = [bal];
    let failedAt: number | null = null;
    for (let y = 0; y < total; y++) {
      const retired = y >= yrsTo;
      const z = r.normal();
      if (!retired) {
        // contributions arrive through the year; credit half a year of growth on them
        const g = annualReturn(i.preReturn, preVol, z);
        bal = bal * (1 + g) + i.monthlyContribution * 12 * (1 + g / 2);
      } else {
        const need = i.annualNeedToday * (1 + i.inflation) ** y;
        bal -= need;
        if (bal <= 0) {
          bal = 0;
          if (failedAt == null) failedAt = i.age + y;
        } else bal *= 1 + annualReturn(i.postReturn, postVol, z);
      }
      path.push(bal);
      if (y + 1 === yrsTo) retBalances.push(bal);
    }
    if (yrsTo === 0) retBalances.push(i.currentSavings);
    if (failedAt == null) ok++;
    else depletion.push(failedAt);
    paths.push(path);
  }

  const bands: BandPoint[] = [];
  for (let y = 0; y <= total; y++) {
    const col = paths.map((p) => p[y]).sort((a, b) => a - b);
    bands.push({ age: i.age + y, p10: round(pctile(col, 0.1), 0), p50: round(pctile(col, 0.5), 0), p90: round(pctile(col, 0.9), 0) });
  }
  const rb = [...retBalances].sort((a, b) => a - b);
  depletion.sort((a, b) => a - b);
  return {
    runs,
    successProbability: round(clamp(ok / runs, 0, 1), 3),
    atRetirement: { p10: round(pctile(rb, 0.1), 0), p50: round(pctile(rb, 0.5), 0), p90: round(pctile(rb, 0.9), 0) },
    medianDepletionAge: depletion.length ? depletion[Math.floor(depletion.length / 2)] : null,
    bands,
    assumptions: { preVolatility: preVol, postVolatility: postVol },
  };
}
