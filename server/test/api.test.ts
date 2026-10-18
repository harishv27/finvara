import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Server } from "node:http";

// Point the app at a throwaway database BEFORE importing anything that opens it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "finvara-test-"));
process.env.DATABASE_PATH = path.join(tmp, "test.db");
process.env.ANTHROPIC_API_KEY = ""; // force offline demo mode
process.env.NODE_ENV = "test";

const { createApp } = await import("../src/index.ts");
const { seedAll } = await import("../src/seed.ts");
const { initLive } = await import("../src/market.ts");

let server: Server;
let base = "";

before(async () => {
  seedAll(true);
  initLive();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function api(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, res };
}
const login = async (email: string, password: string) => (await api("POST", "/auth/login", { email, password })).json.token as string;

// ---------------------------------------------------------------- auth
test("auth: signup validates, rejects duplicates, and logs in", async () => {
  assert.equal((await api("POST", "/auth/signup", { name: "A", email: "bad", password: "x" })).status, 400);
  const ok = await api("POST", "/auth/signup", { name: "Test User", email: "Test@Example.com", password: "password123" });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.user.email, "test@example.com");
  assert.equal((await api("POST", "/auth/signup", { name: "Test User", email: "test@example.com", password: "password123" })).status, 409);
  assert.equal((await api("POST", "/auth/login", { email: "test@example.com", password: "wrong-password" })).status, 401);
  assert.equal((await api("POST", "/auth/login", { email: "test@example.com", password: "password123" })).status, 200);
});

test("auth: protected routes need a valid token", async () => {
  assert.equal((await api("GET", "/dashboard")).status, 401);
  assert.equal((await api("GET", "/dashboard", undefined, "garbage")).status, 401);
});

test("auth: non-admins cannot reach admin APIs", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  assert.equal((await api("GET", "/admin/overview", undefined, t)).status, 403);
  const a = await login("admin@finvara.app", "Admin123!");
  assert.equal((await api("GET", "/admin/overview", undefined, a)).status, 200);
});

// ------------------------------------------------------------ profile
test("profile: onboarding saves profile, sizes budget and risk questionnaire scores", async () => {
  const s = await api("POST", "/auth/signup", { name: "New Person", email: "new@example.com", password: "password123" });
  const t = s.json.token;
  assert.equal((await api("GET", "/auth/me", undefined, t)).json.onboarded, false);
  assert.equal((await api("POST", "/profile/onboarding", { age: 29, monthlyIncome: 4000 }, t)).status, 200);
  assert.equal((await api("GET", "/auth/me", undefined, t)).json.onboarded, true);
  const sum = await api("GET", "/budget/summary", undefined, t);
  assert.ok(sum.json.categories.some((c: any) => c.name === "Rent / Mortgage" && c.planned > 0));
  const risk = await api("POST", "/profile/risk", { answers: { horizon: 5, drop: 4, goal: 4, experience: 3, stability: 4, loss: 4 } }, t);
  assert.equal(risk.json.result.profile, "aggressive");
  assert.equal((await api("POST", "/profile/risk", { answers: { horizon: 9 } }, t)).status, 400);
});

// ------------------------------------------------------------ budget
test("budget: transactions drive the monthly summary; users cannot touch each other's data", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const before = (await api("GET", "/budget/summary", undefined, t)).json;
  const dining = before.categories.find((c: any) => c.name === "Dining out");
  const month = before.month;
  const created = await api("POST", "/budget/transactions", { categoryId: dining.id, amount: 100, date: `${month}-02`, note: "test" }, t);
  assert.equal(created.status, 201);
  const after = (await api("GET", "/budget/summary", undefined, t)).json;
  assert.equal(after.categories.find((c: any) => c.id === dining.id).actual, dining.actual + 100);
  assert.ok(after.optimization.items.length > 0);
  assert.ok(after.savingsPlan.steps.length > 0);

  // second user cannot delete or reuse it
  const other = (await api("POST", "/auth/signup", { name: "Other", email: "other@example.com", password: "password123" })).json.token;
  assert.equal((await api("DELETE", `/budget/transactions/${created.json.id}`, undefined, other)).status, 404);
  const cats = (await api("GET", "/budget/categories", undefined, other)).json.categories;
  assert.equal((await api("POST", "/budget/transactions", { categoryId: dining.id, amount: 5, date: `${month}-03` }, other)).status, 400);
  assert.ok(cats.length > 0);

  assert.equal((await api("DELETE", `/budget/transactions/${created.json.id}`, undefined, t)).status, 200);
  assert.equal((await api("POST", "/budget/transactions", { categoryId: dining.id, amount: -5, date: `${month}-03` }, t)).status, 400);
  assert.equal((await api("GET", "/budget/trend?months=6", undefined, t)).json.trend.length, 6);
});

