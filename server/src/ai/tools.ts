import { z } from "zod";
import { get, run as runSql } from "../db.ts";
import { defineTool, type AgentTool, type ToolContext } from "./types.ts";
import { bullets, extractNumbers, pct, pct0, table, usd } from "./format.ts";
import { monthSummary, monthlyTrend, currentMonth } from "../lib/snapshot.ts";
import { analyzeBudget, optimizeExpenses, savingsPlan, type CategorySpend } from "../finance/budget.ts";
import { planGoal, planRetirement, projectWealth, strategyFor } from "../finance/planning.ts";
import { simulateRetirement } from "../finance/montecarlo.ts";
import { assessRisk, RISK_QUESTIONS } from "../finance/risk.ts";
import { planTax } from "../finance/tax.ts";
import { planInsurance } from "../finance/insurance.ts";
import { monthsUntil, round, sum } from "../finance/math.ts";
import { allStocks, getStock, movers, sectorPerformance, stockView } from "../market.ts";
import { analyzePortfolio } from "../portfolio.ts";
import { recommendFunds, recommendStocks, recProfileFor } from "../recommend.ts";
import { checkWill, WillSchema } from "../will.ts";


const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const riskField = z.number().int().min(1).max(5).optional().describe("Risk tolerance 1 (very cautious) to 5 (very aggressive). Defaults to the user's saved score.");
const pctField = (d: string) => z.number().min(0).max(30).optional().describe(d);

const profileRisk = (tc: ToolContext) => tc.ctx().riskScore;
const profileHorizon = (tc: ToolContext) => {
  const c = tc.ctx();
  return c.age ? Math.max(1, c.retirementAge - c.age) : 10;
};

// =========================================================================
// AGENT 1 — Personal Finance
// =========================================================================

const analyzeBudgetTool = defineTool({
  name: "analyze_budget",
  agent: "personal",
  title: "Budget Analysis",
  description:
    "Analyze the user's spending against their budget for a month: savings rate, 50/30/20 split, over-budget categories and wastage. Reads the user's real tracked data by default. Pass monthlyIncome and expenses only for a what-if the user typed in chat.",
  schema: z.object({
    month: MONTH.optional().describe("YYYY-MM, defaults to the current month"),
    monthlyIncome: z.number().min(0).optional().describe("Override income for a hypothetical analysis"),
    expenses: z
      .array(z.object({ name: z.string(), amount: z.number().min(0), bucket: z.enum(["need", "want"]).default("need") }))
      .max(40)
      .optional()
      .describe("Hypothetical expense lines; when given, stored transactions are ignored"),
  }),
  keywords: ["budget", "spending", "spend", "overspend", "where is my money", "wastage", "cash flow", "50/30/20", "analy"],
  run: (tc, i) => {
    if (i.expenses?.length) {
      const cats: CategorySpend[] = i.expenses.map((e) => ({ name: e.name, bucket: e.bucket, planned: 0, actual: e.amount }));
      return { source: "what-if", month: "n/a", ...analyzeBudget(i.monthlyIncome ?? tc.ctx().income, cats), categories: cats };
    }
    const ms = monthSummary(tc.userId, i.month);
    const a = i.monthlyIncome != null ? analyzeBudget(i.monthlyIncome, ms.expenseCategories) : ms.analysis;
    const top = ms.categories
      .filter((c) => c.kind === "expense" && c.bucket !== "savings")
      .sort((x, y) => y.actual - x.actual)
      .slice(0, 8)
      .map((c) => ({ name: c.name, bucket: c.bucket, planned: c.planned, actual: c.actual }));
    return { source: "tracked", month: ms.month, ...a, topCategories: top, trend: monthlyTrend(tc.userId, 4) };
  },
  render: (r) => {
    const rows = (r.topCategories ?? r.categories ?? []).map((c: any) => [c.name, c.bucket, usd(c.planned ?? 0), usd(c.actual)]);
    return [
      `### Budget analysis${r.month && r.month !== "n/a" ? ` — ${r.month}` : ""}`,
      `Income **${usd(r.income)}**, spending **${usd(r.spent)}**, left over **${usd(r.saved)}** — a savings rate of **${pct0(r.savingsRate)}**.`,
      table(["Bucket", "Amount", "Share of income", "Guideline"], [
        ["Needs", usd(r.buckets.need.amount), pct0(r.buckets.need.pct), "≤ 50%"],
        ["Wants", usd(r.buckets.want.amount), pct0(r.buckets.want.pct), "≤ 30%"],
        ["Savings", usd(r.buckets.savings.amount), pct0(r.buckets.savings.pct), "≥ 20%"],
      ]),
      rows.length ? table(["Category", "Type", "Planned", "Actual"], rows) : "",
      r.overBudget.length ? `**Over budget:** ${r.overBudget.map((o: any) => `${o.name} (+${usd(o.over)})`).join(", ")} — about **${usd(r.wastage)}** above plan.` : "Nothing is over its planned amount. 🎉",
      bullets(r.insights.map((i: any) => `**${i.title}.** ${i.detail}`)),
    ].filter(Boolean).join("\n\n");
  },
});

