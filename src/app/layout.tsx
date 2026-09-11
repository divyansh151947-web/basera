import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/providers";

export const metadata: Metadata = {
  title: "Basera | AI Sales Operating System for Real Estate",
  description: "Turn more property enquiries into qualified buyers — AI-powered lead response, qualification and follow-up for Indian real-estate teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
