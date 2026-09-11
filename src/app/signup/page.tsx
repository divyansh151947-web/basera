"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ companyName: "", name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/signup", { method: "POST", body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }
    const signinRes = await signIn("credentials", { email: form.email, password: form.password, redirect: false });
    setLoading(false);
    if (signinRes?.error) {
      router.push("/login");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-2xl text-brand">Basera</Link>
        <h1 className="mt-6 text-xl font-semibold text-ink">Start your 14-day trial</h1>
        <p className="text-sm text-slate2 mt-1">No credit card required.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-ink">Company name</label>
            <input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 bg-panel focus:outline-none focus:ring-2 focus:ring-brand" placeholder="UrbanNest Realty" />
          </div>
          <div>
            <label className="text-sm font-medium text-ink">Your name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 bg-panel focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="text-sm font-medium text-ink">Work email</label>
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 bg-panel focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="text-sm font-medium text-ink">Password</label>
            <input required minLength={8} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 bg-panel focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          {error && <p className="text-sm text-hot">{error}</p>}
          <button disabled={loading} type="submit"
            className="w-full rounded-md bg-brand text-white py-2 font-medium hover:opacity-90 disabled:opacity-60">
            {loading ? "Creating your workspace…" : "Create workspace"}
          </button>
        </form>
        <p className="mt-6 text-sm text-slate2">
          Already have an account? <Link href="/login" className="text-brand font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
