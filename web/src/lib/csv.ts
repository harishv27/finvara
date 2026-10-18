/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF, BOM) plus bank-export normalisation. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface Mapping { date: number; amount: number; note: number; category: number; type: number }
export type DateOrder = "ymd" | "mdy" | "dmy";

const find = (headers: string[], re: RegExp) => headers.findIndex((h) => re.test(h.trim().toLowerCase()));

/** Guess which column is which from common bank headers. -1 means "not present". */
export function guessMapping(headers: string[]): Mapping {
  return {
    date: find(headers, /^(date|posted|transaction date|posting date)/),
    amount: find(headers, /^(amount|amt|value|transaction amount)$/),
    note: find(headers, /(description|memo|payee|merchant|name|note|details)/),
    category: find(headers, /^category/),
    type: find(headers, /^(type|transaction type|kind)$/),
  };
}

export function guessDateOrder(samples: string[]): DateOrder {
  if (samples.some((s) => /^\d{4}-\d{2}-\d{2}/.test(s.trim()))) return "ymd";
  for (const s of samples) { const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s.trim()); if (m && Number(m[1]) > 12) return "dmy"; if (m && Number(m[2]) > 12) return "mdy"; }
  return "mdy";
}

export function parseDate(s: string, order: DateOrder): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) { [y, m, d] = [+r[1], +r[2], +r[3]]; }
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t))) { const yy = +r[3] < 100 ? 2000 + +r[3] : +r[3]; [y, m, d] = order === "dmy" ? [yy, +r[2], +r[1]] : [yy, +r[1], +r[2]]; }
  else { const p = Date.parse(t); if (Number.isNaN(p)) return null; const x = new Date(p); [y, m, d] = [x.getFullYear(), x.getMonth() + 1, x.getDate()]; }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseAmount(s: string): number | null {
  let t = s.trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-") || t.endsWith("-");
  t = t.replace(/[()$€£,\s+-]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export interface ImportRow { date: string; amount: number; kind: "income" | "expense"; category: string; note: string }

export function normalise(rows: string[][], m: Mapping, opts: { order: DateOrder; negativeIsExpense: boolean }) {
  const good: ImportRow[] = [];
  const bad: { row: number; reason: string }[] = [];
  rows.forEach((r, i) => {
    const date = m.date >= 0 ? parseDate(r[m.date] ?? "", opts.order) : null;
    const raw = m.amount >= 0 ? parseAmount(r[m.amount] ?? "") : null;
    if (!date) return bad.push({ row: i + 2, reason: "Unreadable date" });
    if (raw == null || raw === 0) return bad.push({ row: i + 2, reason: "Missing or zero amount" });
    let kind: "income" | "expense";
    const typeText = m.type >= 0 ? (r[m.type] ?? "").toLowerCase() : "";
    if (typeText) kind = /income|credit|deposit|refund|salary|payroll/.test(typeText) ? "income" : "expense";
    else kind = (raw < 0) === opts.negativeIsExpense ? "expense" : "income";
    const cat = (m.category >= 0 ? (r[m.category] ?? "").trim() : "") || (kind === "income" ? "Other income" : "Imported");
    good.push({ date, amount: Math.abs(raw), kind, category: cat.slice(0, 40), note: ((m.note >= 0 ? r[m.note] : "") ?? "").trim().slice(0, 200) });
  });
  return { good, bad };
}
