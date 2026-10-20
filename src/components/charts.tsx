"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, CartesianGrid } from "recharts";

const COLORS = ["#d8a94e", "#5b7fa6", "#4cc39a", "#8a8f6c", "#e08078", "#7ea6c9"];
const TICK = "#9aa7b4";
const GRID = "rgba(255,255,255,0.08)";
const TOOLTIP_STYLE = { borderRadius: 14, border: "1px solid rgba(255,255,255,0.14)", background: "#141b28", color: "#eef3f6" } as const;

export function FunnelChart({ data }: { data: { stage: string; count: number }[] }) {
  const labels: Record<string, string> = {
    NEW: "New", CONTACTED: "Contacted", QUALIFIED: "Qualified",
    SITE_VISIT_SCHEDULED: "Site Visit", NEGOTIATION: "Negotiation", CONVERTED: "Converted",
  };
  const formatted = data.map((d) => ({ ...d, label: labels[d.stage] ?? d.stage }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={formatted} layout="vertical" margin={{ left: 20 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12, fill: TICK }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "rgba(255,255,255,0.06)" }} contentStyle={{ ...TOOLTIP_STYLE }} />
        <Bar dataKey="count" fill="#d8a94e" radius={[0, 6, 6, 0]} barSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({ data }: { data: { date: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="4 4" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: TICK }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: TICK }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ ...TOOLTIP_STYLE }} />
        <Line type="monotone" dataKey="count" stroke="#d8a94e" strokeWidth={3} dot={{ r: 3, fill: "#d8a94e", strokeWidth: 0 }} activeDot={{ r: 5, fill: "#d8a94e" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SourcePie({ data }: { data: { source: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="source" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ ...TOOLTIP_STYLE }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TemperatureBar({ hot, warm, cold }: { hot: number; warm: number; cold: number }) {
  const data = [{ name: "Leads", HOT: hot, WARM: warm, COLD: cold }];
  return (
    <ResponsiveContainer width="100%" height={100}>
      <BarChart data={data} layout="vertical" stackOffset="expand">
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" hide />
        <Tooltip contentStyle={{ ...TOOLTIP_STYLE }} />
        <Bar dataKey="HOT" stackId="a" fill="#e08078" radius={[0, 4, 4, 0]} />
        <Bar dataKey="WARM" stackId="a" fill="#e0a44f" />
        <Bar dataKey="COLD" stackId="a" fill="#5b7fa6" radius={[4, 0, 0, 4]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
