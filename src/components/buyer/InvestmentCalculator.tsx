"use client";

import { useState } from "react";
import { TrendingUp, Calculator, DollarSign, Percent, Home, CalendarClock, Info, AlertTriangle } from "lucide-react";
import { formatInr } from "@/lib/formatters";

interface InvestmentCalculatorProps {
  initialValues?: {
    purchasePrice?: number;
    expectedRent?: number;
    annualCosts?: number;
    appreciationRate?: number;
    investmentYears?: number;
    downPaymentPct?: number;
    interestRate?: number;
  };
}

export function InvestmentCalculator({ initialValues = {} }: InvestmentCalculatorProps) {
  const [purchasePrice, setPurchasePrice] = useState(initialValues.purchasePrice ?? 10000000);
  const [expectedRent, setExpectedRent] = useState(initialValues.expectedRent ?? 25000);
  const [annualCosts, setAnnualCosts] = useState(initialValues.annualCosts ?? 100000);
  const [appreciationRate, setAppreciationRate] = useState(initialValues.appreciationRate ?? 7);
  const [investmentYears, setInvestmentYears] = useState(initialValues.investmentYears ?? 5);
  const [downPaymentPct, setDownPaymentPct] = useState(initialValues.downPaymentPct ?? 20);
  const [interestRate, setInterestRate] = useState(initialValues.interestRate ?? 8.5);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const loanAmount = purchasePrice * (1 - downPaymentPct / 100);
  const loanTermYears = 20; // Fixed assumption
  const monthlyRate = interestRate / 12 / 100;
  const totalMonths = loanTermYears * 12;
  const monthlyEMI = loanAmount > 0 && monthlyRate > 0
    ? loanAmount * monthlyRate * Math.pow(1 + monthlyRate, totalMonths) / (Math.pow(1 + monthlyRate, totalMonths) - 1)
    : 0;
  const annualEMI = monthlyEMI * 12;
  
  const annualRent = expectedRent * 12;
  const netAnnualIncome = annualRent - annualCosts - annualEMI;
  const grossYield = purchasePrice > 0 ? (annualRent / purchasePrice) * 100 : 0;
  const netYield = purchasePrice > 0 ? (netAnnualIncome / purchasePrice) * 100 : 0;
  
  const futureValue = purchasePrice * Math.pow(1 + appreciationRate / 100, investmentYears);
  const totalAppreciation = futureValue - purchasePrice;
  const totalRentIncome = annualRent * investmentYears;
  const totalCosts = (annualCosts + annualEMI) * investmentYears;
  const netProfit = totalAppreciation + totalRentIncome - totalCosts;
  const investedCapital = purchasePrice * downPaymentPct / 100;
  const roi = investedCapital > 0 ? (netProfit / investedCapital) * 100 : 0;

  return (
    <div className="panel-surface p-5">
      {/* Header row: below ~430px the h2 min-content ("Investment" + icon
          ~122px) plus the button min-content ("Assumptions" + icon ~104px)
          exceed the ~176px panel content width (buyer rail + paddings at
          320px phones) and the button spilled past the viewport. flex-wrap
          drops the button to its own line there; from ~430px up the
          single-line justify-between layout is unchanged. */}
      <div className="flex flex-wrap items-center justify-between gap-y-1 mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Calculator size={20} className="text-[#d8a94e]" /> Investment Calculator
        </h2>
        <button
          type="button"
          onClick={() => setShowAssumptions(!showAssumptions)}
          className="text-sm text-white/50 hover:text-white/70 flex items-center gap-1"
        >
          <Info size={14} /> {showAssumptions ? "Hide" : "Show"} Assumptions
        </button>
      </div>

      {showAssumptions && (
        <div className="mb-6 p-4 rounded-xl border border-white/10 bg-white/5 text-sm text-white/70">
          <h4 className="font-medium text-white mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-yellow-400" /> Key Assumptions & Limitations
          </h4>
          <ul className="space-y-1 list-disc list-inside">
            <li>Loan term is fixed at <strong>20 years</strong>; actual terms may vary by lender.</li>
            <li>Interest rate is <strong>fixed</strong> for the entire term; floating rates will change.</li>
            <li>Rental income assumes <strong>100% occupancy</strong>; vacancy is not modeled.</li>
            <li>Maintenance costs are <strong>fixed annually</strong>; they typically increase with inflation.</li>
            <li>Appreciation rate is <strong>constant</strong>; real estate markets fluctuate.</li>
            <li>Tax implications, insurance, transaction costs, and stamp duty are <strong>not included</strong>.</li>
            <li>Past performance does not guarantee future results. Consult a financial advisor.</li>
          </ul>
        </div>
      )}

      <p className="text-sm text-white/50 mb-6">Enter your assumptions to calculate potential returns. All figures are estimates based on your inputs.</p>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <InputGroup label="Purchase Price (₹)" value={purchasePrice} onChange={setPurchasePrice} step={100000} min={100000} icon={<DollarSign size={18} />} />
        <InputGroup label="Expected Monthly Rent (₹)" value={expectedRent} onChange={setExpectedRent} step={1000} min={0} icon={<DollarSign size={18} />} />
        <InputGroup label="Annual Maintenance Costs (₹)" value={annualCosts} onChange={setAnnualCosts} step={10000} min={0} icon={<DollarSign size={18} />} />
        <InputGroup label="Expected Appreciation (%/yr)" value={appreciationRate} onChange={setAppreciationRate} step={0.5} min={0} max={20} icon={<TrendingUp size={18} />} suffix="%" />
        <InputGroup label="Investment Period (years)" value={investmentYears} onChange={setInvestmentYears} step={1} min={1} max={30} icon={<CalendarClock size={18} />} />
        <InputGroup label="Down Payment (%)" value={downPaymentPct} onChange={setDownPaymentPct} step={5} min={0} max={100} icon={<Percent size={18} />} suffix="%" />
        <InputGroup label="Home Loan Interest Rate (%/yr)" value={interestRate} onChange={setInterestRate} step={0.1} min={0} max={20} icon={<Percent size={18} />} suffix="%" />
        <InputGroup label="Loan Term (years)" value={20} onChange={() => {}} step={1} min={5} max={30} icon={<CalendarClock size={18} />} suffix="%" disabled />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ResultCard label="Gross Rental Yield" value={grossYield.toFixed(2) + "%"} icon={<TrendingUp size={20} />} color={grossYield > 4 ? "text-green-400" : grossYield > 2 ? "text-yellow-400" : "text-red-400"} />
        <ResultCard label="Net Rental Yield" value={netYield.toFixed(2) + "%"} icon={<TrendingUp size={20} />} color={netYield > 2 ? "text-green-400" : netYield > 0 ? "text-yellow-400" : "text-red-400"} />
        <ResultCard label="Estimated ROI" value={roi.toFixed(1) + "%"} icon={<DollarSign size={20} />} color={roi > 15 ? "text-green-400" : roi > 5 ? "text-yellow-400" : "text-red-400"} />
        <ResultCard label="Future Property Value" value={formatInr(futureValue)} icon={<Home size={20} />} color="text-[#d8a94e]" />
      </div>

      <div className="mt-6 p-4 rounded-xl border border-white/10 bg-white/5">
        <h3 className="font-medium text-white mb-3">Detailed Breakdown</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-white/60">Loan Amount</span><span className="text-white">{formatInr(loanAmount)}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Monthly EMI ({loanTermYears} yr fixed)</span><span className="text-white">{formatInr(Math.round(monthlyEMI))}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Annual Rental Income</span><span className="text-white">{formatInr(annualRent)}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Annual Costs (Maintenance)</span><span className="text-white">{formatInr(annualCosts)}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Annual EMI Total</span><span className="text-white">{formatInr(Math.round(annualEMI))}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Net Annual Cash Flow</span><span className={netAnnualIncome >= 0 ? "text-green-400" : "text-red-400"}>{formatInr(Math.round(netAnnualIncome))}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Total Rent Income ({investmentYears}yr)</span><span className="text-white">{formatInr(totalRentIncome)}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Total Loan Interest ({investmentYears}yr)</span><span className="text-white">{formatInr(Math.round(annualEMI * investmentYears - loanAmount * (investmentYears / 20)))}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Total Maintenance ({investmentYears}yr)</span><span className="text-white">{formatInr(totalCosts - annualEMI * investmentYears)}</span></div>
          <div className="flex justify-between border-t border-white/10 pt-2"><span className="text-white/60">Property Appreciation</span><span className="text-white">{formatInr(totalAppreciation)}</span></div>
          <div className="flex justify-between font-semibold"><span className="text-white">Net Profit</span><span className={netProfit >= 0 ? "text-green-400" : "text-red-400"}>{formatInr(Math.round(netProfit))}</span></div>
        </div>
      </div>

      <div className="mt-4 p-3 rounded-xl border border-white/10 bg-white/5 text-xs text-white/60">
        <p className="font-medium text-white/80 mb-1">Disclaimer</p>
        <p>All calculations are illustrative estimates based on user-provided assumptions. Actual returns depend on market conditions, property-specific factors, tax laws, and individual circumstances. This tool does not constitute financial advice. Please consult a qualified financial advisor before making investment decisions.</p>
      </div>
    </div>
  );
}

function InputGroup({ label, value, onChange, step, min, max, icon, suffix, disabled }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; icon: React.ReactNode; suffix?: string; disabled?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <label className="block text-xs font-medium text-white/60 mb-2">{label}</label>
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/55">{icon}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 pl-10 pr-8 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/55 text-xs">{suffix}</span>}
      </div>
    </div>
  );
}

function ResultCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={color}>{icon}</span>
        <span className="text-xs font-medium text-white/60">{label}</span>
      </div>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}