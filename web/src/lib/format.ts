const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export const money = (n: number | null | undefined, dp = 0) => (n == null || Number.isNaN(n) ? "—" : (dp ? usd2 : usd0).format(n));
export const moneyCompact = (n: number) => compact.format(n);
export const num = (n: number, dp = 0) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const pct = (n: number | null | undefined, dp = 1) => (n == null ? "—" : `${n.toFixed(dp)}%`);
export const signedPct = (n: number, dp = 2) => `${n > 0 ? "+" : ""}${n.toFixed(dp)}%`;
export const signedMoney = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;
export const tone = (n: number) => (n > 0 ? "text-pos" : n < 0 ? "text-neg" : "text-muted");

export const monthLabel = (ym: string) => new Date(ym + "-01T12:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" });
export const monthLong = (ym: string) => new Date(ym + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
export const dateShort = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d.replace(" ", "T") + "Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const dateLong = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d.replace(" ", "T") + "Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
export const dateTime = (d: string) => new Date(d.replace(" ", "T") + "Z").toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const today = () => new Date().toISOString().slice(0, 10);
export const thisMonth = () => today().slice(0, 7);
export const shiftMonth = (ym: string, by: number) => {
  const d = new Date(ym + "-01T12:00:00");
  d.setMonth(d.getMonth() + by);
  return d.toISOString().slice(0, 7);
};
export const timeAgo = (d: string | null) => {
  if (!d) return "never";
  const s = (Date.now() - new Date(d.replace(" ", "T") + "Z").getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
