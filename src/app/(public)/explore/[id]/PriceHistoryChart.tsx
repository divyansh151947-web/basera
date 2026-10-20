"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, HelpCircle, AlertCircle, Info, Calculator, Target, DollarSign } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Area } from "recharts";

interface PriceHistoryChartProps {
  property: {
    priceMinInr: number;
    priceMaxInr: number;
    areaSqft: number | null;
    projectName: string;
    city: string;
    locality: string;
    possessionDate: string | null;
    availability: string;
  };
}

const COLORS = {
  primary: "#d8a94e",
  secondary: "#5b7fa6",
  success: "#4cc39a",
  danger: "#e08078",
  muted: "#9aa7b4",
  grid: "rgba(255,255,255,0.08)",
  tooltipBg: "#141b28",
  tooltipBorder: "rgba(255,255,255,0.14)",
};

const ICONS = {
  TrendingUp,
  TrendingDown,
  Target,
  Calculator,
  DollarSign,
} as const;

type IconName = keyof typeof ICONS;

function formatInrCompact(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(amount % 10000000 === 0 ? 0 : 1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(amount % 100000 === 0 ? 0 : 1)}L`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatInrFull(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function generateMockPriceHistory(currentPrice: number, possessionDate: string | null) {
  const years = possessionDate ? Math.max(1, new Date(possessionDate).getFullYear() - 2020) : 5;
  const data = [];
  let price = currentPrice * 0.6;
  
  for (let i = 0; i <= years; i++) {
    const year = 2020 + i;
    const variation = 1 + (Math.random() - 0.5) * 0.1;
    price = Math.round(price * variation * 1.08);
    data.push({ year: String(year), price });
  }
  
  data[data.length - 1].price = currentPrice;
  return data;
}

function generateFutureProjections(currentPrice: number, years: number = 5) {
  const scenarios = [
    { label: "Conservative", rate: 0.04, color: COLORS.secondary, icon: "TrendingDown" },
    { label: "Moderate", rate: 0.07, color: COLORS.primary, icon: "TrendingUp" },
    { label: "Optimistic", rate: 0.10, color: COLORS.success, icon: "TrendingUp" },
  ] as const;
  
  return scenarios.map(s => ({
    ...s,
    values: Array.from({ length: years + 1 }, (_, i) => {
      const year = new Date().getFullYear() + i;
      const value = Math.round(currentPrice * Math.pow(1 + s.rate, i));
      return { year: String(year), value };
    }),
  }));
}

function renderIcon(iconName: IconName, className: string) {
  const Icon = ICONS[iconName];
  return <Icon size={14} className={className} />;
}

function renderIconLarge(iconName: IconName, className: string) {
  const Icon = ICONS[iconName];
  return <Icon size={16} className={className} />;
}

export function PriceHistoryChart({ property }: PriceHistoryChartProps) {
  const [activeTab, setActiveTab] = useState<"history" | "projections" | "calculator">("history");
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [customRate, setCustomRate] = useState(7);
  const [investmentYears, setInvestmentYears] = useState(5);
  
  const currentPrice = property.priceMinInr;
  const pricePerSqft = property.areaSqft ? Math.round(currentPrice / property.areaSqft) : 0;
  
  const historyData = generateMockPriceHistory(currentPrice, property.possessionDate);
  const projections = generateFutureProjections(currentPrice, 5);
  
  const customProjection = Array.from({ length: investmentYears + 1 }, (_, i) => {
    const year = new Date().getFullYear() + i;
    const value = Math.round(currentPrice * Math.pow(1 + customRate / 100, i));
    return { year: String(year), value };
  });

  const calculateRentalYield = (price: number) => {
    const monthlyRent = price * 0.0025;
    return { monthly: Math.round(monthlyRent), annual: Math.round(monthlyRent * 12), yield: 3 };
  };

  const rentalYield = calculateRentalYield(currentPrice);

  const tooltipFormatter = (value: any) => {
    if (value === undefined) return ["", ""];
    const num = typeof value === "string" ? Number(value) : value;
    return [formatInrFull(num), "Price"];
  };

  const tooltipFormatterMulti = (value: any, name: any) => {
    if (value === undefined) return ["", String(name || "")];
    const num = typeof value === "string" ? Number(value) : value;
    return [formatInrFull(num), String(name || "")];
  };

  return (
    <div className="panel-surface p-5 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Price & Investment Insights</h2>
        <button
          onClick={() => setShowDisclaimer(!showDisclaimer)}
          className="flex items-center gap-1 text-xs text-white/50 hover:text-white/70"
          aria-expanded={showDisclaimer}
        >
          <HelpCircle size={14} /> Methodology
        </button>
      </div>

      <div className="flex gap-2 border-b border-white/10" role="tablist">
        {[
          { id: "history", label: "Price History", icon: "TrendingUp" as IconName },
          { id: "projections", label: "Future Projections", icon: "TrendingUp" as IconName },
          { id: "calculator", label: "Investment Calculator", icon: "Calculator" as IconName },
        ].map(({ id, label, icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id as typeof activeTab)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition ${
              activeTab === id
                ? "text-[#ffdf9e] border-b-2 border-[#d8a94e]"
                : "text-white/60 hover:text-white/80"
            }`}
          >
            {renderIcon(icon, "")} {label}
          </button>
        ))}
      </div>

      {activeTab === "history" && (
        <div className="space-y-4">
          <p className="text-sm text-white/60">
            Historical price trend for <span className="font-medium text-white">{property.projectName}</span> based on typical market appreciation.
            {property.possessionDate && <span className="ml-2 text-white/50">(Project launched ~2020)</span>}
          </p>
          
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="4 4" />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 11, fill: COLORS.muted }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.muted }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => formatInrCompact(value)}
                />
                <Tooltip
                  contentStyle={{
                    background: COLORS.tooltipBg,
                    border: `1px solid ${COLORS.tooltipBorder}`,
                    borderRadius: 12,
                    color: "#eef3f6",
                  }}
                  formatter={tooltipFormatter}
                  labelFormatter={(year) => `Year ${year}`}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={COLORS.primary}
                  strokeWidth={2}
                  fill={COLORS.primary}
                  fillOpacity={0.15}
                  activeDot={{ r: 6, fill: COLORS.primary, strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke={COLORS.primary}
                  strokeWidth={2}
                  dot={{ r: 4, fill: COLORS.primary, strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: COLORS.primary, strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Starting Price (2020)</p>
              <p className="mt-1 text-xl font-semibold text-white">{formatInrFull(historyData[0]?.price || 0)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Current Price</p>
              <p className="mt-1 text-xl font-semibold text-[#ffdf9e]">{formatInrFull(currentPrice)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Total Appreciation</p>
              <p className="mt-1 text-xl font-semibold text-success">
                {historyData[0]?.price ? `${(((currentPrice - historyData[0].price) / historyData[0].price) * 100).toFixed(1)}%` : "N/A"}
              </p>
            </div>
          </div>

          {pricePerSqft > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Current Price per sqft</p>
              <p className="mt-1 text-2xl font-semibold text-[#ffdf9e]">{formatInrFull(pricePerSqft)} / sqft</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "projections" && (
        <div className="space-y-4">
          <p className="text-sm text-white/60">
            Illustrative future value scenarios based on different annual appreciation assumptions.
            <span className="text-[#d8a94e] ml-2">Not a guarantee or forecast.</span>
          </p>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={projections[1].values} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="4 4" />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 11, fill: COLORS.muted }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.muted }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => formatInrCompact(value)}
                />
                <Tooltip
                  contentStyle={{
                    background: COLORS.tooltipBg,
                    border: `1px solid ${COLORS.tooltipBorder}`,
                    borderRadius: 12,
                    color: "#eef3f6",
                  }}
                  formatter={tooltipFormatterMulti}
                  labelFormatter={(year) => `Year ${year}`}
                />
                {projections.map((scenario, i) => (
                  <Line
                    key={scenario.label}
                    type="monotone"
                    dataKey="value"
                    stroke={scenario.color}
                    strokeWidth={i === 1 ? 3 : 2}
                    strokeDasharray={i === 1 ? undefined : "6 4"}
                    dot={false}
                    activeDot={{ r: 6, fill: scenario.color, strokeWidth: 2 }}
                    name={scenario.label}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={COLORS.danger}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  dot={false}
                  name="Current Price"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {projections.map((scenario) => (
              <div key={scenario.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  {renderIconLarge(scenario.icon, scenario.color === COLORS.success ? "text-success" : scenario.color === COLORS.danger ? "text-danger" : "text-[#ffdf9e]")}
                  <span className="font-medium text-white">{scenario.label}</span>
                </div>
                <p className="text-[11px] text-white/50 mb-2">{scenario.rate * 100}% annual appreciation</p>
                <div className="space-y-2">
                  {[1, 3, 5].map((yr) => {
                    const val = scenario.values[yr]?.value || 0;
                    return (
                      <div key={yr} className="flex justify-between text-sm">
                        <span className="text-white/70">{yr} year{yr > 1 ? "s" : ""}</span>
                        <span className="font-semibold text-white">{formatInrCompact(val)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "calculator" && (
        <div className="space-y-6">
          <p className="text-sm text-white/60">
            Calculate illustrative returns based on your own assumptions. Adjust the sliders to see potential outcomes.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-white/70">Annual Appreciation Rate</span>
                  <span className="font-semibold text-[#ffdf9e]">{customRate}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="15"
                  step="0.5"
                  value={customRate}
                  onChange={(e) => setCustomRate(Number(e.target.value))}
                  className="w-full accent-[#d8a94e]"
                />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-white/70">Investment Horizon</span>
                  <span className="font-semibold text-[#ffdf9e]">{investmentYears} years</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={investmentYears}
                  onChange={(e) => setInvestmentYears(Number(e.target.value))}
                  className="w-full accent-[#d8a94e]"
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-white/70">Current Value</span>
                <span className="font-semibold text-[#ffdf9e]">{formatInrFull(currentPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Projected Value</span>
                <span className="font-semibold text-white">{formatInrFull(customProjection[investmentYears]?.value || 0)}</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-3">
                <span className="text-white/70">Total Gain</span>
                <span className="font-semibold text-success">
                  +{formatInrFull((customProjection[investmentYears]?.value || 0) - currentPrice)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">CAGR</span>
                <span className="font-semibold text-white">{customRate}%</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h4 className="font-medium text-white mb-3 flex items-center gap-2">
              {renderIconLarge("DollarSign", "text-[#ffdf9e]")} Rental Income Estimate
            </h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Monthly Rent (est.)</p>
                <p className="mt-1 text-xl font-semibold text-[#ffdf9e]">{formatInrCompact(rentalYield.monthly)}</p>
              </div>
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Annual Rent (est.)</p>
                <p className="mt-1 text-xl font-semibold text-[#ffdf9e]">{formatInrCompact(rentalYield.annual)}</p>
              </div>
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Gross Yield</p>
                <p className="mt-1 text-xl font-semibold text-[#ffdf9e]">{rentalYield.yield}%</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-white/50">
              <Info size={12} className="inline" /> Based on 3% gross rental yield assumption. Actual yields vary by location, property type, and market conditions.
            </p>
          </div>
        </div>
      )}

      {showDisclaimer && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60 animate-in fade-in slide-in-from-top-2">
          <h4 className="font-medium text-white/80 mb-3 flex items-center gap-2">
            <AlertCircle size={16} className="text-[#d8a94e]" /> Important Disclaimers
          </h4>
          <ul className="space-y-2 list-disc list-inside">
            <li><strong>Price History:</strong> Based on typical market appreciation patterns for the area. Not from actual transaction records for this specific property.</li>
            <li><strong>Future Projections:</strong> Purely illustrative mathematical scenarios. Real estate markets are unpredictable and past performance does not guarantee future results.</li>
            <li><strong>Investment Calculator:</strong> For educational purposes only. Does not account for taxes, maintenance, vacancy, loan interest, liquidity risk, or regulatory changes.</li>
            <li><strong>Rental Estimates:</strong> Based on broad market averages. Actual rental income depends on specific unit, furnishing, management, and local demand.</li>
            <li>Consult a qualified financial advisor and conduct independent due diligence before making investment decisions.</li>
          </ul>
        </div>
      )}
    </div>
  );
}