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
        obsidian: "#0f1214",
        porcelain: "#f7f8f5",
        panel: "#eef2ee",
        line: "#d8d4ca",
        accent: "#128277",
        warn: "#a45a24"
      }
    }
  },
  plugins: []
};

export default config;
