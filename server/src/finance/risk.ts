import { clamp, riskProfileFromScore } from "./math.ts";

export interface RiskQuestion {
  id: string;
  text: string;
  options: { label: string; score: number }[];
}

/** Questionnaire shared by the onboarding UI and the AI risk-assessment tool. */
export const RISK_QUESTIONS: RiskQuestion[] = [
  {
    id: "horizon",
    text: "When do you expect to start withdrawing a meaningful part of this money?",
    options: [
      { label: "Within 2 years", score: 1 },
      { label: "In 3–5 years", score: 2 },
      { label: "In 6–10 years", score: 3 },
      { label: "In 11–20 years", score: 4 },
      { label: "More than 20 years", score: 5 },
    ],
  },
  {
    id: "drop",
    text: "Your portfolio falls 25% in three months. What do you do?",
    options: [
      { label: "Sell everything to stop the losses", score: 1 },
      { label: "Sell some to reduce exposure", score: 2 },
      { label: "Hold and wait it out", score: 3 },
      { label: "Buy a bit more at lower prices", score: 4 },
      { label: "Invest aggressively — it's a sale", score: 5 },
    ],
  },
  {
    id: "goal",
    text: "Which statement best describes your investing goal?",
    options: [
      { label: "Protect what I have", score: 1 },
      { label: "Steady income with low risk", score: 2 },
      { label: "Balanced growth and stability", score: 3 },
      { label: "Strong long-term growth", score: 4 },
      { label: "Maximum growth, I accept big swings", score: 5 },
    ],
  },
  {
    id: "experience",
    text: "How experienced are you with investing?",
    options: [
      { label: "None", score: 1 },
      { label: "A little (savings accounts, FDs)", score: 2 },
      { label: "Some (mutual funds)", score: 3 },
      { label: "Good (stocks and funds)", score: 4 },
      { label: "Extensive (multiple asset classes)", score: 5 },
    ],
  },
  {
    id: "stability",
    text: "How stable is your income and how large is your emergency fund?",
    options: [
      { label: "Unstable income, no emergency fund", score: 1 },
      { label: "Variable income, < 3 months saved", score: 2 },
      { label: "Steady income, 3–6 months saved", score: 3 },
      { label: "Very stable, 6–12 months saved", score: 4 },
      { label: "Very stable, 12+ months saved", score: 5 },
    ],
  },
  {
    id: "loss",
    text: "What is the largest one-year loss you could tolerate on your investments?",
    options: [
      { label: "0–3%", score: 1 },
      { label: "Up to 10%", score: 2 },
      { label: "Up to 20%", score: 3 },
      { label: "Up to 30%", score: 4 },
      { label: "More than 30%", score: 5 },
    ],
  },
];

export interface RiskResult {
  score: number; // 1..5 (one decimal)
  rounded: 1 | 2 | 3 | 4 | 5;
  profile: "conservative" | "moderate" | "aggressive";
  capacityNote: string;
  answered: number;
}

/**
 * Average the answered questions. Age and dependents act as a *capacity* cap:
 * older investors and those with several dependents are nudged down a notch.
 */
export function assessRisk(
  answers: Record<string, number>,
  opts: { age?: number | null; dependents?: number | null } = {},
): RiskResult {
  const scores = RISK_QUESTIONS.map((q) => answers[q.id]).filter(
    (v): v is number => typeof v === "number" && v >= 1 && v <= 5,
  );
  if (scores.length === 0) throw new Error("No valid answers supplied");
  let avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const notes: string[] = [];
  if (opts.age && opts.age >= 60) {
    avg -= 0.5;
    notes.push("age 60+ lowers capacity for drawdowns");
  } else if (opts.age && opts.age >= 50) {
    avg -= 0.25;
    notes.push("approaching retirement trims capacity slightly");
  }
  if ((opts.dependents ?? 0) >= 3) {
    avg -= 0.25;
    notes.push("several dependents reduce flexibility");
  }
  const score = Math.round(clamp(avg, 1, 5) * 10) / 10;
  const rounded = clamp(Math.round(score), 1, 5) as 1 | 2 | 3 | 4 | 5;
  return {
    score,
    rounded,
    profile: riskProfileFromScore(rounded),
    capacityNote: notes.length ? `Adjusted because ${notes.join("; ")}.` : "No capacity adjustments applied.",
    answered: scores.length,
  };
}
