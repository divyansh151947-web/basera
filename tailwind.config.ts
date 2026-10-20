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
        "panel-soft": "var(--panel-soft)",
        field: "var(--field)",
        line: "var(--line)",
        brand: {
          DEFAULT: "var(--brand)",
          light: "var(--brand-light)",
          soft: "var(--brand-light)",
          strong: "var(--brand-strong)",
        },
        gold: {
          DEFAULT: "var(--gold)",
          light: "var(--gold-light)",
          bright: "var(--gold)",
          deep: "var(--gold)",
        },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--gold-light)" },
        slate2: "var(--slate)",
        hot: "var(--hot)",
        warm: "var(--warm)",
        cold: "var(--cold)",
      },
      shadowColor: {
        brand: "var(--brand)",
      },
      borderRadius: {
        card: "var(--radius-card)",
        control: "var(--radius-control)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        lift: "var(--shadow-card-hover)",
        float: "var(--shadow-float)",
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
