import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      borderRadius: {
        '2xl': 'calc(var(--radius) + 6px)',
        xl: 'calc(var(--radius) + 3px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          raised: 'hsl(var(--surface-raised))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          muted: 'hsl(var(--primary-muted))',
        },
        gold: {
          DEFAULT: 'hsl(var(--gold))',
          foreground: 'hsl(var(--gold-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        border: {
          DEFAULT: 'hsl(var(--border))',
          strong: 'hsl(var(--border-strong))',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
          '6': 'hsl(var(--chart-6))',
        },
      },
      boxShadow: {
        subtle: 'var(--shadow-sm)',
        elevate: 'var(--shadow-md)',
        float: 'var(--shadow-lg)',
        'ring-primary': 'var(--shadow-glow)',
        // 1px inner top highlight — the detail that reads as "crafted"
        inset: 'inset 0 1px 0 0 hsl(0 0% 100% / 0.05)',
      },
      letterSpacing: {
        eyebrow: '0.16em',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'in-up': 'in-up 0.34s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.8s infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
};

export default config;
