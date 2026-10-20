import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Confirm your email address to activate your Basera workspace.",
  robots: { index: false, follow: false },
};

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
