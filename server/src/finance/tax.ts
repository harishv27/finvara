import { TAX } from "./constants.ts";
import { round } from "./math.ts";

export function federalTax(taxableIncome: number) {
  let tax = 0;
  let prev = 0;
  let marginal = TAX.brackets[0][1];
  for (const [upper, rate] of TAX.brackets) {
    if (taxableIncome > prev) {
      tax += (Math.min(taxableIncome, upper) - prev) * rate;
      marginal = rate;
    }
    prev = upper;
  }
  return { tax: round(tax), marginalRate: marginal, effectiveRate: taxableIncome > 0 ? round(tax / taxableIncome, 4) : 0 };
}

export interface TaxStrategyInput {
  annualIncome: number;
  current401k?: number;
  currentIra?: number;
  currentHsa?: number;
  hasHighDeductibleHealthPlan?: boolean;
  hasChildren?: boolean;
  taxableInvestmentGains?: number;
}

export interface TaxPlan {
  taxableIncome: number;
  baseline: ReturnType<typeof federalTax>;
  strategies: {
    name: string;
    room: number;
    suggestedContribution: number;
    estimatedTaxSaved: number;
    why: string;
  }[];
  totalEstimatedSaving: number;
  notes: string[];
  disclaimer: string;
}

export function planTax(i: TaxStrategyInput): TaxPlan {
  const taxable = Math.max(0, i.annualIncome - TAX.standardDeduction);
  const baseline = federalTax(taxable);
  const m = baseline.marginalRate;
  const strategies: TaxPlan["strategies"] = [];

  const room401k = Math.max(0, TAX.limits.retirement401k - (i.current401k ?? 0));
  if (room401k > 0)
    strategies.push({
      name: "Workplace 401(k)-style pre-tax plan",
      room: room401k,
      suggestedContribution: round(Math.min(room401k, i.annualIncome * 0.15)),
      estimatedTaxSaved: round(Math.min(room401k, i.annualIncome * 0.15) * m),
      why: "Pre-tax contributions lower taxable income today and grow tax-deferred.",
    });

  const roomIra = Math.max(0, TAX.limits.ira - (i.currentIra ?? 0));
  if (roomIra > 0) {
    const roth = m <= 0.22;
    strategies.push({
      name: roth ? "Roth IRA" : "Traditional IRA",
      room: roomIra,
      suggestedContribution: roomIra,
      estimatedTaxSaved: roth ? 0 : round(roomIra * m),
      why: roth
        ? "At your bracket, paying tax now and withdrawing tax-free later is usually the better trade."
        : "In a higher bracket the upfront deduction is worth more than tax-free withdrawals (subject to income phase-outs).",
    });
  }

  if (i.hasHighDeductibleHealthPlan) {
    const roomHsa = Math.max(0, TAX.limits.hsa - (i.currentHsa ?? 0));
    if (roomHsa > 0)
      strategies.push({
        name: "Health Savings Account (HSA)",
        room: roomHsa,
        suggestedContribution: roomHsa,
        estimatedTaxSaved: round(roomHsa * m),
        why: "Triple tax advantage: deductible in, tax-free growth, tax-free for medical expenses.",
      });
  }

  if (i.hasChildren)
    strategies.push({
      name: "529 education savings plan",
      room: TAX.limits.education529Suggested,
      suggestedContribution: round(Math.min(TAX.limits.education529Suggested, i.annualIncome * 0.05)),
      estimatedTaxSaved: 0,
      why: "Growth is tax-free for qualified education costs; some states add a deduction.",
    });

  const notes = [
    `Your marginal federal rate is about ${(m * 100).toFixed(0)}%; effective rate ${(baseline.effectiveRate * 100).toFixed(1)}%.`,
    `Hold investments > 1 year to qualify for long-term capital-gains rates (~${TAX.longTermCapGainsRate * 100}% vs ordinary rates).`,
    "Harvest losses in taxable accounts to offset gains, and place bond funds in tax-advantaged accounts first.",
  ];
  if ((i.taxableInvestmentGains ?? 0) > 0)
    notes.push(`Estimated tax on ${Math.round(i.taxableInvestmentGains!).toLocaleString()} of long-term gains: ${Math.round(i.taxableInvestmentGains! * TAX.longTermCapGainsRate).toLocaleString()}.`);

  return {
    taxableIncome: round(taxable),
    baseline,
    strategies,
    totalEstimatedSaving: round(strategies.reduce((a, s) => a + s.estimatedTaxSaved, 0)),
    notes,
    disclaimer: `Illustrative ${TAX.year} US federal single-filer figures for educational purposes — not tax advice. Rules differ by country, state and personal situation.`,
  };
}