const recommendSavingsTool = defineTool({
  name: "recommend_savings",
  agent: "personal",
  title: "Savings Recommendation",
  description:
    "Recommend a savings strategy: emergency-fund target and gap, target savings rate, how much to automate monthly, and an ordered action plan. Defaults to the user's profile; override fields for what-ifs.",
  schema: z.object({
    monthlyIncome: z.number().min(0).optional(),
    monthlyExpenses: z.number().min(0).optional(),
    currentSavings: z.number().min(0).optional(),
    totalDebt: z.number().min(0).optional(),
  }),
  keywords: ["save", "saving", "savings", "emergency fund", "rainy day", "put aside", "how much should i save"],
  run: (tc, i) => {
    const c = tc.ctx();
    return savingsPlan({
      income: i.monthlyIncome ?? c.income, expenses: i.monthlyExpenses ?? c.expenses,
      savings: i.currentSavings ?? c.savings, debt: i.totalDebt ?? c.debt, age: c.age, dependents: c.dependents,
    });
  },
  render: (r) =>
    [
      "### Your savings plan",
      `- **Emergency fund target:** ${usd(r.emergencyFundTarget)} (${r.emergencyFundMonths} months of expenses). Saved so far: ${usd(r.currentSavings)} → gap **${usd(r.emergencyGap)}**.`,
      `- **Target savings rate:** ${pct0(r.targetSavingsRate)} of income, i.e. about **${usd(r.recommendedMonthly)}/month**. Current monthly surplus: ${usd(r.currentMonthlySurplus)}.`,
      "**Order of operations**",
      r.steps.map((s: any) => `${s.order}. **${s.title}** — ${s.detail}`).join("\n"),
    ].join("\n\n"),
});

const planGoalTool = defineTool({
  name: "plan_goal",
  agent: "personal",
  title: "Goal Planning",
  description:
    "Create a step-by-step plan for a financial goal (home, car, education, trip…): required monthly saving, whether the current pace is enough, milestone timeline and a suggested asset mix. Provide the deadline as targetDate (YYYY-MM-DD) or years.",
  schema: z.object({
    goalName: z.string().max(80).default("Your goal"),
    targetAmount: z.number().positive(),
    currentSavings: z.number().min(0).default(0),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    years: z.number().min(0.25).max(60).optional(),
    expectedReturnPct: pctField("Expected annual return in percent; omit to derive from the horizon"),
    monthlyContribution: z.number().min(0).optional().describe("What the user already saves per month toward this goal"),
  }),
  keywords: ["goal", "buy a", "down payment", "house", "home", "car", "wedding", "vacation", "trip", "college", "education", "plan for"],
  run: (tc, i) => {
    const months = i.targetDate ? monthsUntil(i.targetDate) : Math.round((i.years ?? 5) * 12);
    const strat = strategyFor(profileRisk(tc), months / 12);
    const rate = i.expectedReturnPct != null ? i.expectedReturnPct / 100 : Math.min(strat.expectedReturn, months < 36 ? 0.035 : 0.09);
    const plan = planGoal({ target: i.targetAmount, current: i.currentSavings, months, annualReturn: rate, monthlyContribution: i.monthlyContribution ?? 0 });
    const { series: _s, ...rest } = plan;
    return { goalName: i.goalName, targetAmount: i.targetAmount, assumedReturn: rate, strategy: strat, ...rest };
  },
  render: (r) =>
    [
      `### Plan: ${r.goalName} (${usd(r.targetAmount)})`,
      `Over **${r.months} months** at an assumed **${pct(r.assumedReturn * 100)}** return you need to save **${usd(r.requiredMonthly)}/month**.`,
      r.currentMonthly > 0 ? `At your current ${usd(r.currentMonthly)}/month you would reach ${usd(r.projectedAtDeadline)} — ${r.onTrack ? "**on track**" : `short by **${usd(r.shortfall)}**`}.` : "",
      "**Milestones**",
      r.milestones.map((m: any) => `- ${m.pct}% (${usd(m.amount)})${m.approxMonth != null ? ` — around month ${m.approxMonth}` : ""}`).join("\n"),
      `**Suggested mix:** ${r.strategy.summary}`,
    ].filter(Boolean).join("\n\n"),
  demoArgs: (m) => {
    const n = extractNumbers(m);
    return { goalName: /house|home|down payment/i.test(m) ? "Home down payment" : /car/i.test(m) ? "Car" : /college|education/i.test(m) ? "Education" : "Your goal", targetAmount: n.firstAmount ?? 50000, years: n.years ?? 5, currentSavings: n.secondAmount ?? 0 };
  },
});

