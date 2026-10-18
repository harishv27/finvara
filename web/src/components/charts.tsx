import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { moneyCompact } from "../lib/format";

export const PALETTE = ["#0f766e", "#4f46e5", "#d97706", "#db2777", "#0284c7", "#65a30d", "#7c3aed", "#e11d48", "#0891b2", "#a16207"];

const axis = { stroke: "var(--c-line)", tick: { fill: "var(--c-muted)", fontSize: 11 }, tickLine: false } as const;
const tip = {
  contentStyle: { background: "var(--c-surface)", border: "1px solid var(--c-line)", borderRadius: 12, fontSize: 12, color: "var(--c-text)", boxShadow: "0 8px 24px rgba(0,0,0,.12)" },
  labelStyle: { color: "var(--c-muted)", marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { stroke: "var(--c-line)" },
} as const;

export interface Series { key: string; label: string; color?: string; dashed?: boolean }

export function TrendArea({ data, xKey, series, height = 240, fmt = moneyCompact, tipFmt, stacked, xFmt, zoom }: { data: any[]; xKey: string; series: Series[]; height?: number; fmt?: (n: number) => string; tipFmt?: (n: number) => string; stacked?: boolean; xFmt?: (v: any) => string; /** fit the Y axis to the data instead of starting at zero */ zoom?: boolean }) {
  const uid = useId().replace(/\W/g, "");
  const gid = (k: string) => `g-${uid}-${k.replace(/\W/g, "_")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={gid(s.key)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? PALETTE[i]} stopOpacity={0.28} /><stop offset="100%" stopColor={s.color ?? PALETTE[i]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--c-line)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} {...axis} tickFormatter={xFmt} minTickGap={32} />
        <YAxis {...axis} width={52} tickFormatter={fmt} axisLine={false} domain={zoom ? [(min: number) => Math.floor(min * 0.96), (max: number) => Math.ceil(max * 1.03)] : undefined} />
        <Tooltip {...tip} formatter={(v: any, n: any) => [(tipFmt ?? fmt)(Number(v)), n]} labelFormatter={xFmt as any} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--c-muted)" }} />}
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i]} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined}
            fill={s.dashed ? "none" : `url(#${gid(s.key)})`} stackId={stacked ? "a" : undefined} dot={false} activeDot={{ r: 4 }} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MultiLine({ data, xKey, series, height = 260, fmt = (n: number) => `${n}`, xFmt, domain }: { data: any[]; xKey: string; series: Series[]; height?: number; fmt?: (n: number) => string; xFmt?: (v: any) => string; domain?: [any, any] }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--c-line)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} {...axis} tickFormatter={xFmt} minTickGap={40} />
        <YAxis {...axis} width={48} tickFormatter={fmt} axisLine={false} domain={domain ?? ["auto", "auto"]} />
        <Tooltip {...tip} formatter={(v: any, n: any) => [fmt(Number(v)), n]} labelFormatter={xFmt as any} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--c-muted)" }} />
        {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i]} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={false} activeDot={{ r: 4 }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, xKey, series, height = 240, fmt = moneyCompact, xFmt, stacked }: { data: any[]; xKey: string; series: Series[]; height?: number; fmt?: (n: number) => string; xFmt?: (v: any) => string; stacked?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
        <CartesianGrid vertical={false} stroke="var(--c-line)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} {...axis} tickFormatter={xFmt} />
        <YAxis {...axis} width={52} tickFormatter={fmt} axisLine={false} allowDecimals={false} />
        <Tooltip {...tip} cursor={{ fill: "var(--c-surface2)" }} formatter={(v: any, n: any) => [fmt(Number(v)), n]} labelFormatter={xFmt as any} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--c-muted)" }} />}
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? PALETTE[i]} radius={stacked ? 0 : [5, 5, 0, 0]} stackId={stacked ? "a" : undefined} maxBarSize={36} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 220, center, fmt = (n: number) => String(n) }: { data: { name: string; value: number; color?: string }[]; height?: number; center?: React.ReactNode; fmt?: (n: number) => string }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
            {data.map((d, i) => <Cell key={d.name} fill={d.color ?? PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip {...tip} formatter={(v: any, n: any) => [`${fmt(Number(v))} (${total ? Math.round((Number(v) / total) * 100) : 0}%)`, n]} />
        </PieChart>
      </ResponsiveContainer>
      {center && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
    </div>
  );
}

export function Legend2({ items }: { items: { name: string; color: string; value?: React.ReactNode }[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((i) => (
        <li key={i.name} className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: i.color }} /><span className="truncate">{i.name}</span></span>
          {i.value != null && <span className="tabular text-muted">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Spark({ data, color = "var(--c-brand)", height = 36 }: { data: number[]; color?: string; height?: number }) {
  const sid = `spark-${useId().replace(/\W/g, "")}`;
  const d = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={d} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs><linearGradient id={sid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.8} fill={`url(#${sid})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Monte Carlo fan: shaded 10th–90th percentile band, median line, and a marker at retirement. */
export function FanChart({ data, retireAge, height = 300, fmt = moneyCompact }: { data: { age: number; p10: number; p50: number; p90: number }[]; retireAge: number; height?: number; fmt?: (n: number) => string }) {
  const rows = data.map((d) => ({ ...d, band: [d.p10, d.p90] as [number, number] }));
  const names: Record<string, string> = { band: "Likely range (10th–90th)", p50: "Typical outcome", p90: "Good markets (90th)", p10: "Poor markets (10th)" };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--c-line)" strokeDasharray="3 3" />
        <XAxis dataKey="age" {...axis} tickFormatter={(v) => `${v}`} minTickGap={24} />
        <YAxis {...axis} width={52} tickFormatter={fmt} axisLine={false} />
        <Tooltip {...tip} labelFormatter={(a) => `Age ${a}`} formatter={(v: any, n: any) => [Array.isArray(v) ? `${fmt(v[0])} – ${fmt(v[1])}` : fmt(Number(v)), names[n] ?? n]} />
        <Area type="monotone" dataKey="band" name="band" stroke="none" fill="var(--c-brand)" fillOpacity={0.16} isAnimationActive={false} />
        <Line type="monotone" dataKey="p50" name="p50" stroke="var(--c-brand)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
        <ReferenceLine x={retireAge} stroke="var(--c-accent)" strokeDasharray="4 4" label={{ value: "Retire", position: "insideTopRight", fill: "var(--c-accent)", fontSize: 11 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Circular probability gauge (0–100). */
export function Gauge({ value, size = 132, color }: { value: number; size?: number; color: string }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${Math.round(value)} percent`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--c-surface2)" strokeWidth="11" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(Math.max(0, Math.min(100, value)) / 100) * c} ${c}`} transform="rotate(-90 60 60)" style={{ transition: "stroke-dasharray .6s ease" }} />
      <text x="60" y="58" textAnchor="middle" dominantBaseline="middle" fontSize="26" fontWeight="700" fill="var(--c-text)" className="tabular">{Math.round(value)}%</text>
      <text x="60" y="80" textAnchor="middle" fontSize="9" fill="var(--c-muted)">chance it lasts</text>
    </svg>
  );
}
