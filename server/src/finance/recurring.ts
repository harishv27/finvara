import { round } from "./math.ts";

export interface TxLite { date: string; amount: number; note: string; category: string; categoryId: number; kind: "income" | "expense" }

export interface RecurringItem {
  name: string;
  category: string;
  amount: number;
  lastDate: string;
  nextDate: string;
  daysUntil: number;
  occurrences: number;
  varies: boolean;
  annualCost: number;
  kind: "income" | "expense";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const dayDiff = (a: string, b: string) => Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86400000);
const addMonth = (d: string) => {
  const x = new Date(d + "T12:00:00");
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + 1);
  x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return x.toISOString().slice(0, 10);
};

/**
 * Detect monthly recurring payments: same payee (note) + category seen in ≥3 distinct months with a roughly
 * monthly cadence and amounts that stay within 20% of the median. Pure function so it can be unit-tested.
 */
export function detectRecurring(txs: TxLite[], today = new Date().toISOString().slice(0, 10)): { items: RecurringItem[]; monthlyTotal: number; annualTotal: number; upcoming: RecurringItem[] } {
  const groups = new Map<string, TxLite[]>();
  for (const t of txs) {
    const key = `${t.kind}|${t.categoryId}|${norm(t.note || t.category)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const items: RecurringItem[] = [];
  for (const g of groups.values()) {
    const months = new Set(g.map((t) => t.date.slice(0, 7)));
    if (months.size < 3) continue;
    const sorted = [...g].sort((a, b) => a.date.localeCompare(b.date));
    // One charge per month is the signature of a subscription/bill; many per month is ordinary spending.
    if (g.length > months.size * 1.25) continue;
    const gaps = sorted.slice(1).map((t, i) => dayDiff(sorted[i].date, t.date));
    const gap = median(gaps);
    if (gap < 25 || gap > 36) continue;
    const amt = median(g.map((t) => t.amount));
    if (g.some((t) => Math.abs(t.amount - amt) / amt > 0.2)) continue;
    const last = sorted[sorted.length - 1];
    let next = addMonth(last.date);
    while (next < today) next = addMonth(next); // missed months roll forward
    const amounts = g.map((t) => t.amount);
    items.push({
      name: last.note || last.category, category: last.category, amount: round(amt, 2), lastDate: last.date, nextDate: next,
      daysUntil: dayDiff(today, next), occurrences: g.length,
      varies: Math.max(...amounts) - Math.min(...amounts) > 0.01 * amt, annualCost: round(amt * 12, 2), kind: last.kind,
    });
  }
  items.sort((a, b) => b.amount - a.amount);
  const exp = items.filter((i) => i.kind === "expense");
  const monthlyTotal = round(exp.reduce((a, i) => a + i.amount, 0), 2);
  return {
    items, monthlyTotal, annualTotal: round(monthlyTotal * 12, 2),
    upcoming: [...items].filter((i) => i.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil),
  };
}