test("budget: savings goals contribute", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const g = (await api("POST", "/budget/goals", { name: "Test goal", target: 1000, current: 100 }, t)).json.goal;
  const c = await api("POST", `/budget/goals/${g.id}/contribute`, { amount: 250 }, t);
  assert.equal(c.json.goal.current, 350);
});

// ------------------------------------------------------------ planner
test("planner: milestones are enriched with plan, strategy and fund ideas; retirement calc works", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const ms = (await api("GET", "/planner/milestones", undefined, t)).json.milestones;
  assert.ok(ms.length >= 2);
  assert.ok(ms[0].plan.requiredMonthly >= 0 && ms[0].strategy.allocation.equity > 0 && ms[0].suggestedFunds.length > 0);

  const r = await api("POST", "/planner/retirement", { age: 35, retirementAge: 65, currentSavings: 50000, monthlyContribution: 800, desiredMonthlyIncomeToday: 5000 }, t);
  assert.equal(r.status, 200);
  assert.ok(r.json.plan.corpusNeeded > 0 && r.json.wealth.yearly.length === 31);
  assert.equal((await api("POST", "/planner/retirement", { age: 70, retirementAge: 65, currentSavings: 0, monthlyContribution: 0, desiredMonthlyIncomeToday: 1 }, t)).status, 400);

  const create = await api("POST", "/planner/milestones", { type: "custom", name: "Boat", targetAmount: 30000, currentSavings: 0, monthlyContribution: 100, targetDate: "2032-01-01", expectedReturn: 0.05 }, t);
  assert.equal(create.status, 201);
  assert.equal((await api("DELETE", `/planner/milestones/${create.json.milestone.id}`, undefined, t)).status, 200);
});

// ------------------------------------------- readable validation errors
test("validation errors name the field and use human units", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const dep = await api("PUT", "/profile", { dependents: 25 }, t);
  assert.equal(dep.status, 400);
  assert.equal(dep.json.error, "Dependents must be at most 20");
  assert.equal(dep.json.details[0].path, "dependents");

  // fractions are reported as the percentages people typed
  const ret = await api("POST", "/planner/retirement", { age: 35, retirementAge: 65, currentSavings: 0, monthlyContribution: 0, desiredMonthlyIncomeToday: 1, inflation: 0.25, preReturn: 0.3, postReturn: 0.05 }, t);
  assert.equal(ret.status, 400);
  assert.match(ret.json.error, /Inflation must be at most 20%/);
  assert.match(ret.json.error, /Return before retirement must be at most 20%/);
  assert.doesNotMatch(ret.json.error, /Too big|expected number/);

  const a = await login("admin@finvara.app", "Admin123!");
  assert.equal((await api("PUT", "/admin/recommendations", { rec_top_n: 99 }, a)).json.error, "Results shown must be at most 20");
  assert.equal((await api("POST", "/auth/signup", { name: "X", email: "nope", password: "short" })).status, 400);
  assert.match((await api("POST", "/auth/signup", { name: "Valid Name", email: "v@example.com", password: "short" })).json.error, /Password must be at least 8 characters/);
  // custom refine() messages are passed through untouched
  assert.match((await api("POST", "/planner/retirement", { age: 70, retirementAge: 65, currentSavings: 0, monthlyContribution: 0, desiredMonthlyIncomeToday: 1 }, t)).json.error, /Retirement age must be above current age/);
  // required strings read naturally
  assert.match((await api("POST", "/will/generate", { testator: { fullName: "", dateOfBirth: "1990-01-01", address: "x", jurisdiction: "x", maritalStatus: "single" } }, t)).json.error, /Full name is required/);
});

