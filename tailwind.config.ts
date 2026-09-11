import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        paper: "var(--paper)",
        panel: "var(--panel)",
        line: "var(--line)",
        brand: { DEFAULT: "var(--brand)", light: "var(--brand-light)" },
        gold: { DEFAULT: "var(--gold)", light: "var(--gold-light)" },
        slate2: "var(--slate)",
        hot: "var(--hot)",
        warm: "var(--warm)",
        cold: "var(--cold)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
export default config;
