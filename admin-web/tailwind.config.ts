import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#021126",
        yellow: "#FCB900",
        soft: "#F4F6FA",
        ink: "#111827",
        muted: "#667085",
        line: "#E4E7EC"
      },
      boxShadow: {
        soft: "0 18px 45px rgba(2,17,38,.08)"
      }
    }
  },
  plugins: []
};

export default config;