// ---------------------------------------------------------------- will
const willInput = () => ({
  testator: { fullName: "Alex Morgan", dateOfBirth: "1990-01-01", address: "1 Main St, Springfield", jurisdiction: "State of Illinois, USA", maritalStatus: "married", spouseName: "Sam Morgan" },
  executor: { name: "Sam Morgan", relationship: "spouse" },
  children: [{ name: "Kid Morgan", dateOfBirth: "2020-05-05" }],
  guardian: { name: "Jo Morgan", relationship: "sister" },
  assets: [{ id: "a1", type: "property", description: "Family home", estimatedValue: 400000 }],
  beneficiaries: [{ id: "b1", name: "Sam Morgan", relationship: "spouse", sharePct: 60 }, { id: "b2", name: "Kid Morgan", relationship: "child", sharePct: 40 }],
  specificBequests: [{ assetId: "a1", description: "my grandfather's watch", beneficiary: "Kid Morgan" }],
  funeral: { preference: "cremation", notes: "" },
});

test("will: shares must total 100%, then a document is generated and downloadable", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const bad = willInput();
  bad.beneficiaries[1].sharePct = 30;
  assert.equal((await api("POST", "/will/generate", bad, t)).status, 422);
  assert.equal((await api("POST", "/will/generate", { testator: {} }, t)).status, 400);
  assert.equal((await api("GET", "/will/download", undefined, t)).status, 404);

  const ok = await api("POST", "/will/generate", willInput(), t);
  assert.equal(ok.status, 200);
  assert.match(ok.json.markdown, /LAST WILL AND TESTAMENT OF ALEX MORGAN/);
  assert.match(ok.json.markdown, /Sam Morgan.*60%/);
  assert.match(ok.json.html, /<!doctype html>/i);

  const dl = await api("GET", "/will/download?format=md", undefined, t);
  assert.equal(dl.status, 200);
  assert.match(dl.res.headers.get("content-disposition") ?? "", /attachment/);
  assert.equal((await api("GET", "/will", undefined, t)).json.status, "generated");
});

test("will: html output escapes user-supplied text", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const w: any = willInput();
  w.testator.fullName = `Eve <script>alert(1)</script>`;
  const out = await api("POST", "/will/generate", w, t);
  assert.equal(out.status, 200);
  assert.ok(!out.json.html.includes("<script>alert(1)</script>"));
});

// ------------------------------------------------------------- market
test("funds: filtering, sorting, compare, builder and recommendations", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const all = (await api("GET", "/funds", undefined, t)).json;
  assert.ok(all.funds.length >= 20 && all.categories.length > 5);
  const lowRisk = (await api("GET", "/funds?maxRisk=2&sort=expense_ratio&dir=asc", undefined, t)).json.funds;
  assert.ok(lowRisk.every((f: any) => f.risk <= 2));
  assert.ok(lowRisk[0].expense_ratio <= lowRisk[lowRisk.length - 1].expense_ratio);

  const cmp = await api("GET", "/funds/compare?symbols=MRIDX,NWGRX,MRBDX", undefined, t);
  assert.equal(cmp.json.funds.length, 3);
  assert.equal(cmp.json.performance[0].MRIDX, 100);
  assert.equal((await api("GET", "/funds/compare?symbols=MRIDX", undefined, t)).status, 400);

  const blend = await api("POST", "/funds/builder", { picks: [{ symbol: "MRIDX", amount: 6000 }, { symbol: "MRBDX", amount: 4000 }] }, t);
  assert.equal(blend.json.blend.total, 10000);
  assert.ok(blend.json.blend.risk > 2 && blend.json.blend.risk < 3);

  const recs = (await api("GET", "/funds/recommendations", undefined, t)).json.recommendations;
  assert.ok(recs.length > 0 && recs[0].match >= recs[recs.length - 1].match && recs[0].reasons.length > 0);
  assert.equal((await api("GET", "/funds/NOPE", undefined, t)).status, 404);
});

test("recommendations respect risk tolerance: conservative users don't get the riskiest funds first", async () => {
  const cons = (await api("POST", "/auth/signup", { name: "Careful", email: "careful@example.com", password: "password123" })).json.token;
  await api("POST", "/profile/risk", { answers: { horizon: 1, drop: 1, goal: 1, experience: 1, stability: 1, loss: 1 } }, cons);
  const recs = (await api("GET", "/funds/recommendations", undefined, cons)).json.recommendations;
  assert.ok(recs[0].item.risk <= 2, `top pick risk was ${recs[0].item.risk}`);
});

