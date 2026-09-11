"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-2xl text-brand">Basera</Link>
        <h1 className="mt-6 text-xl font-semibold text-ink">Sign in to your workspace</h1>
        <p className="text-sm text-slate2 mt-1">Enter your work email and password.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-ink">Email</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 bg-panel focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="text-sm font-medium text-ink">Password</label>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 bg-panel focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          {error && <p className="text-sm text-hot">{error}</p>}
          <button disabled={loading} type="submit"
            className="w-full rounded-md bg-brand text-white py-2 font-medium hover:opacity-90 disabled:opacity-60">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-slate2">
          New to Basera? <Link href="/signup" className="text-brand font-medium">Start your 14-day trial</Link>
        </p>
        <div className="mt-8 rounded-lg border border-line bg-panel p-4 text-xs text-slate2">
          <p className="font-medium text-ink mb-1">Demo credentials</p>
          <p>admin@urbannest.demo / demo1234</p>
        </div>
      </div>
    </div>
  );
}
