export const usd = (n: number, dp = 0) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const pct = (n: number, dp = 1) => `${n.toFixed(dp)}%`;
export const pct0 = (n: number) => `${Math.round(n * 100)}%`;
export const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
export const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

/** Pull useful numbers out of free text for demo-mode routing. */
export function extractNumbers(message: string) {
  const out: Record<string, number> = {};
  const money = [...message.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/gi)].map((m) => {
    let v = Number(m[1].replace(/,/g, ""));
    const u = m[2]?.toLowerCase();
    if (u === "k" || u === "thousand") v *= 1_000;
    if (u === "m" || u === "million") v *= 1_000_000;
    return v;
  });
  if (money.length) out.firstAmount = money[0];
  if (money.length > 1) out.secondAmount = money[1];
  const years = message.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/i);
  if (years) out.years = Number(years[1]);
  const age = message.match(/\bage\s*(?:of\s*)?(\d{2})\b|\bI(?:'m| am)\s*(\d{2})\b/i);
  if (age) out.age = Number(age[1] ?? age[2]);
  const ret = message.match(/retire(?:ment)?\s*(?:at|by|age)?\s*(\d{2})\b/i);
  if (ret) out.retirementAge = Number(ret[1]);
  const rate = message.match(/(\d+(?:\.\d+)?)\s*%/);
  if (rate) out.pct = Number(rate[1]);
  return out;
}