const assessRiskTool = defineTool({
  name: "assess_risk",
  agent: "personal",
  title: "Risk Assessment",
  description:
    "Evaluate the user's investment risk tolerance. If the user has answered the questionnaire (1–5 per question), pass answers to score and save the result. With no answers, returns the saved risk profile and the questions to ask. Ask the user conversationally, then call this with their answers.",
  schema: z.object({
    answers: z
      .record(z.string(), z.number().int().min(1).max(5))
      .optional()
      .describe(`Map of question id → option score 1-5. Ids: ${RISK_QUESTIONS.map((q) => q.id).join(", ")}`),
  }),
  keywords: ["risk", "tolerance", "conservative", "aggressive", "how risky", "comfortable with", "volatil"],
  run: (tc, i) => {
    const c = tc.ctx();
    if (i.answers && Object.keys(i.answers).length) {
      const r = assessRisk(i.answers, { age: c.age, dependents: c.dependents });
      if (r.answered >= 3) {
        runSql("UPDATE profiles SET risk_score=?, risk_profile=?, updated_at=datetime('now') WHERE user_id=?", r.rounded, r.profile, tc.userId);
      }
      return { saved: r.answered >= 3, ...r, allocation: strategyFor(r.rounded, profileHorizon(tc)) };
    }
    return {
      saved: false,
      current: c.profile?.risk_score ? { score: c.profile.risk_score, profile: c.profile.risk_profile } : null,
      questions: RISK_QUESTIONS.map((q) => ({ id: q.id, text: q.text, options: q.options })),
    };
  },
  render: (r) =>
    r.questions
      ? [
          r.current ? `Your saved risk profile is **${r.current.profile}** (${r.current.score}/5).` : "You haven't completed a risk assessment yet.",
          "To (re)assess, answer these — you can complete the full questionnaire under **Profile → Risk profile**:",
          r.questions.map((q: any, i: number) => `${i + 1}. ${q.text}\n${q.options.map((o: any) => `   - ${o.label}`).join("\n")}`).join("\n"),
        ].join("\n\n")
      : [
          `### Risk assessment`,
          `Score **${r.score}/5** → **${r.profile}** investor. ${r.capacityNote}`,
          `Suggested mix for your horizon: ${r.allocation.summary}`,
          r.saved ? "Saved to your profile — recommendations now use it." : "",
        ].filter(Boolean).join("\n\n"),
});

const optimizeExpensesTool = defineTool({
  name: "optimize_expenses",
  agent: "personal",
  title: "Expense Optimization",
  description:
    "Find ways to reduce expenses with minimal lifestyle impact, ranked by monthly saving, with concrete tips per category. Uses the user's tracked spending (latest month with data).",
  schema: z.object({ month: MONTH.optional() }),
  keywords: ["cut", "reduce", "lower my", "trim", "cheaper", "optimi", "save money on", "bills", "expenses", "subscriptions"],
  run: (tc, i) => {
    let ms = monthSummary(tc.userId, i.month ?? currentMonth());
    if (!i.month) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      const prev = monthSummary(tc.userId, d.toISOString().slice(0, 7));
      if (ms.analysis.spent < prev.analysis.spent * 0.6) ms = prev;
    }
    return { month: ms.month, ...optimizeExpenses(ms.expenseCategories) };
  },
  render: (r) =>
    r.items.length
      ? [
          `### Where you can trim (${r.month})`,
          `Realistic savings: **${usd(r.totalMonthly)}/month** (${usd(r.totalAnnual)}/year).`,
          table(["Category", "Spending", "Possible saving", "Cut"], r.items.slice(0, 7).map((i: any) => [i.category, usd(i.current), usd(i.potentialSaving), pct0(i.pct)])),
          ...r.items.slice(0, 3).map((i: any) => `**${i.category}:**\n${bullets(i.tips)}`),
        ].join("\n\n")
      : "I don't see any spending data yet. Add some transactions on the Budget page and I can find savings for you.",
});

// =========================================================================
// AGENT 2 — Investment Advisory
// =========================================================================

const stockLite = (r: ReturnType<typeof recommendStocks>[number]) => ({
  symbol: r.item.symbol, name: r.item.name, sector: r.item.sector, price: r.item.price, dayChangePct: r.item.changePct,
  return1y: r.item.return1y, pe: r.item.pe, dividendYield: r.item.dividend_yield, beta: r.item.beta, epsGrowth: r.item.eps_growth,
  match: r.match, reasons: r.reasons,
});

const recommendStocksTool = defineTool({
  name: "recommend_stocks",
  agent: "investment",
  title: "Stock Recommendation",
  description:
    "Recommend stocks from the platform's (simulated) universe, scored against the user's risk tolerance, horizon and goals, with reasons. Optionally filter by sector. Prices are simulated demo data.",
  schema: z.object({ riskScore: riskField, horizonYears: z.number().min(0.5).max(60).optional(), sector: z.string().optional(), limit: z.number().int().min(1).max(10).default(5) }),
  keywords: ["stock", "stocks", "equity", "share", "which companies", "what should i buy", "tech stock", "dividend stock"],
  run: (tc, i) => {
    const p = recProfileFor(tc.userId);
    const recs = recommendStocks({ ...p, riskScore: i.riskScore ?? p.riskScore, horizonYears: i.horizonYears ?? p.horizonYears }, 40)
      .filter((r) => !i.sector || r.item.sector.toLowerCase() === i.sector.toLowerCase())
      .slice(0, i.limit);
    return { basedOn: { riskScore: i.riskScore ?? p.riskScore, horizonYears: i.horizonYears ?? p.horizonYears }, recommendations: recs.map(stockLite), note: "Simulated market data for fictional companies." };
  },
  render: (r) =>
    [
      `### Stock ideas for a ${r.basedOn.riskScore}/5 risk profile (${r.basedOn.horizonYears}-yr horizon)`,
      r.recommendations.length
        ? table(["Symbol", "Company", "Sector", "Price", "1Y", "P/E", "Div", "Match"], r.recommendations.map((s: any) => [s.symbol, s.name, s.sector, usd(s.price, 2), pct(s.return1y, 0), s.pe.toFixed(1), pct(s.dividendYield), `${s.match}%`]))
        : "No stocks cleared the minimum match score for those filters.",
      ...r.recommendations.slice(0, 3).map((s: any) => `**${s.symbol}** — ${s.reasons.join("; ")}.`),
      `_${r.note} Diversify: don't hold more than ~5–10% of your portfolio in a single stock._`,
    ].join("\n\n"),
  demoArgs: (m) => ({ sector: allStocksSectors().find((s) => m.toLowerCase().includes(s.toLowerCase().split(" ")[0])) }),
});
const allStocksSectors = () => [...new Set(allStocks().map((s) => s.sector))];

