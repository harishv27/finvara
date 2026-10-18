import { all, db, get, run, tx, setSetting } from "./db.ts";
import { hashPassword } from "./lib/auth.ts";
import { hashString, rng } from "./lib/rng.ts";
import { round } from "./finance/math.ts";
import { computeNetWorth, recordSnapshot } from "./networth.ts";

export const DAYS = 260; // ~1 trading year

export function tradingDates(n: number) {
  const out: string[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  while (out.length < n) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/** Geometric Brownian motion path rescaled so the final value equals `last`. */
export function series(symbol: string, last: number, annualDrift: number, annualVol: number, n = DAYS) {
  const r = rng(hashString(symbol));
  const dt = 1 / 252;
  const raw: number[] = [100];
  for (let i = 1; i < n; i++) {
    const shock = r.normal() * annualVol * Math.sqrt(dt);
    raw.push(raw[i - 1] * Math.exp((annualDrift - 0.5 * annualVol ** 2) * dt + shock));
  }
  const k = last / raw[n - 1];
  return raw.map((v) => round(v * k, 2));
}

// ---------------------------------------------------------------- stocks
// symbol, name, sector, price, mcap($bn), pe, div%, beta, epsGrowth%, annual vol, drift, featured
type S = [string, string, string, number, number, number, number, number, number, number, number, number];
const STOCKS: S[] = [
  ["QNTR", "Quantora Systems", "Technology", 412.8, 1820, 31.2, 0.5, 1.18, 18, 0.28, 0.22, 1],
  ["NMBS", "Nimbus Cloudworks", "Technology", 188.4, 640, 42.6, 0, 1.35, 24, 0.34, 0.26, 0],
  ["AXSM", "Axiom Semiconductors", "Technology", 96.1, 310, 26.8, 0.9, 1.52, 21, 0.4, 0.3, 1],
  ["LTCD", "Lattice Data", "Technology", 54.7, 88, 38.4, 0, 1.4, 19, 0.38, 0.12, 0],
  ["PXFG", "Pixelforge Interactive", "Technology", 31.2, 22, 24.1, 0, 1.6, 14, 0.45, -0.04, 0],
  ["HLXA", "Helixa Biosciences", "Healthcare", 148.9, 210, 28.3, 0.8, 0.82, 12, 0.24, 0.1, 1],
  ["CRDV", "Cardiva Medical", "Healthcare", 77.3, 95, 22.5, 1.4, 0.74, 9, 0.2, 0.08, 0],
  ["VTLS", "Vitalis Pharma", "Healthcare", 62.6, 140, 16.2, 3.1, 0.58, 4, 0.17, 0.03, 0],
  ["CRWL", "Curewell Health", "Healthcare", 205.2, 260, 19.4, 1.1, 0.69, 11, 0.21, 0.12, 0],
  ["BSTN", "Bastion Financial", "Financials", 142.5, 410, 12.4, 2.6, 1.08, 8, 0.22, 0.14, 1],
  ["HRBT", "Harbor Trust", "Financials", 58.4, 120, 10.8, 3.4, 0.96, 5, 0.2, 0.07, 0],
  ["PNCL", "Pinnacle Insurance", "Financials", 223.1, 175, 14.6, 2.1, 0.78, 7, 0.17, 0.11, 0],
  ["LDGR", "Ledgerline Payments", "Financials", 119.8, 245, 29.5, 0.4, 1.22, 17, 0.3, 0.18, 0],
  ["SLRA", "Solara Renewables", "Energy", 38.9, 52, 33.7, 0.6, 1.45, 27, 0.42, 0.2, 1],
  ["TRPN", "Terrapin Oil & Gas", "Energy", 87.2, 205, 9.4, 4.8, 1.05, 2, 0.27, 0.02, 0],
  ["ALDR", "Alder & Oak Retail", "Consumer Discretionary", 164.3, 138, 21.7, 1.2, 1.12, 10, 0.26, 0.09, 0],
  ["RMLY", "Roamly Travel", "Consumer Discretionary", 72.5, 41, 27.9, 0, 1.55, 22, 0.41, 0.15, 0],
  ["URBS", "Urban Stride Apparel", "Consumer Discretionary", 46.8, 29, 18.3, 1.9, 1.18, 6, 0.32, -0.08, 0],
  ["BRWH", "Brewhaus Coffee", "Consumer Discretionary", 108.9, 115, 25.6, 1.5, 0.92, 12, 0.23, 0.1, 0],
  ["GDFD", "Goodfield Foods", "Consumer Staples", 69.4, 98, 17.1, 3.3, 0.52, 3, 0.14, 0.04, 1],
  ["PRHT", "PureHearth Household", "Consumer Staples", 131.7, 215, 20.8, 2.7, 0.55, 4, 0.13, 0.06, 0],
  ["SNVL", "Sunvale Beverages", "Consumer Staples", 52.1, 140, 22.4, 3.0, 0.48, 3, 0.12, 0.05, 0],
  ["IRBR", "Ironbridge Machinery", "Industrials", 218.6, 150, 18.9, 1.7, 1.02, 9, 0.25, 0.13, 0],
  ["SKYL", "Skyline Aerospace", "Industrials", 304.2, 330, 30.1, 0.9, 1.1, 15, 0.28, 0.2, 1],
  ["TRNV", "Transvia Logistics", "Industrials", 94.5, 80, 15.3, 2.2, 1.06, 6, 0.24, 0.05, 0],
  ["VLTG", "Voltgrid Power", "Utilities", 71.8, 95, 17.5, 3.9, 0.42, 4, 0.13, 0.05, 1],
  ["AQFL", "Aquaflow Water", "Utilities", 56.3, 38, 21.2, 3.2, 0.38, 5, 0.12, 0.06, 0],
  ["KSTN", "Keystone Properties", "Real Estate", 84.9, 60, 24.8, 4.4, 0.85, 3, 0.19, 0.01, 0],
  ["STKB", "Stackbox Storage REIT", "Real Estate", 152.4, 72, 28.6, 3.8, 0.8, 5, 0.18, 0.04, 0],
  ["CBLT", "Cobaltic Mining", "Materials", 41.7, 36, 13.6, 2.0, 1.38, 5, 0.35, -0.02, 0],
  ["VRDC", "Verdant Chemicals", "Materials", 98.3, 64, 15.8, 2.5, 1.0, 6, 0.23, 0.07, 0],
  ["SGWV", "Signalwave Telecom", "Communication", 29.6, 118, 11.2, 5.2, 0.65, 2, 0.16, -0.01, 0],
  ["STRM", "Streamline Media", "Communication", 185.7, 290, 33.4, 0, 1.28, 16, 0.3, 0.19, 0],
];

// ----------------------------------------------------------------- funds
// symbol, name, category, house, risk, expense%, aum$bn, min$, 3Y%, 5Y%, vol, drift(annual, for the last year path), allocation, desc, featured
type F = [string, string, string, string, number, number, number, number, number, number, number, number, Record<string, number>, string, number];
const EQ = (t: number, h: number, f: number, o: number) => ({ Technology: t, Healthcare: h, Financials: f, Other: o });
const FUNDS: F[] = [
  ["MRLCX", "Meridian Large Cap Fund", "Large Cap Equity", "Meridian", 3, 0.62, 48.2, 1000, 12.4, 13.1, 0.15, 0.14, EQ(28, 14, 17, 41), "Blue-chip US companies with durable earnings and moderate volatility.", 1],
  ["MRIDX", "Meridian 500 Index Fund", "Index", "Meridian", 3, 0.04, 310.5, 500, 13.8, 14.2, 0.15, 0.16, EQ(31, 12, 13, 44), "Tracks a broad US large-cap index at near-zero cost.", 1],
  ["NWGRX", "Northwind Growth Fund", "Growth", "Northwind", 4, 0.89, 22.7, 2500, 15.9, 16.4, 0.21, 0.22, EQ(46, 16, 8, 30), "High-growth companies reinvesting for expansion; higher swings.", 1],
  ["NWVLX", "Northwind Value Fund", "Value", "Northwind", 3, 0.71, 18.4, 2500, 9.8, 10.9, 0.14, 0.09, EQ(10, 13, 28, 49), "Undervalued businesses with strong balance sheets and dividends.", 0],
  ["HLMDX", "Halcyon Mid Cap Fund", "Mid Cap Equity", "Halcyon", 4, 0.78, 9.6, 1000, 11.2, 12.5, 0.19, 0.12, EQ(22, 15, 14, 49), "Established mid-sized firms with room to scale.", 0],
  ["HLSMX", "Halcyon Small Cap Fund", "Small Cap Equity", "Halcyon", 5, 1.05, 4.1, 1000, 10.1, 11.8, 0.25, 0.08, EQ(20, 18, 12, 50), "Smaller, nimbler companies — greater upside and sharper drawdowns.", 0],
  ["ORBIX", "Orbis Global Equity Fund", "International Equity", "Orbis", 4, 0.95, 15.3, 2000, 8.7, 9.6, 0.17, 0.11, EQ(24, 13, 19, 44), "Diversified exposure to developed and emerging markets outside the US.", 0],
  ["ORBEX", "Orbis Emerging Markets Fund", "International Equity", "Orbis", 5, 1.25, 6.8, 2000, 6.9, 7.4, 0.23, 0.05, EQ(26, 8, 24, 42), "Fast-growing economies; currency and political risk apply.", 0],
  ["SPTEX", "Summit Peak Technology Fund", "Sector — Technology", "Summit Peak", 5, 0.94, 12.9, 1000, 18.3, 19.6, 0.26, 0.28, EQ(88, 2, 2, 8), "Concentrated exposure to software, semiconductors and cloud.", 1],
  ["SPHCX", "Summit Peak Healthcare Fund", "Sector — Healthcare", "Summit Peak", 4, 0.88, 8.4, 1000, 9.4, 11.0, 0.16, 0.1, EQ(4, 90, 0, 6), "Pharma, biotech and medical devices; defensive with innovation upside.", 0],
  ["VRDVX", "Verdant Dividend Income Fund", "Dividend Income", "Verdant", 2, 0.45, 26.0, 1000, 8.2, 9.1, 0.11, 0.07, EQ(12, 14, 22, 52), "Reliable dividend payers aiming for rising income.", 1],
  ["VRESX", "Verdant ESG Leaders Fund", "ESG Equity", "Verdant", 3, 0.55, 11.2, 1000, 11.9, 12.7, 0.15, 0.13, EQ(30, 15, 12, 43), "Screens for strong environmental, social and governance practices.", 0],
  ["MRBDX", "Meridian Total Bond Fund", "Intermediate Bond", "Meridian", 2, 0.12, 95.3, 500, 1.9, 2.4, 0.05, 0.035, { Treasury: 42, "Investment Grade": 38, Mortgage: 20 }, "Core high-quality bond exposure for stability and income.", 1],
  ["NWHYX", "Northwind High Yield Fund", "High Yield Bond", "Northwind", 3, 0.68, 7.5, 1000, 4.8, 5.3, 0.08, 0.06, { "High Yield": 90, Cash: 10 }, "Higher-coupon corporate bonds; credit risk rises in downturns.", 0],
  ["HLSTX", "Halcyon Short-Term Bond Fund", "Short-Term Bond", "Halcyon", 1, 0.2, 19.8, 500, 2.8, 2.5, 0.025, 0.042, { Treasury: 55, "Investment Grade": 45 }, "Short maturities limit interest-rate sensitivity.", 0],
  ["ORGBX", "Orbis Government Bond Fund", "Government Bond", "Orbis", 1, 0.15, 33.0, 500, 1.2, 1.9, 0.045, 0.03, { Treasury: 100 }, "Sovereign debt for capital preservation.", 0],
  ["VRMMX", "Verdant Money Market Fund", "Money Market", "Verdant", 1, 0.1, 140.0, 100, 4.1, 2.6, 0.003, 0.045, { Cash: 100 }, "Cash-like fund for emergency money and near-term goals.", 1],
  ["NWBAX", "Northwind Balanced Fund", "Balanced", "Northwind", 2, 0.58, 29.4, 1000, 7.1, 8.0, 0.09, 0.08, { Equity: 60, Bonds: 38, Cash: 2 }, "A 60/40 portfolio in a single fund, rebalanced automatically.", 1],
  ["HLCSX", "Halcyon Conservative Allocation", "Balanced", "Halcyon", 1, 0.5, 14.6, 1000, 4.9, 5.4, 0.06, 0.055, { Equity: 30, Bonds: 60, Cash: 10 }, "Capital preservation first, modest growth second.", 0],
  ["HLAGX", "Halcyon Aggressive Allocation", "Balanced", "Halcyon", 4, 0.66, 10.2, 1000, 11.5, 12.0, 0.17, 0.15, { Equity: 90, Bonds: 8, Cash: 2 }, "Equity-heavy allocation for long horizons.", 0],
  ["TD40X", "Meridian Target Date 2040", "Target Date", "Meridian", 3, 0.14, 38.7, 1000, 9.6, 10.4, 0.11, 0.1, { Equity: 68, Bonds: 29, Cash: 3 }, "Automatically shifts to bonds as 2040 approaches.", 1],
  ["TD50X", "Meridian Target Date 2050", "Target Date", "Meridian", 4, 0.14, 41.2, 1000, 11.3, 12.1, 0.14, 0.13, { Equity: 88, Bonds: 11, Cash: 1 }, "Long-horizon glide path for investors retiring around 2050.", 0],
  ["VRRIX", "Verdant Real Estate Fund", "Real Estate", "Verdant", 3, 0.74, 8.9, 1000, 5.8, 6.4, 0.16, 0.03, { "Residential REITs": 32, "Industrial REITs": 28, "Healthcare REITs": 15, Other: 25 }, "Listed property companies providing income and inflation protection.", 0],
  ["SPGDX", "Summit Peak Gold & Metals Fund", "Commodities", "Summit Peak", 4, 0.82, 3.6, 1000, 7.9, 8.8, 0.2, 0.16, { "Gold Miners": 55, Bullion: 30, "Other Metals": 15 }, "Inflation hedge; returns can be volatile and uncorrelated with stocks.", 0],
  ["NWIFX", "Northwind Inflation-Protected Fund", "Inflation-Protected Bond", "Northwind", 2, 0.22, 12.4, 500, 2.2, 3.4, 0.06, 0.04, { TIPS: 100 }, "Principal adjusts with inflation for real purchasing-power protection.", 0],
  ["MRSCX", "Meridian Small & Mid Index", "Index", "Meridian", 4, 0.06, 28.9, 500, 9.5, 10.8, 0.2, 0.09, EQ(18, 14, 15, 53), "Low-cost exposure to smaller US companies.", 0],
  ["ORBDX", "Orbis International Dividend", "Dividend Income", "Orbis", 3, 0.7, 5.8, 2000, 6.3, 7.2, 0.13, 0.07, EQ(8, 13, 25, 54), "Dividend-paying companies outside the US.", 0],
  ["VRCLX", "Verdant Clean Energy Fund", "Sector — Energy", "Verdant", 5, 0.97, 3.9, 1000, 8.8, 5.1, 0.3, 0.12, { "Solar/Wind": 45, Storage: 20, Utilities: 20, Other: 15 }, "Renewable generation and grid technology; high volatility.", 0],
  ["NWQLX", "Northwind Quality Compounders", "Large Cap Equity", "Northwind", 3, 0.52, 17.1, 1000, 13.0, 13.9, 0.14, 0.15, EQ(26, 17, 14, 43), "High-return-on-capital businesses held for the long term.", 0],
];

export function seedMarket(force = false) {
  const existing = get<{ n: number }>("SELECT COUNT(*) n FROM stocks")!.n;
  if (existing > 0 && !force) return false;
  const dates = tradingDates(DAYS);
  tx(() => {
    run("DELETE FROM price_history");
    run("DELETE FROM stocks");
    run("DELETE FROM funds");
    const insH = db.prepare("INSERT INTO price_history(symbol,date,close) VALUES(?,?,?)");
    for (const [sym, name, sector, price, mcap, pe, div, beta, eps, vol, drift, feat] of STOCKS) {
      const s = series(sym, price, drift, vol);
      s.forEach((c, i) => insH.run(sym, dates[i], c));
      const prev = s[s.length - 2];
      run(
        `INSERT INTO stocks(symbol,name,sector,price,prev_close,market_cap_bn,pe,dividend_yield,beta,eps_growth,week52_high,week52_low,volatility,description,featured)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sym, name, sector, price, prev, mcap, pe, div, beta, eps,
        Math.max(...s), Math.min(...s), vol,
        `${name} is a ${sector.toLowerCase()} company (fictional, generated for demonstration).`,
        feat,
      );
    }
    for (const [sym, name, cat, house, risk, exp, aum, min, r3, r5, vol, drift, alloc, desc, feat] of FUNDS) {
      const s = series(sym, 10 + (hashString(sym) % 4000) / 100, drift, vol);
      s.forEach((c, i) => insH.run(sym, dates[i], c));
      const r1 = round(((s[s.length - 1] / s[0]) - 1) * 100, 1);
      const sharpe = round(Math.max(-0.5, (r3 - 3.5) / 100 / vol), 2);
      run(
        `INSERT INTO funds(symbol,name,category,fund_house,risk,expense_ratio,aum_bn,min_investment,nav,return_1y,return_3y,return_5y,volatility,sharpe,allocation,description,featured)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sym, name, cat, house, risk, exp, aum, min, s[s.length - 1], r1, r3, r5, vol, sharpe, JSON.stringify(alloc), desc, feat,
      );
    }
  });
  return true;
}

// ------------------------------------------------------------ demo users
function monthStr(offset: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  return d.toISOString().slice(0, 7);
}

function seedDemoUser(email: string, name: string, pw: string, role: "user" | "admin") {
  const id = run("INSERT INTO users(email,name,password_hash,role) VALUES(?,?,?,?)", email, name, hashPassword(pw), role).id;
  run("INSERT INTO profiles(user_id) VALUES(?)", id);
  return id;
}

export const DEFAULT_CATEGORIES: [string, "income" | "expense", "need" | "want" | "savings", number, string][] = [
  ["Salary", "income", "need", 0, "#059669"],
  ["Side income", "income", "need", 0, "#10b981"],
  ["Rent / Mortgage", "expense", "need", 0, "#0f766e"],
  ["Groceries", "expense", "need", 0, "#0891b2"],
  ["Utilities", "expense", "need", 0, "#0284c7"],
  ["Transport", "expense", "need", 0, "#4f46e5"],
  ["Insurance", "expense", "need", 0, "#7c3aed"],
  ["Dining out", "expense", "want", 0, "#c026d3"],
  ["Entertainment", "expense", "want", 0, "#db2777"],
  ["Shopping", "expense", "want", 0, "#e11d48"],
  ["Subscriptions", "expense", "want", 0, "#ea580c"],
  ["Travel", "expense", "want", 0, "#d97706"],
  ["Savings & investing", "expense", "savings", 0, "#65a30d"],
];

export function createDefaultCategories(userId: number, income = 0) {
  const plan: Record<string, number> = income
    ? {
        "Rent / Mortgage": income * 0.28, Groceries: income * 0.1, Utilities: income * 0.05, Transport: income * 0.07,
        Insurance: income * 0.04, "Dining out": income * 0.06, Entertainment: income * 0.04, Shopping: income * 0.05,
        Subscriptions: income * 0.02, Travel: income * 0.03, "Savings & investing": income * 0.2, Salary: income,
      }
    : {};
  for (const [name, kind, bucket, , color] of DEFAULT_CATEGORIES)
    run("INSERT OR IGNORE INTO categories(user_id,name,kind,bucket,planned,color) VALUES(?,?,?,?,?,?)", userId, name, kind, bucket, Math.round(plan[name] ?? 0), color);
}

export function seedDemoData(force = false) {
  if (get("SELECT 1 FROM users LIMIT 1") && !force) return false;
  tx(() => {
    seedDemoUser("admin@finvara.app", "Finvara Admin", "Admin123!", "admin");
    const uid = seedDemoUser("demo@finvara.app", "Alex Morgan", "Demo1234!", "user");
    run(
      `UPDATE profiles SET age=34, monthly_income=6500, monthly_expenses=4300, current_savings=18500, total_debt=12000, dependents=1,
       retirement_age=65, risk_score=3, risk_profile='moderate', goals=?, onboarded=1 WHERE user_id=?`,
      JSON.stringify(["Buy a home", "Retire comfortably", "Build an emergency fund"]), uid,
    );
    createDefaultCategories(uid, 6500);
    const cat = (n: string) => get<{ id: number }>("SELECT id FROM categories WHERE user_id=? AND name=?", uid, n)!.id;
    const R = rng(42);
    const insTx = db.prepare("INSERT INTO transactions(user_id,category_id,amount,date,note) VALUES(?,?,?,?,?)");
    // Real-looking merchants so recurring-bill detection, reports and search have something to work with.
    const MERCHANTS: Record<string, string[]> = {
      Groceries: ["Whole Foods", "Trader Joe's", "Safeway", "Costco"],
      "Dining out": ["Chipotle", "Local Thai Kitchen", "Starbucks", "Pizza Palace", "Sushi Bar"],
      Transport: ["Shell", "Uber", "City Metro pass", "Chevron"],
      Shopping: ["Amazon", "Target", "Uniqlo", "IKEA"],
      Entertainment: ["AMC Theatres", "Steam", "Concert tickets", "Bowling night"],
      Travel: ["Delta Air Lines", "Airbnb", "Hertz"],
    };
    // category, payee, amount, day of month, variance — one charge a month
    const RECURRING: [string, string, number, number, number][] = [
      ["Rent / Mortgage", "Maple Apartments rent", 1820, 3, 0], ["Insurance", "Geico auto insurance", 260, 5, 0],
      ["Utilities", "City Power & Light", 118, 11, 0.12], ["Utilities", "Comcast Internet", 79.99, 14, 0], ["Utilities", "Water & Sewer", 42, 16, 0.15],
      ["Subscriptions", "Netflix", 15.49, 8, 0], ["Subscriptions", "Spotify", 10.99, 12, 0], ["Subscriptions", "Planet Fitness", 24.99, 15, 0],
      ["Subscriptions", "Adobe Creative Cloud", 54.99, 19, 0], ["Savings & investing", "Auto-invest transfer", 1300, 2, 0],
    ];
    // category, typical monthly total, variance, number of transactions
    const VARIABLE: [string, number, number, number][] = [
      ["Groceries", 640, 0.15, 8], ["Transport", 470, 0.2, 6], ["Dining out", 480, 0.3, 9], ["Entertainment", 230, 0.4, 4], ["Shopping", 380, 0.5, 5], ["Travel", 150, 0.9, 1],
    ];
    const todayDom = new Date().getDate();
    const dd = (n: number) => String(n).padStart(2, "0");
    for (let m = 0; m < 6; m++) {
      const ym = monthStr(m);
      insTx.run(uid, cat("Salary"), 6500, `${ym}-01`, "Acme Corp payroll");
      if (m % 2 === 0) insTx.run(uid, cat("Side income"), 400 + Math.round(R.next() * 200), `${ym}-${dd(m === 0 ? Math.min(15, todayDom) : 15)}`, "Freelance design project");
      for (const [name, payee, amount, day, variance] of RECURRING) {
        if (m === 0 && day > todayDom) continue; // not due yet this month — it shows up under "upcoming"
        insTx.run(uid, cat(name), round(amount * (1 + (R.next() - 0.5) * 2 * variance), 2), `${ym}-${dd(day)}`, payee);
      }
      for (const [name, total, variance, count] of VARIABLE) {
        // The current month is only partly elapsed, so variable spend scales with progress.
        const progress = m === 0 ? Math.max(0.3, Math.min(1, todayDom / 28)) : 1;
        const monthTotal = total * progress * (1 + (R.next() - 0.5) * 2 * variance) * (m === 0 && name === "Dining out" ? 1.3 : 1);
        const pool = MERCHANTS[name];
        for (let k = 0; k < count; k++) {
          const maxDay = m === 0 ? Math.max(1, todayDom) : 27;
          insTx.run(uid, cat(name), round(monthTotal / count, 2), `${ym}-${dd(1 + Math.floor(R.next() * maxDay))}`, pool[Math.floor(R.next() * pool.length)]);
        }
      }
    }
    run("INSERT INTO savings_goals(user_id,name,target,current,deadline) VALUES(?,?,?,?,?)", uid, "Emergency fund (6 months)", 25800, 18500, null);
    run("INSERT INTO savings_goals(user_id,name,target,current,deadline) VALUES(?,?,?,?,?)", uid, "Japan trip", 5000, 1850, monthStr(-9) + "-01");
    const y = (n: number) => `${new Date().getFullYear() + n}-06-01`;
    run("INSERT INTO milestones(user_id,type,name,target_amount,current_savings,monthly_contribution,target_date,expected_return) VALUES(?,?,?,?,?,?,?,?)", uid, "home", "Home down payment", 90000, 21000, 850, y(5), 0.055);
    run("INSERT INTO milestones(user_id,type,name,target_amount,current_savings,monthly_contribution,target_date,expected_return) VALUES(?,?,?,?,?,?,?,?)", uid, "education", "College fund", 60000, 4500, 250, y(14), 0.065);
    run("INSERT INTO holdings(user_id,kind,symbol,units,avg_cost) VALUES(?,?,?,?,?)", uid, "fund", "MRIDX", 220, 41.2);
    run("INSERT INTO holdings(user_id,kind,symbol,units,avg_cost) VALUES(?,?,?,?,?)", uid, "fund", "MRBDX", 300, 14.5);
    run("INSERT INTO holdings(user_id,kind,symbol,units,avg_cost) VALUES(?,?,?,?,?)", uid, "stock", "QNTR", 6, 305);
    run("INSERT INTO holdings(user_id,kind,symbol,units,avg_cost) VALUES(?,?,?,?,?)", uid, "stock", "VLTG", 25, 66);
    for (const [k, s] of [["fund", "NWGRX"], ["fund", "VRDVX"], ["stock", "AXSM"], ["stock", "HLXA"]] as const)
      run("INSERT INTO watchlist(user_id,kind,symbol) VALUES(?,?,?)", uid, k, s);

    // A year of weekly net-worth history leading up to today's real figure, so the chart has a story to tell.
    const now = computeNetWorth(uid);
    const R2 = rng(7);
    const insSnap = db.prepare("INSERT OR REPLACE INTO net_worth_snapshots(user_id,date,cash,invested,goals,debt,total) VALUES(?,?,?,?,?,?,?)");
    for (let d = 364; d >= 7; d -= 7) {
      const t = 1 - d / 365;
      const day = new Date();
      day.setDate(day.getDate() - d);
      // ~45% growth over the year: believable for someone saving this much, and the debt shrinks as they pay it down
      const cash = now.cash * (0.78 + 0.22 * t);
      const invested = now.invested * (0.78 + 0.22 * t) * (1 + (R2.next() - 0.5) * 0.06);
      const goals = now.goals * (0.8 + 0.2 * t);
      const debt = now.debt * (1.25 - 0.25 * t);
      insSnap.run(uid, day.toISOString().slice(0, 10), round(cash), round(invested), round(goals), round(debt), round(cash + invested + goals - debt));
    }
    recordSnapshot(uid);
  });
  return true;
}

export function seedAll(reset = false) {
  if (reset) {
    for (const t of ["tool_calls", "messages", "conversations", "recommendation_feedback", "user_prefs", "net_worth_snapshots", "holdings", "watchlist", "wills", "milestones", "savings_goals", "transactions", "categories", "profiles", "users", "settings"])
      run(`DELETE FROM ${t}`);
  }
  const m = seedMarket(reset);
  const d = seedDemoData(reset);
  if (reset) setSetting("announcement", "Welcome to Finvara — all market data shown is simulated.");
  return { market: m, demo: d };
}

// CLI: `npm run seed` → resets everything
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!) && process.argv.includes("--reset")) {
  const r = seedAll(true);
  console.log("Seeded:", r, "| funds:", all("SELECT COUNT(*) n FROM funds")[0].n, "stocks:", all("SELECT COUNT(*) n FROM stocks")[0].n);
  console.log("Demo user:  demo@finvara.app / Demo1234!");
  console.log("Admin user: admin@finvara.app / Admin123!");
}
