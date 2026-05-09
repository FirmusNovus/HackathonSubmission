import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // shadcn semantic colors (driven by HSL CSS vars in globals.css)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Firmus palette — exposes utilities like bg-navy-900, text-teal-600.
        navy: {
          950: "#0a1428",
          900: "#0a1f44",
          800: "#102a4c",
          700: "#1a3666",
        },
        slate: {
          900: "#1a2533",
          700: "#2c3e50",
          500: "#5b6b7c",
          300: "#a8b3bf",
          200: "#cfd6dd",
          100: "#e5e9ee",
          50: "#eef1f4",
        },
        white: {
          50: "#f4f6f8",
          0: "#ffffff",
          DEFAULT: "#ffffff",
        },
        teal: {
          50: "#e6faf7",
          100: "#ccf5ef",
          300: "#5ee0cd",
          400: "#00d4c4",
          500: "#14b8a6",
          600: "#0e9488",
          700: "#0b7a70",
        },
        gold: {
          100: "#f5efd9",
          300: "#e0cd93",
          500: "#c9a961",
          700: "#9c7e3f",
        },
        green: {
          50: "#e8f8f1",
          400: "#34d399",
        },
        amber: {
          50: "#fef4e1",
          500: "#f59e0b",
        },
        red: {
          50: "#fce9e9",
          500: "#ef4444",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        pill: "999px",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        serif: ["var(--font-fraunces)", "Fraunces", "Georgia", "serif"],
        mono: ["ui-monospace", "JetBrains Mono", "SF Mono", "Menlo", "monospace"],
      },
      maxWidth: {
        prose: "65ch",
      },
      boxShadow: {
        firmus: "0 4px 8px rgba(10, 31, 68, 0.06), 0 8px 24px rgba(10, 31, 68, 0.08)",
        "firmus-lg":
          "0 12px 24px rgba(10, 31, 68, 0.08), 0 24px 48px rgba(10, 31, 68, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