test("stocks: screening, movers, sectors, detail and watchlist/portfolio flow", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const s = (await api("GET", "/stocks?sector=Technology&sort=pe&dir=asc", undefined, t)).json;
  assert.ok(s.stocks.length > 0 && s.stocks.every((x: any) => x.sector === "Technology"));
  const div = (await api("GET", "/stocks?minDividend=3", undefined, t)).json.stocks;
  assert.ok(div.length > 0 && div.every((x: any) => x.dividend_yield >= 3));
  const mv = (await api("GET", "/stocks/movers", undefined, t)).json;
  assert.ok(mv.gainers[0].changePct >= mv.losers[0].changePct);
  assert.ok((await api("GET", "/stocks/sectors", undefined, t)).json.sectors.length >= 8);
  const d = (await api("GET", "/stocks/QNTR?range=3M", undefined, t)).json;
  assert.equal(d.stock.symbol, "QNTR");
  assert.ok(d.history.length > 40 && d.peers.length > 0);

  assert.equal((await api("POST", "/watchlist", { kind: "stock", symbol: "NMBS" }, t)).status, 201);
  assert.equal((await api("POST", "/watchlist", { kind: "stock", symbol: "ZZZZ" }, t)).status, 404);
  assert.ok((await api("GET", "/watchlist", undefined, t)).json.items.some((i: any) => i.symbol === "NMBS"));
  assert.equal((await api("DELETE", "/watchlist/stock/NMBS", undefined, t)).status, 200);

  const before = (await api("GET", "/portfolio", undefined, t)).json;
  const add = await api("POST", "/portfolio/holdings", { kind: "stock", symbol: "QNTR", units: 4 }, t);
  assert.equal(add.status, 201);
  const after = (await api("GET", "/portfolio", undefined, t)).json;
  assert.ok(after.totalValue > before.totalValue);
  assert.ok(after.findings.length > 0);
  const h = after.holdings.find((x: any) => x.symbol === "QNTR");
  assert.equal((await api("DELETE", `/portfolio/holdings/${h.id}`, undefined, t)).status, 200);
});

test("dashboard aggregates everything", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const d = (await api("GET", "/dashboard", undefined, t)).json;
  assert.ok(d.netWorth.total !== undefined && d.trend.length === 6 && d.picks.funds.length > 0);
  assert.ok(d.month.income > 0 && d.milestones.length >= 2);
});

// ---------------------------------------------------------------- chat
async function chatSSE(token: string, agent: string, message: string, conversationId?: number) {
  const res = await fetch(base + "/chat/message", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ agent, message, conversationId }),
  });
  assert.equal(res.status, 200);
  const raw = await res.text();
  const events = raw.split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")));
  return { events, text: events.filter((e) => e.type === "text").map((e) => e.delta).join("") };
}

test("chat: all 3 agents expose 5 tools each (15 total)", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const r = (await api("GET", "/chat/agents", undefined, t)).json;
  assert.equal(r.mode, "demo");
  assert.equal(r.agents.length, 3);
  for (const a of r.agents) assert.equal(a.tools.length, 5);
});

const CASES: [string, string, string, RegExp][] = [
  ["personal", "Where is my money going this month? Analyze my budget", "analyze_budget", /savings rate/i],
  ["personal", "How much should I be saving?", "recommend_savings", /emergency fund/i],
  ["personal", "Help me plan for a $60,000 house down payment in 5 years", "plan_goal", /\$60,000/],
  ["personal", "What is my risk tolerance?", "assess_risk", /risk/i],
  ["personal", "Which expenses can I cut or reduce?", "optimize_expenses", /trim|saving/i],
  ["investment", "Which stocks look good for me?", "recommend_stocks", /Stock ideas/],
  ["investment", "Suggest some mutual funds", "match_mutual_funds", /Funds matched/],
  ["investment", "Review my portfolio diversification", "analyze_portfolio", /Portfolio review/],
  ["investment", "What's the market doing today?", "market_insight", /Market snapshot/],
  ["investment", "Which sectors should I overweight?", "analyze_sectors", /Sector view/],
  ["wealth", "Am I on track to retire at 62?", "plan_retirement", /Retirement outlook/],
  ["wealth", "How can I be more tax-efficient with taxes?", "optimize_taxes", /Tax-smart/],
  ["wealth", "Project my wealth over 25 years", "project_wealth", /25 years/],
  ["wealth", "Do I have enough life insurance coverage?", "assess_insurance", /Insurance needs/],
  ["wealth", "Help with my will and beneficiaries", "estate_planning", /Estate planning/],
];
for (const [agent, msg, tool, re] of CASES) {
  test(`chat (demo): ${agent} → ${tool}`, async () => {
    const t = await login("demo@finvara.app", "Demo1234!");
    const { events, text } = await chatSSE(t, agent, msg);
    assert.equal(events[0].type, "start");
    const started = events.filter((e) => e.type === "tool_start").map((e) => e.name);
    assert.ok(started.includes(tool), `expected ${tool}, ran ${started.join(",") || "nothing"}`);
    assert.ok(events.filter((e) => e.type === "tool_result").every((e) => e.ok), "tool failed");
    assert.match(text, re);
    assert.equal(events.at(-1).type, "done");
  });
}

