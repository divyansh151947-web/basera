"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, CartesianGrid } from "recharts";

const COLORS = ["#0f5132", "#b8860b", "#b23a2f", "#5b7fa6", "#8a8f6c", "#6b4e71"];

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
        <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12, fill: "#5b6560" }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "#f7f5f0" }} />
        <Bar dataKey="count" fill="#0f5132" radius={[0, 4, 4, 0]} barSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({ data }: { data: { date: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid vertical={false} stroke="#e4e1d8" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5b6560" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#5b6560" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip />
        <Line type="monotone" dataKey="count" stroke="#0f5132" strokeWidth={2} dot={false} />
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
        <Tooltip />
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
        <Tooltip />
        <Bar dataKey="HOT" stackId="a" fill="#b23a2f" />
        <Bar dataKey="WARM" stackId="a" fill="#b8860b" />
        <Bar dataKey="COLD" stackId="a" fill="#5b7fa6" />
      </BarChart>
    </ResponsiveContainer>
  );
}