const matchFundsTool = defineTool({
  name: "match_mutual_funds",
  agent: "investment",
  title: "Mutual Fund Matching",
  description:
    "Find mutual funds that fit the user's goal, risk tolerance and horizon, ranked by match score with reasons (cost, returns, risk fit). Optionally filter by category (e.g. 'Index', 'Intermediate Bond') or maximum expense ratio.",
  schema: z.object({
    goal: z.string().max(120).optional().describe("e.g. 'retirement income', 'long-term growth'"),
    riskScore: riskField,
    horizonYears: z.number().min(0.5).max(60).optional(),
    category: z.string().optional(),
    maxExpenseRatioPct: z.number().min(0).max(3).optional(),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  keywords: ["fund", "funds", "mutual fund", "index fund", "etf", "sip", "bond fund", "target date"],
  run: (tc, i) => {
    const p = recProfileFor(tc.userId);
    const goals = i.goal ? [i.goal, ...p.goals] : p.goals;
    const recs = recommendFunds({ riskScore: i.riskScore ?? p.riskScore, horizonYears: i.horizonYears ?? p.horizonYears, goals }, 40)
      .filter((r) => !i.category || r.item.category.toLowerCase().includes(i.category.toLowerCase()))
      .filter((r) => i.maxExpenseRatioPct == null || r.item.expense_ratio <= i.maxExpenseRatioPct)
      .slice(0, i.limit);
    return {
      basedOn: { riskScore: i.riskScore ?? p.riskScore, horizonYears: i.horizonYears ?? p.horizonYears, goals },
      recommendations: recs.map((r) => ({
        symbol: r.item.symbol, name: r.item.name, category: r.item.category, risk: r.item.risk, expenseRatioPct: r.item.expense_ratio,
        return1y: r.item.return_1y, return3y: r.item.return_3y, return5y: r.item.return_5y, sharpe: r.item.sharpe, minInvestment: r.item.min_investment,
        match: r.match, reasons: r.reasons,
      })),
      note: "Simulated fund data for demonstration. Past performance does not predict future results.",
    };
  },
  render: (r) =>
    [
      `### Funds matched to a ${r.basedOn.riskScore}/5 risk profile`,
      r.recommendations.length
        ? table(["Fund", "Category", "Risk", "Cost", "3Y/yr", "Match"], r.recommendations.map((f: any) => [`${f.name} (${f.symbol})`, f.category, `${f.risk}/5`, pct(f.expenseRatioPct, 2), pct(f.return3y), `${f.match}%`]))
        : "No funds matched those filters.",
      ...r.recommendations.slice(0, 3).map((f: any) => `**${f.symbol}** — ${f.reasons.join("; ")}.`),
      `_${r.note}_`,
    ].join("\n\n"),
});

const analyzePortfolioTool = defineTool({
  name: "analyze_portfolio",
  agent: "investment",
  title: "Portfolio Analysis",
  description:
    "Review the user's current holdings (funds and stocks): value, gain, allocation by category, concentration, average risk vs their tolerance, fees, and concrete improvement suggestions.",
  schema: z.object({}),
  keywords: ["portfolio", "my holdings", "my investments", "diversif", "rebalance", "allocation", "how am i doing"],
  run: (tc) => {
    const a = analyzePortfolio(tc.userId, profileRisk(tc));
    if (a.empty) return { empty: true };
    const { holdings, categories, findings, ...rest } = a;
    return {
      ...rest,
      holdings: holdings.map((h) => ({ symbol: h.symbol, name: h.name, kind: h.kind, category: h.category, value: h.value, weightPct: h.weight, gainPct: h.gainPct, risk: h.risk })),
      categories, findings, riskTolerance: profileRisk(tc),
    };
  },
  render: (r) =>
    r.empty
      ? "You don't hold any investments in Finvara yet. Add some from the Funds or Stocks page and I'll review diversification, risk and fees."
      : [
          `### Portfolio review`,
          `Value **${usd(r.totalValue)}** (${r.totalGain >= 0 ? "+" : ""}${usd(r.totalGain)}, ${pct(r.totalGainPct)}). Average risk **${r.weightedRisk}/5** vs your tolerance **${r.riskTolerance}/5**; fund fees average ${pct(r.weightedExpenseRatio, 2)}.`,
          table(["Holding", "Category", "Weight", "Gain"], r.holdings.map((h: any) => [`${h.name} (${h.symbol})`, h.category, pct(h.weightPct), pct(h.gainPct)])),
          bullets(r.findings.map((f: any) => f.text)),
        ].join("\n\n"),
});

const marketInsightTool = defineTool({
  name: "market_insight",
  agent: "investment",
  title: "Market Insight",
  description:
    "Explain what is happening in the (simulated) market: top gainers and losers today, sector leadership, and optionally a deep-dive on one symbol (momentum, valuation, 52-week range). Data on this platform is simulated.",
  schema: z.object({ symbol: z.string().max(8).optional().describe("A stock ticker for a deep-dive, e.g. QNTR") }),
  keywords: ["market", "today", "trend", "gainers", "losers", "what's happening", "outlook", "news", "explain"],
  run: (_tc, i) => {
    const mv = movers(3);
    const lite = (s: ReturnType<typeof stockView>) => ({ symbol: s.symbol, name: s.name, sector: s.sector, price: s.price, changePct: s.changePct });
    const sectors = sectorPerformance();
    const out: any = {
      gainers: mv.gainers.map(lite), losers: mv.losers.map(lite),
      sectors: sectors.map((s) => ({ sector: s.sector, dayChangePct: s.dayChangePct, return3m: s.return3m, return1y: s.return1y, avgPe: s.avgPe })),
      note: "Simulated demo data — not real market prices.",
    };
    if (i.symbol) {
      const s = getStock(i.symbol);
      if (s) {
        const rangePos = (s.price - s.week52_low) / Math.max(0.01, s.week52_high - s.week52_low);
        out.focus = { symbol: s.symbol, name: s.name, sector: s.sector, price: s.price, changePct: s.changePct, return1m: s.return1m, return3m: s.return3m, return1y: s.return1y, pe: s.pe, dividendYield: s.dividend_yield, beta: s.beta, epsGrowth: s.eps_growth, week52Position: round(rangePos, 2) };
      } else out.focusError = `Unknown symbol ${i.symbol}`;
    }
    return out;
  },
  render: (r) =>
    [
      "### Market snapshot (simulated)",
      `**Leaders today:** ${r.gainers.map((s: any) => `${s.symbol} ${pct(s.changePct, 2)}`).join(", ")}\n\n**Laggards:** ${r.losers.map((s: any) => `${s.symbol} ${pct(s.changePct, 2)}`).join(", ")}`,
      table(["Sector", "Today", "3M", "1Y"], r.sectors.slice(0, 6).map((s: any) => [s.sector, pct(s.dayChangePct, 2), pct(s.return3m), pct(s.return1y)])),
      r.focus ? `**${r.focus.symbol} (${r.focus.name}):** ${usd(r.focus.price, 2)}, ${pct(r.focus.return3m)} over 3 months, ${pct(r.focus.return1y)} over a year; P/E ${r.focus.pe.toFixed(1)}, β ${r.focus.beta}; trading at ${Math.round(r.focus.week52Position * 100)}% of its 52-week range.` : "",
      `_${r.note}_`,
    ].filter(Boolean).join("\n\n"),
  demoArgs: (m) => {
    const hit = allStocks().find((s) => new RegExp(`\\b${s.symbol}\\b`, "i").test(m) || m.toLowerCase().includes(s.name.toLowerCase()));
    return hit ? { symbol: hit.symbol } : {};
  },
});

const DEFENSIVE: Record<string, number> = { Utilities: 5, "Consumer Staples": 5, Healthcare: 4, "Real Estate": 3, Communication: 3, Financials: 3, Industrials: 2, Materials: 2, Energy: 2, "Consumer Discretionary": 1, Technology: 1 };

const analyzeSectorsTool = defineTool({
  name: "analyze_sectors",
  agent: "investment",
  title: "Sector Analysis",
  description:
    "Rank market sectors by momentum, valuation and defensiveness, then suggest overweight / underweight sectors for the user's risk tolerance. Based on the platform's simulated universe.",
  schema: z.object({ riskScore: riskField }),
  keywords: ["sector", "sectors", "industry", "rotation", "overweight", "defensive", "cyclical", "economy"],
  run: (tc, i) => {
    const risk = i.riskScore ?? profileRisk(tc);
    const secs = sectorPerformance();
    const rank = (xs: number[], v: number, invert = false) => {
      const sorted = [...xs].sort((a, b) => a - b);
      const r = sorted.indexOf(v) / Math.max(1, xs.length - 1);
      return invert ? 1 - r : r;
    };
    const mom = secs.map((s) => s.return3m);
    const pe = secs.map((s) => s.avgPe);
    const scored = secs.map((s) => {
      const def = (DEFENSIVE[s.sector] ?? 3) / 5;
      const fitDefensive = risk <= 2 ? def : risk >= 4 ? 1 - def : 0.5;
      const score = 0.45 * rank(mom, s.return3m) + 0.25 * rank(pe, s.avgPe, true) + 0.3 * fitDefensive;
      return { ...s, defensiveness: DEFENSIVE[s.sector] ?? 3, score: round(score * 100, 0) };
    }).sort((a, b) => b.score - a.score);
    return { riskScore: risk, ranked: scored, overweight: scored.slice(0, 3).map((s) => s.sector), underweight: scored.slice(-2).map((s) => s.sector), note: "Simulated data; sector tilts should stay modest (±5% vs benchmark)." };
  },
  render: (r) =>
    [
      `### Sector view for a ${r.riskScore}/5 investor`,
      table(["Sector", "3M", "Avg P/E", "Defensive (1-5)", "Score"], r.ranked.map((s: any) => [s.sector, pct(s.return3m), s.avgPe.toFixed(1), s.defensiveness, s.score])),
      `**Lean toward:** ${r.overweight.join(", ")}. **Lean away from:** ${r.underweight.join(", ")}.`,
      `_${r.note}_`,
    ].join("\n\n"),
});

// =========================================================================
// AGENT 3 — Wealth & Retirement
// =========================================================================

const savedMonthly = (tc: ToolContext) => {
  const trend = monthlyTrend(tc.userId, 3).filter((t) => t.income > 0);
  const surplus = trend.length ? sum(trend.map((t) => t.saved)) / trend.length : Math.max(0, tc.ctx().income - tc.ctx().expenses);
  return round(surplus);
};

const retirementTool = defineTool({
  name: "plan_retirement",
  agent: "wealth",
  title: "Retirement Planning",
  description:
    "Calculate the retirement corpus needed (inflation-adjusted), the projected corpus from current savings and contributions, the gap, and the extra monthly saving required. Defaults come from the user's profile; override any assumption (percent values as numbers, e.g. 7 for 7%).",
  schema: z.object({
    age: z.number().min(16).max(90).optional(),
    retirementAge: z.number().min(40).max(90).optional(),
    lifeExpectancy: z.number().min(60).max(110).default(90),
    currentSavings: z.number().min(0).optional().describe("Retirement savings so far (defaults to savings + portfolio)"),
    monthlyContribution: z.number().min(0).optional(),
    desiredMonthlyIncomeToday: z.number().min(0).optional().describe("Monthly spending wanted in retirement, in today's dollars (defaults to 70% of income)"),
    otherIncomeToday: z.number().min(0).default(0).describe("Pension / Social Security per month in today's dollars"),
    inflationPct: pctField("default 3"),
    preRetirementReturnPct: pctField("default 7"),
    postRetirementReturnPct: pctField("default 5"),
  }),
  keywords: ["retire", "retirement", "pension", "401k", "nest egg", "corpus", "financial independence", "fire"],
  run: (tc, i) => {
    const c = tc.ctx();
    const age = i.age ?? c.age;
    if (!age) return { error: "Age is unknown. Ask the user for their age (or ask them to fill in their profile) and call again with `age`." };
    const port = analyzePortfolio(tc.userId, c.riskScore);
    const p = planRetirement({
      age, retirementAge: i.retirementAge ?? c.retirementAge, lifeExpectancy: i.lifeExpectancy,
      currentSavings: i.currentSavings ?? c.savings + (port.totalValue ?? 0),
      monthlyContribution: i.monthlyContribution ?? savedMonthly(tc),
      desiredMonthlyIncomeToday: i.desiredMonthlyIncomeToday ?? Math.round(c.income * 0.7),
      otherIncomeToday: i.otherIncomeToday,
      inflation: i.inflationPct != null ? i.inflationPct / 100 : undefined,
      preReturn: i.preRetirementReturnPct != null ? i.preRetirementReturnPct / 100 : undefined,
      postReturn: i.postRetirementReturnPct != null ? i.postRetirementReturnPct / 100 : undefined,
    });
    const { series: _s, ...rest } = p;
    const retAge = i.retirementAge ?? c.retirementAge;
    const mc = simulateRetirement({
      age, retirementAge: retAge, lifeExpectancy: i.lifeExpectancy, currentSavings: i.currentSavings ?? c.savings + (port.totalValue ?? 0),
      monthlyContribution: i.monthlyContribution ?? savedMonthly(tc), annualNeedToday: Math.max(0, (i.desiredMonthlyIncomeToday ?? Math.round(c.income * 0.7)) - i.otherIncomeToday) * 12,
      inflation: p.assumptions.inflation, preReturn: p.assumptions.preReturn, postReturn: p.assumptions.postReturn, runs: 500,
    });
    return { successProbability: mc.successProbability, atRetirementRange: mc.atRetirement, age, retirementAge: retAge, currentSavingsUsed: i.currentSavings ?? c.savings + (port.totalValue ?? 0), monthlyContributionUsed: i.monthlyContribution ?? savedMonthly(tc), ...rest };
  },
  render: (r) =>
    r.error
      ? r.error
      : [
          `### Retirement outlook (retire at ${r.retirementAge}, in ${r.yearsToRetirement} years)`,
          table(["", ""], [
            ["Monthly need at retirement (inflation-adjusted)", usd(r.inflatedMonthlyNeed)],
            ["Corpus needed", `**${usd(r.corpusNeeded)}**`],
            ["Projected corpus at current pace", usd(r.projectedCorpus)],
            ["Funded", pct(r.fundedPct, 0)],
          ]),
          `In 500 simulated market paths your money lasts to age ${r.assumptions.lifeExpectancy} in **${Math.round(r.successProbability * 100)}%** of them (a range of ${usd(r.atRetirementRange.p10)}–${usd(r.atRetirementRange.p90)} at retirement).`,
          r.onTrack ? "You are **on track** under these assumptions." : `You are **${usd(r.gap)}** short. Saving an extra **${usd(r.extraMonthlyNeeded)}/month** closes the gap; alternatively your current plan sustains about **${usd(r.sustainableMonthlyIncomeToday)}/month** in today's dollars.`,
          `_Assumptions: ${pct(r.assumptions.inflation * 100)} inflation, ${pct(r.assumptions.preReturn * 100)} return before and ${pct(r.assumptions.postReturn * 100)} after retirement, plan to age ${r.assumptions.lifeExpectancy}. Based on $${r.monthlyContributionUsed.toLocaleString()}/month saved and ${usd(r.currentSavingsUsed)} saved so far._`,
        ].join("\n\n"),
  demoArgs: (m) => {
    const n = extractNumbers(m);
    return { age: n.age, retirementAge: n.retirementAge, desiredMonthlyIncomeToday: n.firstAmount };
  },
});

const taxTool = defineTool({
  name: "optimize_taxes",
  agent: "wealth",
  title: "Tax Optimization",
  description:
    "Suggest tax-efficient investing strategies (workplace pre-tax plan, IRA, HSA, 529) with room remaining, suggested contributions and estimated tax saved. Uses illustrative US federal single-filer figures — always include the disclaimer.",
  schema: z.object({
    annualIncome: z.number().min(0).optional().describe("Gross annual income (defaults to 12 × monthly income)"),
    current401k: z.number().min(0).optional(),
    currentIra: z.number().min(0).optional(),
    currentHsa: z.number().min(0).optional(),
    hasHighDeductibleHealthPlan: z.boolean().optional(),
    hasChildren: z.boolean().optional(),
    taxableInvestmentGains: z.number().min(0).optional(),
  }),
  keywords: ["tax", "taxes", "deduction", "ira", "roth", "hsa", "529", "capital gains", "tax-efficient"],
  run: (tc, i) => planTax({ ...i, annualIncome: i.annualIncome ?? tc.ctx().income * 12, hasChildren: i.hasChildren ?? tc.ctx().dependents > 0 }),
  render: (r) =>
    [
      "### Tax-smart moves",
      `Estimated taxable income **${usd(r.taxableIncome)}**: federal tax about **${usd(r.baseline.tax)}** (marginal ${pct0(r.baseline.marginalRate)}, effective ${pct(r.baseline.effectiveRate * 100)}).`,
      table(["Strategy", "Room", "Suggested", "Est. tax saved"], r.strategies.map((s: any) => [s.name, usd(s.room), usd(s.suggestedContribution), usd(s.estimatedTaxSaved)])),
      bullets(r.strategies.map((s: any) => `**${s.name}:** ${s.why}`)),
      bullets(r.notes),
      `_${r.disclaimer}_`,
    ].join("\n\n"),
});

const wealthTool = defineTool({
  name: "project_wealth",
  agent: "wealth",
  title: "Wealth Projection",
  description:
    "Project wealth growth over N years with conservative / base / optimistic scenarios (±2.5 points of return), nominal and inflation-adjusted. Defaults to current net investable wealth and typical monthly saving.",
  schema: z.object({
    years: z.number().int().min(1).max(60).default(20),
    currentWealth: z.number().min(0).optional(),
    monthlyContribution: z.number().min(0).optional(),
    annualReturnPct: pctField("Base-case annual return, default 7"),
    inflationPct: pctField("default 3"),
    annualContributionIncreasePct: pctField("Yearly step-up of contributions, default 0"),
  }),
  keywords: ["project", "projection", "grow", "future value", "how much will i have", "wealth", "compound", "in 20 years", "millionaire"],
  run: (tc, i) => {
    const c = tc.ctx();
    const port = analyzePortfolio(tc.userId, c.riskScore);
    const w = projectWealth({
      currentWealth: i.currentWealth ?? c.savings + (port.totalValue ?? 0),
      monthlyContribution: i.monthlyContribution ?? savedMonthly(tc),
      years: i.years,
      annualReturn: i.annualReturnPct != null ? i.annualReturnPct / 100 : undefined,
      inflation: i.inflationPct != null ? i.inflationPct / 100 : undefined,
      annualContributionIncrease: i.annualContributionIncreasePct != null ? i.annualContributionIncreasePct / 100 : undefined,
    });
    return {
      startingWealth: i.currentWealth ?? c.savings + (port.totalValue ?? 0),
      monthlyContribution: i.monthlyContribution ?? savedMonthly(tc),
      years: w.years, scenarios: w.scenarios, totalContributed: w.totalContributed, growthSharePct: round(w.growthShare * 100, 0),
      milestones: w.yearly.filter((y) => y.year > 0 && y.year % 5 === 0).map((y) => ({ year: y.year, conservative: y.conservative, base: y.base, optimistic: y.optimistic })),
    };
  },
  render: (r) =>
    [
      `### Wealth projection — ${r.years} years`,
      `Starting from **${usd(r.startingWealth)}** and adding **${usd(r.monthlyContribution)}/month**:`,
      table(["Scenario", "Return", "Nominal", "In today's dollars"], (["conservative", "base", "optimistic"] as const).map((k) => [k, pct(r.scenarios[k].rate * 100), usd(r.scenarios[k].finalNominal), usd(r.scenarios[k].finalReal)])),
      `You would contribute about ${usd(r.totalContributed)}; roughly **${r.growthSharePct}%** of the base-case outcome comes from investment growth.`,
      r.milestones.length ? table(["Year", "Conservative", "Base", "Optimistic"], r.milestones.map((m: any) => [m.year, usd(m.conservative), usd(m.base), usd(m.optimistic)])) : "",
      "_Projections are illustrative, not guaranteed._",
    ].filter(Boolean).join("\n\n"),
  demoArgs: (m) => {
    const n = extractNumbers(m);
    return n.years ? { years: Math.round(n.years) } : {};
  },
});

const insuranceTool = defineTool({
  name: "assess_insurance",
  agent: "wealth",
  title: "Insurance Needs",
  description:
    "Assess life, disability and health insurance needs: recommended life cover (income replacement + debt + education + final expenses − savings), the gap vs existing cover, indicative term premium, and an ordered priority list.",
  schema: z.object({
    annualIncome: z.number().min(0).optional(),
    age: z.number().min(16).max(90).optional(),
    dependents: z.number().int().min(0).max(20).optional(),
    totalDebt: z.number().min(0).optional(),
    liquidSavings: z.number().min(0).optional(),
    existingLifeCover: z.number().min(0).optional(),
    hasHealthInsurance: z.boolean().default(true),
  }),
  keywords: ["insurance", "life cover", "term life", "coverage", "disability", "health insurance", "protect my family", "insured"],
  run: (tc, i) => {
    const c = tc.ctx();
    return planInsurance({
      annualIncome: i.annualIncome ?? c.income * 12, age: i.age ?? c.age ?? 35, dependents: i.dependents ?? c.dependents,
      debt: i.totalDebt ?? c.debt, liquidSavings: i.liquidSavings ?? c.savings, existingLifeCover: i.existingLifeCover,
      existingHealthCover: i.hasHealthInsurance, monthlyExpenses: c.expenses,
    });
  },
  render: (r) =>
    [
      "### Insurance needs",
      `**Life cover:** recommended **${usd(r.life.recommendedCover)}**; existing ${usd(r.life.existing)} → gap **${usd(r.life.gap)}**. A ${r.life.termYears}-year term policy would cost roughly **${usd(r.life.estimatedPremiumMonthly)}/month** (indicative).`,
      table(["Component", "Amount"], r.life.components.map((c: any) => [c.label, usd(c.amount)])),
      `**Disability:** aim for ~${usd(r.disability.recommendedMonthlyBenefit)}/month benefit. ${r.disability.why}`,
      `**Health (${r.health.priority}):**\n${bullets(r.health.notes)}`,
      `**Emergency fund:** ${r.emergencyFund.months} months = ${usd(r.emergencyFund.amount)}.`,
      "**Priorities**\n" + r.priorities.map((p: string, i: number) => `${i + 1}. ${p}`).join("\n"),
    ].join("\n\n"),
});

const estateTool = defineTool({
  name: "estate_planning",
  agent: "wealth",
  title: "Estate Planning",
  description:
    "Guide estate planning: reports whether the user has started or generated a will in Finvara, lists completeness checks (executor, beneficiaries, guardian), and gives the standard checklist (beneficiary designations, power of attorney, healthcare directive, digital assets). Points to the Will Writing page.",
  schema: z.object({ question: z.string().max(300).optional().describe("The user's specific estate-planning question, for context") }),
  keywords: ["will", "estate", "beneficiar", "inherit", "inheritance", "power of attorney", "trust", "guardian", "after i die", "wealth transfer", "executor"],
  run: (tc) => {
    const row = get<{ data: string; status: string }>("SELECT data, status FROM wills WHERE user_id = ? ORDER BY id DESC LIMIT 1", tc.userId);
    const c = tc.ctx();
    const checklist = [
      "Write (and periodically review) a will — name an executor and an alternate.",
      "Align beneficiary designations on retirement accounts and life insurance with your will; they override it.",
      "Appoint a durable power of attorney for finances and a healthcare proxy / advance directive.",
      c.dependents > 0 ? "Name a guardian for minor children and consider a trust to manage their inheritance." : "Review whether a trust is needed if you have large or complex assets.",
      "Document digital assets and where to find passwords (use a password manager's emergency access).",
      "Keep an inventory of accounts, property, debts and advisers where your executor can find it.",
    ];
    if (!row) return { status: "none", checklist, page: "/will" };
    const draft = JSON.parse(row.data);
    const parsed = WillSchema.safeParse(draft);
    return {
      status: row.status,
      completeness: parsed.success ? checkWill(parsed.data) : parsed.error.issues.slice(0, 6).map((i) => ({ level: "warning", message: `${i.path.join(".") || "will"}: ${i.message}` })),
      beneficiaries: (draft.beneficiaries ?? []).length, assets: (draft.assets ?? []).length, hasGuardian: !!draft.guardian?.name, checklist, page: "/will",
    };
  },
  render: (r) =>
    [
      "### Estate planning",
      r.status === "none" ? "You haven't started a will yet — the **Will Writing** page guides you through assets, beneficiaries and generates a document to sign and notarise." : r.status === "generated" ? `Your will has been generated (${r.beneficiaries} beneficiaries, ${r.assets} assets). Review it yearly and after major life events.` : `You have a draft will (${r.beneficiaries} beneficiaries, ${r.assets} assets) that isn't generated yet.`,
      r.completeness?.length ? bullets(r.completeness.map((c: any) => `${c.level === "error" ? "⚠️ " : ""}${c.message}`)) : "",
      "**Checklist**\n" + bullets(r.checklist),
      "_Finvara provides templates and education, not legal advice — have a lawyer review your documents._",
    ].filter(Boolean).join("\n\n"),
});

export const TOOLS: AgentTool[] = [
  analyzeBudgetTool, recommendSavingsTool, planGoalTool, assessRiskTool, optimizeExpensesTool,
  recommendStocksTool, matchFundsTool, analyzePortfolioTool, marketInsightTool, analyzeSectorsTool,
  retirementTool, taxTool, wealthTool, insuranceTool, estateTool,
];

export const toolsFor = (agent: string) => TOOLS.filter((t) => t.agent === agent);
export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/** zod → JSON Schema for the Anthropic `input_schema`. */
export function inputSchemaOf(t: AgentTool) {
  const js = z.toJSONSchema(t.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  js.additionalProperties = false;
  return js;
}