test("chat: conversations persist with tool badges, are private, and honour the daily limit & kill switch", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const first = await chatSSE(t, "personal", "Analyze my budget");
  const cid = first.events[0].conversationId;
  await chatSSE(t, "personal", "How much should I save?", cid);
  const conv = (await api("GET", `/chat/conversations/${cid}`, undefined, t)).json;
  assert.equal(conv.messages.length, 4);
  assert.ok(conv.messages[1].tools.length > 0);
  const stranger = (await api("POST", "/auth/signup", { name: "Snoop", email: "snoop@example.com", password: "password123" })).json.token;
  assert.equal((await api("GET", `/chat/conversations/${cid}`, undefined, stranger)).status, 404);
  assert.equal((await api("POST", "/chat/message", { agent: "wealth", conversationId: cid, message: "hi" }, t)).status, 400); // wrong agent

  const a = await login("admin@finvara.app", "Admin123!");
  await api("PUT", "/admin/settings", { chatbot_enabled: false }, a);
  assert.equal((await api("POST", "/chat/message", { agent: "personal", message: "hi" }, t)).status, 503);
  await api("PUT", "/admin/settings", { chatbot_enabled: true, chat_daily_limit: 1 }, a);
  assert.equal((await api("POST", "/chat/message", { agent: "personal", message: "hi" }, t)).status, 429);
  await api("PUT", "/admin/settings", { chat_daily_limit: 60 }, a);
});

test("chat: tool inputs are validated (bad inputs become tool errors, not crashes)", async () => {
  const { executeTool } = await import("../src/ai/engine.ts");
  const { toolByName } = await import("../src/ai/tools.ts");
  const out = executeTool(toolByName("plan_goal")!, { userId: 1, ctx: () => ({}) as any }, { targetAmount: -5 });
  assert.equal(out.ok, false);
  assert.match(JSON.stringify(out.output), /Invalid input/);
});

// ------------------------------------------------ recurring, reports, csv
test("recurring: demo subscriptions and bills are detected with next due dates", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const r = (await api("GET", "/budget/recurring", undefined, t)).json;
  const names = r.items.map((i: any) => i.name);
  for (const n of ["Netflix", "Spotify", "Maple Apartments rent", "Comcast Internet"]) assert.ok(names.includes(n), `${n} missing from ${names}`);
  assert.ok(!names.includes("Auto-invest transfer"), "savings transfers are not bills");
  assert.ok(!names.includes("Starbucks"), "frequent purchases are not bills");
  assert.ok(r.monthlyTotal > 2000 && r.annualTotal === +(r.monthlyTotal * 12).toFixed(2));
  assert.ok(r.income.some((i: any) => i.name === "Acme Corp payroll"));
  assert.ok(r.items.every((i: any) => i.nextDate > new Date(Date.now() - 86400000).toISOString().slice(0, 10)));
  assert.ok(r.upcoming.every((u: any) => u.daysUntil <= 30));
});

