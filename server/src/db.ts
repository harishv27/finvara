import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age INTEGER,
  monthly_income REAL,
  monthly_expenses REAL,
  current_savings REAL,
  total_debt REAL DEFAULT 0,
  dependents INTEGER DEFAULT 0,
  retirement_age INTEGER DEFAULT 65,
  risk_score INTEGER,              -- 1..5 from questionnaire
  risk_profile TEXT,               -- conservative | moderate | aggressive
  goals TEXT DEFAULT '[]',         -- JSON array of strings
  onboarded INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  bucket TEXT NOT NULL DEFAULT 'need' CHECK (bucket IN ('need','want','savings')),
  planned REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#0f766e',
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  date TEXT NOT NULL,              -- YYYY-MM-DD
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);

CREATE TABLE IF NOT EXISTS savings_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target REAL NOT NULL,
  current REAL NOT NULL DEFAULT 0,
  deadline TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('home','retirement','education','custom')),
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  current_savings REAL NOT NULL DEFAULT 0,
  monthly_contribution REAL NOT NULL DEFAULT 0,
  target_date TEXT NOT NULL,
  expected_return REAL NOT NULL DEFAULT 0.06,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,              -- JSON (WillInput)
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated')),
  generated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS funds (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,          -- Large Cap Equity, Bond, ...
  fund_house TEXT NOT NULL,
  risk INTEGER NOT NULL,           -- 1..5
  expense_ratio REAL NOT NULL,     -- percent
  aum_bn REAL NOT NULL,
  min_investment REAL NOT NULL,
  nav REAL NOT NULL,
  return_1y REAL NOT NULL,
  return_3y REAL NOT NULL,
  return_5y REAL NOT NULL,
  volatility REAL NOT NULL,
  sharpe REAL NOT NULL,
  allocation TEXT NOT NULL,        -- JSON {sector: pct}
  description TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stocks (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  price REAL NOT NULL,
  prev_close REAL NOT NULL,
  market_cap_bn REAL NOT NULL,
  pe REAL NOT NULL,
  dividend_yield REAL NOT NULL,
  beta REAL NOT NULL,
  eps_growth REAL NOT NULL,
  week52_high REAL NOT NULL,
  week52_low REAL NOT NULL,
  volatility REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS price_history (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fund','stock')),
  symbol TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, symbol)
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fund','stock')),
  symbol TEXT NOT NULL,
  units REAL NOT NULL CHECK (units > 0),
  avg_cost REAL NOT NULL CHECK (avg_cost > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, kind, symbol)
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  mode TEXT DEFAULT 'live',        -- live | demo | error
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  tool TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  cash REAL NOT NULL,
  invested REAL NOT NULL,
  goals REAL NOT NULL,
  debt REAL NOT NULL,
  total REAL NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,            -- viewed | watchlisted | dismissed | invested
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
db.exec(SCHEMA);

// ---------- tiny query helpers ----------
type Param = string | number | null | bigint | Uint8Array;
export const all = <T = any>(sql: string, ...params: Param[]): T[] =>
  db.prepare(sql).all(...params) as T[];
export const get = <T = any>(sql: string, ...params: Param[]): T | undefined =>
  db.prepare(sql).get(...params) as T | undefined;
export const run = (sql: string, ...params: Param[]) => {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
};
export const tx = <T>(fn: () => T): T => {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};

// ---------- settings (admin-configurable, with typed defaults) ----------
export const SETTING_DEFAULTS = {
  registration_open: true,
  chatbot_enabled: true,
  chat_model: "",                   // empty → env default
  chat_max_tokens: 4096,
  chat_daily_limit: 60,             // user messages per day
  announcement: "",
  rec_weight_risk_fit: 0.4,
  rec_weight_return: 0.3,
  rec_weight_cost: 0.15,
  rec_weight_quality: 0.15,
  rec_min_match: 40,
  rec_top_n: 6,
};
export type SettingKey = keyof typeof SETTING_DEFAULTS;

export function getSetting<K extends SettingKey>(key: K): (typeof SETTING_DEFAULTS)[K] {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return SETTING_DEFAULTS[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return SETTING_DEFAULTS[key];
  }
}
export function setSetting(key: SettingKey, value: unknown) {
  run(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    key,
    JSON.stringify(value),
  );
}
export function allSettings() {
  return Object.fromEntries(
    (Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((k) => [k, getSetting(k)]),
  ) as { [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] };
}
