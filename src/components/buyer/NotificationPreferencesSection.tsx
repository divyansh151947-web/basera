"use client";

import { Bell } from "lucide-react";

export function NotificationPreferencesSection() {
  return (
    <div className="panel-surface p-5">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Bell size={20} className="text-[#d8a94e]" /> Notification Preferences
      </h2>
      <p className="text-sm text-white/50 mb-4">Choose how you would like to be notified about your property activity.</p>
      <div className="space-y-3">
        {[
          { label: "Email Notifications", desc: "Receive updates via email", enabled: true },
          { label: "Push Notifications", desc: "Get real-time alerts on your device", enabled: true },
          { label: "Visit Reminders", desc: "Reminders before scheduled visits", enabled: true },
          { label: "Price Alerts", desc: "Notifications for price changes on saved properties", enabled: false },
          { label: "Weekly Market Digest", desc: "Summary of market trends and new listings", enabled: false },
        ].map((item, index) => (
          <div key={index} className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                defaultChecked={item.enabled}
                className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#d8a94e] focus:ring-[#d8a94e]"
              />
              <div>
                <p className="font-medium text-white">{item.label}</p>
                <p className="text-sm text-white/50">{item.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}