test("report: category trends over months and top merchants", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const r = (await api("GET", "/budget/report?months=6", undefined, t)).json;
  assert.equal(r.months.length, 6);
  assert.ok(r.categories.length >= 6 && r.categories.every((c: any) => c.totals.length === 6));
  assert.ok(!r.categories.some((c: any) => c.bucket === "savings"));
  assert.ok(r.categories[0].total >= r.categories[r.categories.length - 1].total, "sorted by total");
  assert.ok(r.merchants.length > 3 && r.merchants[0].total >= r.merchants[1].total);
});

test("transactions: search by merchant or category", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const hits = (await api("GET", "/budget/transactions?q=netflix", undefined, t)).json.transactions;
  assert.ok(hits.length >= 3 && hits.every((x: any) => /netflix/i.test(x.note)));
  assert.equal((await api("GET", "/budget/transactions?q=zzzznothing", undefined, t)).json.transactions.length, 0);
});

test("csv: export neutralises formulas; import maps categories, skips duplicates, reports bad rows", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const sum = (await api("GET", "/budget/summary", undefined, t)).json;
  const dining = sum.categories.find((c: any) => c.name === "Dining out");
  await api("POST", "/budget/transactions", { categoryId: dining.id, amount: 12.34, date: `${sum.month}-02`, note: '=HYPERLINK("http://evil","click")' }, t);
  const exp = await api("GET", `/budget/transactions/export?month=${sum.month}`, undefined, t);
  assert.equal(exp.status, 200);
  assert.match(exp.res.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(exp.json as string, /^date,type,category,amount,note/);
  assert.ok(!/,=HYPERLINK/.test(exp.json as string), "formula must be defused");
  assert.match(exp.json as string, /'=HYPERLINK/);

  const rows = [
    { date: "2026-09-04", amount: 23.5, kind: "expense", category: "Coffee Runs", note: "Blue Bottle" },
    { date: "2026-09-04", amount: 23.5, kind: "expense", category: "coffee runs", note: "Blue Bottle" }, // duplicate (case-insensitive)
    { date: "2026-09-05", amount: 80, kind: "income", category: "Refunds", note: "Tax refund" },
    { date: "not-a-date", amount: 5, kind: "expense", category: "Dining out", note: "bad" },
    { date: "2026-09-06", amount: -5, kind: "expense", category: "Dining out", note: "negative" },
  ];
  const imp = await api("POST", "/budget/transactions/import", { rows }, t);
  assert.equal(imp.status, 201);
  assert.equal(imp.json.imported, 2);
  assert.equal(imp.json.skipped, 1);
  assert.equal(imp.json.errorCount, 2);
  assert.deepEqual(imp.json.createdCategories.sort(), ["Coffee Runs", "Refunds"]);
  // re-importing the same file adds nothing
  assert.equal((await api("POST", "/budget/transactions/import", { rows: rows.slice(0, 3) }, t)).json.imported, 0);
  assert.equal((await api("POST", "/budget/transactions/import", { rows: [] }, t)).status, 400);
  assert.equal((await api("POST", "/budget/transactions/import", { rows }, undefined)).status, 401);
});

// ------------------------------------------------ calculators (public)
test("calculators: public, validated, and consistent with the maths", async () => {
  const sip = await api("POST", "/calc/sip", { monthly: 500, years: 10, returnPct: 12 });
  assert.equal(sip.status, 200);
  assert.equal(sip.json.invested, 60000);
  assert.ok(sip.json.futureValue > 110000 && sip.json.futureValue < 120000);
  assert.equal(sip.json.series.length, 11);
  const bad = await api("POST", "/calc/sip", { monthly: 500, years: 10, returnPct: 45 });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "Expected return must be at most 30%");
  const lump = await api("POST", "/calc/lumpsum", { amount: 10000, years: 10, returnPct: 7 });
  assert.ok(Math.abs(lump.json.futureValue - 10000 * 1.07 ** 10) < 1);
  const debt = await api("POST", "/calc/debt", { balance: 10000, aprPct: 18, payment: 300, extra: 100 });
  assert.ok(debt.json.interestSaved > 0 && debt.json.monthsSaved > 0);
  assert.equal((await api("POST", "/calc/debt", { balance: 10000, aprPct: 18, payment: 100, extra: 0 })).json.base.months, null);
});

