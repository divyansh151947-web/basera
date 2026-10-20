import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Start free",
  description:
    "Create a Basera workspace for your real-estate team: capture enquiries, qualify buyers with AI, match properties, and track follow-ups in one pipeline.",
  alternates: { canonical: "/signup" },
  robots: { index: true, follow: true },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
