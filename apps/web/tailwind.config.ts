import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#15171a",
        panel: "#f4f1eb",
        line: "#d8d4ca",
        accent: "#247b6d",
        warn: "#a45a24"
      }
    }
  },
  plugins: []
};

export default config;