// ------------------------------------------- dashboard: history, checklist
test("dashboard: net-worth history, getting-started checklist and savings-rate honesty", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const d = (await api("GET", "/dashboard", undefined, t)).json;
  assert.ok(d.netWorth.history.length > 20, "a year of weekly history is seeded");
  assert.ok(d.netWorth.history[0].date < d.netWorth.history.at(-1).date);
  assert.ok(d.netWorth.change.amount > 0 && d.netWorth.change.pct > 0);
  assert.equal(d.netWorth.history.at(-1).total, d.netWorth.total, "latest point is today's real figure");
  assert.equal(d.checklist.length, 8);
  assert.ok(d.checklist.find((c: any) => c.id === "profile").done);
  assert.equal(d.month.hasSpending, true);
  assert.equal((await api("GET", "/dashboard/networth?range=3M", undefined, t)).json.range, "3M");

  const fresh = (await api("POST", "/auth/signup", { name: "Fresh Face", email: "fresh@example.com", password: "password123" })).json.token;
  await api("POST", "/profile/onboarding", { age: 30, monthlyIncome: 3000 }, fresh);
  const f = (await api("GET", "/dashboard", undefined, fresh)).json;
  assert.equal(f.month.hasSpending, false);
  // onboarding saves the profile and sizes the default budget; everything else is still to do
  assert.deepEqual(f.checklist.filter((c: any) => c.done).map((c: any) => c.id).sort(), ["budget", "profile"]);
  assert.equal(f.netWorth.history.length, 1);
  assert.equal(f.netWorth.change, null);
});

test("retirement API adds Monte Carlo bands and a success probability", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const body = { age: 35, retirementAge: 65, currentSavings: 50000, monthlyContribution: 800, desiredMonthlyIncomeToday: 4000 };
  const r = (await api("POST", "/planner/retirement", body, t)).json;
  assert.ok(r.monteCarlo.successProbability >= 0 && r.monteCarlo.successProbability <= 1);
  assert.equal(r.monteCarlo.bands.length, 56);
  assert.ok(r.monteCarlo.atRetirement.p10 < r.monteCarlo.atRetirement.p90);
  const richer = (await api("POST", "/planner/retirement", { ...body, monthlyContribution: 3000 }, t)).json;
  assert.ok(richer.monteCarlo.successProbability >= r.monteCarlo.successProbability);
  assert.deepEqual((await api("POST", "/planner/retirement", body, t)).json.monteCarlo, r.monteCarlo, "same inputs → same answer");
});

test("planner defaults come from real behaviour, not constants", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const d = (await api("GET", "/planner/defaults", undefined, t)).json;
  assert.equal(d.age, 34);
  assert.ok(d.monthlyContribution >= 1500 && d.monthlyContribution <= 3250, `saved ${d.monthlyContribution}`);
  assert.ok(d.currentSavings > 30000);
  assert.equal(d.desiredMonthlyIncomeToday % 100, 0);
  assert.match(d.basis, /last \d full months/);
  // a brand-new user has no history: falls back to a modest share of income
  const fresh = (await api("POST", "/auth/signup", { name: "Brand New", email: "brandnew@example.com", password: "password123" })).json.token;
  await api("POST", "/profile/onboarding", { age: 28, monthlyIncome: 4000 }, fresh);
  const f = (await api("GET", "/planner/defaults", undefined, fresh)).json;
  assert.equal(f.monthlyContribution, 400);
  assert.equal(f.basis, "10% of your income");
});

// ------------------------------------------------------- notifications
test("notifications: derived from data, sorted by severity, and dismissals stick", async () => {
  const t = await login("demo@finvara.app", "Demo1234!");
  const sum = (await api("GET", "/budget/summary", undefined, t)).json;
  const dining = sum.categories.find((c: any) => c.name === "Dining out");
  // push dining over plan so an alert must appear
  await api("POST", "/budget/transactions", { categoryId: dining.id, amount: 900, date: `${sum.month}-01`, note: "alert test" }, t);
  const first = (await api("GET", "/notifications", undefined, t)).json.notifications;
  const over = first.find((n: any) => n.id.startsWith("over:Dining out"));
  assert.ok(over, "expected an over-budget alert");
  assert.ok(["danger", "warning"].includes(over.level));
  const rank: Record<string, number> = { danger: 0, warning: 1, info: 2, good: 3 };
  for (let i = 1; i < first.length; i++) assert.ok(rank[first[i - 1].level] <= rank[first[i].level], "sorted by severity");
  assert.equal((await api("POST", "/notifications/dismiss", { ids: [over.id] }, t)).status, 200);
  assert.ok(!(await api("GET", "/notifications", undefined, t)).json.notifications.some((n: any) => n.id === over.id));
  assert.equal((await api("POST", "/notifications/dismiss", { ids: [] }, t)).status, 400);
  assert.equal((await api("GET", "/notifications")).status, 401);
});

