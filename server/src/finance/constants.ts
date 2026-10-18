/**
 * Illustrative US-style tax parameters used by the tax-optimisation tool.
 * These are examples for a portfolio project — update them (or swap for a tax API) before real use.
 */
export const TAX = {
  year: 2025,
  standardDeduction: 15750,
  // Single-filer federal brackets: [upper bound, rate]
  brackets: [
    [11925, 0.1],
    [48475, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250525, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ] as [number, number][],
  limits: {
    retirement401k: 23500,
    ira: 7000,
    hsa: 4300,
    education529Suggested: 18000, // gift-tax annual exclusion, illustrative
  },
  longTermCapGainsRate: 0.15,
  shortTermCapGainsRate: "ordinary income rates",
};

/** Typical savings potential by expense category (share of spend that can often be trimmed). */
export const OPTIMIZATION_BENCHMARKS: Record<string, { pct: number; tips: string[] }> = {
  dining: {
    pct: 0.2,
    tips: ["Cap restaurant meals at a weekly budget", "Batch-cook two dinners per week", "Use lunch specials instead of dinner outings"],
  },
  subscriptions: {
    pct: 0.3,
    tips: ["Cancel services unused for 30 days", "Switch to annual plans for the ones you keep", "Share family plans where terms allow"],
  },
  entertainment: {
    pct: 0.15,
    tips: ["Rotate streaming services month to month", "Look for free community events", "Set a fixed monthly fun-money allowance"],
  },
  shopping: {
    pct: 0.2,
    tips: ["Add a 48-hour wait rule for non-essentials", "Unsubscribe from promo emails", "Buy quality basics once rather than cheap ones repeatedly"],
  },
  groceries: {
    pct: 0.08,
    tips: ["Plan meals and shop from a list", "Compare unit prices; try store brands", "Buy staples in bulk when on sale"],
  },
  transport: {
    pct: 0.1,
    tips: ["Re-quote auto insurance annually", "Combine errands into fewer trips", "Check transit passes versus fuel + parking"],
  },
  utilities: {
    pct: 0.1,
    tips: ["Audit phone/internet plans for cheaper tiers", "Use a smart thermostat schedule", "Switch to LED bulbs and unplug idle devices"],
  },
  insurance: {
    pct: 0.05,
    tips: ["Bundle home and auto policies", "Raise deductibles if your emergency fund is solid", "Re-shop coverage every year"],
  },
  travel: {
    pct: 0.15,
    tips: ["Travel off-peak and book early", "Use points for flights/hotels", "Set a dedicated travel sinking fund"],
  },
  default: {
    pct: 0.05,
    tips: ["Review the last three months of transactions for surprises", "Negotiate recurring bills once a year"],
  },
};
