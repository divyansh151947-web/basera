"use client";

import { AlertCircle } from "lucide-react";

export function DisclaimerSection() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <AlertCircle size={20} className="text-[#d8a94e]" /> Important Disclaimers
      </h3>
      <ul className="space-y-2 list-disc list-inside text-sm text-white/70">
        <li>All calculations are estimates based on user-provided assumptions. Actual returns may vary significantly.</li>
        <li>Property appreciation rates are not guaranteed and depend on market conditions, location, and economic factors.</li>
        <li>Rental income is not guaranteed and may be affected by vacancy, tenant quality, and market conditions.</li>
        <li>Tax implications, maintenance costs, insurance, and other expenses are not fully accounted for in these calculations.</li>
        <li>This tool is for educational purposes only and does not constitute financial advice. Consult a qualified financial advisor before making investment decisions.</li>
        <li>Past performance does not guarantee future results. Real estate investments carry inherent risks including loss of principal.</li>
      </ul>
    </div>
  );
}