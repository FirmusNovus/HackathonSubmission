import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#0a1428',
          900: '#0a1f44',
          800: '#102a4c',
          700: '#1a3666',
        },
        slate: {
          900: '#1a2533',
          700: '#2c3e50',
          500: '#5b6b7c',
          300: '#a8b3bf',
          200: '#cfd6dd',
          100: '#e5e9ee',
          50: '#eef1f4',
        },
        white: {
          50: '#f4f6f8',
          0: '#ffffff',
        },
        teal: {
          50: '#e6faf7',
          100: '#ccf5ef',
          300: '#5ee0cd',
          400: '#00d4c4',
          500: '#14b8a6',
          600: '#0e9488',
          700: '#0b7a70',
        },
        gold: {
          100: '#f5efd9',
          300: '#e0cd93',
          500: '#c9a961',
          700: '#9c7e3f',
        },
        green: {
          400: '#34d399',
          50: '#e8f8f1',
        },
        amber: {
          500: '#f59e0b',
          50: '#fef4e1',
        },
        red: {
          500: '#ef4444',
          50: '#fce9e9',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['var(--font-fraunces)', 'Fraunces', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        pill: '999px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(10, 31, 68, 0.04), 0 1px 3px rgba(10, 31, 68, 0.06)',
        md: '0 4px 8px rgba(10, 31, 68, 0.06), 0 8px 24px rgba(10, 31, 68, 0.08)',
        lg: '0 12px 24px rgba(10, 31, 68, 0.08), 0 24px 48px rgba(10, 31, 68, 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