// --------------------------------------------------------------- admin
test("admin: users, content, recommendation config, monitoring and settings", async () => {
  const a = await login("admin@finvara.app", "Admin123!");
  const users = (await api("GET", "/admin/users?q=demo", undefined, a)).json;
  assert.ok(users.users.some((u: any) => u.email === "demo@finvara.app"));

  const victim = (await api("POST", "/auth/signup", { name: "Victim", email: "victim@example.com", password: "password123" })).json;
  assert.equal((await api("PATCH", `/admin/users/${victim.user.id}`, { active: false }, a)).status, 200);
  assert.equal((await api("POST", "/auth/login", { email: "victim@example.com", password: "password123" })).status, 403);
  assert.equal((await api("GET", "/dashboard", undefined, victim.token)).status, 401); // existing token stops working
  assert.equal((await api("PATCH", "/admin/users/1", { active: false }, a)).status, 400); // can't deactivate self
  assert.equal((await api("DELETE", `/admin/users/${victim.user.id}`, undefined, a)).status, 200);

  const upd = await api("PUT", "/admin/funds/MRLCX", { expense_ratio: 0.11, featured: false }, a);
  assert.equal(upd.json.fund.expense_ratio, 0.11);
  const px = await api("PUT", "/admin/stocks/QNTR", { price: 400 }, a);
  assert.equal(px.json.stock.price, 400);
  const newStock = await api("POST", "/admin/stocks", { symbol: "tstx", name: "Test Corp", sector: "Technology", price: 50, market_cap_bn: 5, pe: 20, dividend_yield: 1, beta: 1, eps_growth: 8, volatility: 0.25, description: "x", featured: false, active: true }, a);
  assert.equal(newStock.status, 201);
  assert.equal(newStock.json.stock.symbol, "TSTX");
  assert.equal((await api("POST", "/admin/stocks", { symbol: "TSTX", name: "Dup", sector: "Technology", price: 50, market_cap_bn: 5, pe: 20, dividend_yield: 1, beta: 1, eps_growth: 8, volatility: 0.25, description: "x", featured: false, active: true }, a)).status, 409);
  await api("PUT", "/admin/stocks/TSTX", { active: false }, a);
  const t = await login("demo@finvara.app", "Demo1234!");
  assert.ok(!(await api("GET", "/stocks", undefined, t)).json.stocks.some((s: any) => s.symbol === "TSTX"), "deactivated stock must be hidden");

  const rc = await api("PUT", "/admin/recommendations", { rec_weight_cost: 0.9, rec_top_n: 3 }, a);
  assert.equal(rc.status, 200);
  assert.ok((await api("GET", "/admin/recommendations/preview?risk=3&horizon=10", undefined, a)).json.funds.length <= 3);
  await api("PUT", "/admin/recommendations", { rec_weight_cost: 0.15, rec_top_n: 6 }, a);

  const stats = (await api("GET", "/admin/chat/stats", undefined, a)).json;
  assert.equal(stats.tools.length, 15);
  assert.ok(stats.tools.some((x: any) => x.calls > 0));
  const convs = (await api("GET", "/admin/chat/conversations", undefined, a)).json;
  assert.ok(convs.total > 0);
  const detail = (await api("GET", `/admin/chat/conversations/${convs.conversations[0].id}`, undefined, a)).json;
  assert.ok(detail.messages.length > 0);

  assert.equal((await api("PUT", "/admin/settings", { chat_max_tokens: 5 }, a)).status, 400);
  assert.equal((await api("PUT", "/admin/settings", { announcement: "Maintenance tonight" }, a)).json.settings.announcement, "Maintenance tonight");
  assert.equal((await api("GET", "/public")).json.announcement, "Maintenance tonight");
  await api("PUT", "/admin/settings", { registration_open: false }, a);
  assert.equal((await api("POST", "/auth/signup", { name: "Late", email: "late@example.com", password: "password123" })).status, 403);
});
