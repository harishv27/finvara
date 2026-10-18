import { round } from "./math.ts";

export interface InsuranceInput {
  annualIncome: number;
  age: number;
  dependents: number;
  debt: number;
  liquidSavings: number;
  existingLifeCover?: number;
  existingHealthCover?: boolean;
  monthlyExpenses?: number;
  yearsOfIncomeToReplace?: number;
}

export interface InsurancePlan {
  life: {
    recommendedCover: number;
    components: { label: string; amount: number }[];
    existing: number;
    gap: number;
    termYears: number;
    estimatedPremiumMonthly: number;
  };
  disability: { recommendedMonthlyBenefit: number; why: string };
  health: { priority: "critical" | "recommended" | "ok"; notes: string[] };
  emergencyFund: { months: number; amount: number };
  priorities: string[];
}

export function planInsurance(i: InsuranceInput): InsurancePlan {
  const years = i.yearsOfIncomeToReplace ?? (i.dependents > 0 ? 10 : i.age >= 55 ? 3 : 5);
  const incomeReplacement = i.annualIncome * years * (i.dependents > 0 ? 1 : 0.5);
  const education = i.dependents * 50000;
  const finalExpenses = 15000;
  const components = [
    { label: `Income replacement (${years} yrs)`, amount: round(incomeReplacement) },
    { label: "Outstanding debt", amount: round(i.debt) },
    { label: "Education funding", amount: round(education) },
    { label: "Final expenses", amount: finalExpenses },
  ];
  const gross = components.reduce((a, c) => a + c.amount, 0);
  const recommended = Math.max(0, gross - i.liquidSavings);
  const existing = i.existingLifeCover ?? 0;
  const gap = Math.max(0, recommended - existing);
  const termYears = Math.max(10, Math.min(30, 65 - i.age));
  // Rough term-life rate: ~$0.9 per $1k of cover per YEAR at age 30, rising ~7%/yr of age (illustrative).
  const ratePer1k = 0.9 * 1.07 ** (i.age - 30);
  const premium = (gap / 1000) * ratePer1k;
  const monthlyExpenses = i.monthlyExpenses ?? (i.annualIncome / 12) * 0.7;
  const efMonths = i.dependents > 0 ? 6 : 4;

  const healthNotes: string[] = [];
  let healthPriority: InsurancePlan["health"]["priority"] = "ok";
  if (!i.existingHealthCover) {
    healthPriority = "critical";
    healthNotes.push("No health cover on record — a single hospitalisation can erase years of savings. Get a plan before investing further.");
  } else {
    healthNotes.push("Check your annual out-of-pocket maximum is no more than ~5% of your income.");
    if (i.dependents > 0) {
      healthPriority = "recommended";
      healthNotes.push("Confirm dependents are covered; consider a family floater if you pay separately.");
    }
    if (i.age >= 40) healthNotes.push("Consider a top-up / critical-illness rider — claim sizes rise sharply after 40.");
  }

  const priorities: string[] = [];
  if (!i.existingHealthCover) priorities.push("Secure health insurance");
  if (gap > 0 && i.dependents > 0) priorities.push(`Close the ${Math.round(gap).toLocaleString()} life-cover gap with term insurance`);
  priorities.push("Add income-protection (disability) cover if your income depends on working");
  priorities.push(`Hold ${efMonths} months of expenses (${Math.round(monthlyExpenses * efMonths).toLocaleString()}) as an emergency fund`);

  return {
    life: {
      recommendedCover: round(recommended),
      components,
      existing: round(existing),
      gap: round(gap),
      termYears,
      estimatedPremiumMonthly: round(premium / 12, 2),
    },
    disability: {
      recommendedMonthlyBenefit: round((i.annualIncome / 12) * 0.6),
      why: "Policies typically replace ~60% of income; benefits above that are rarely offered.",
    },
    health: { priority: healthPriority, notes: healthNotes },
    emergencyFund: { months: efMonths, amount: round(monthlyExpenses * efMonths) },
    priorities,
  };
}
