import type { Config } from 'tailwindcss';

/**
 * Two colour groups, matching the two token groups in globals.css.
 *
 * The DESIGN TOKENS resolve straight to their hex custom property. They do not
 * support Tailwind's opacity modifier syntax (`bg-live/10` will not work) —
 * that is deliberate. Alpha over an unknown backdrop is unpredictable, so the
 * palette ships precomputed `*-tint` values for chip and lane backgrounds and
 * `*-ink` values for signal-coloured text, each contrast-checked against the
 * surface it is designed to sit on.
 *
 * The SHADCN ALIASES stay in `hsl(var(--x))` form so existing pages and the
 * unmodified primitives in src/components/ui keep working unchanged during the
 * conversion. Do not reach for them in new code.
 */
const config: Config = {
  // Retained so <html class="dark"> keeps working until prompt 3 removes it.
  // New dark scoping is [data-theme='dark'], applied per subtree.
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Bricolage Grotesque — page titles and hero numbers only.
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Inter — body, labels, buttons, navigation.
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // IBM Plex Mono, tabular — every number in the product.
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        hero: ['34px', { lineHeight: '1.05', fontWeight: '500', letterSpacing: '-0.015em' }],
        title: ['20px', { lineHeight: '1.2', fontWeight: '500', letterSpacing: '-0.01em' }],
        section: ['15px', { lineHeight: '1.3', fontWeight: '500' }],
        body: ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        label: ['12px', { lineHeight: '1.3', fontWeight: '500', letterSpacing: '0.06em' }],
        meta: ['12px', { lineHeight: '1.4', fontWeight: '400' }],
        figure: ['19px', { lineHeight: '1', fontWeight: '500' }],
        data: ['13px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      borderRadius: {
        // shadcn's scale, driven by --radius (6px): lg 6px, md 4px, sm 2px.
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // Explicit names so intent is readable at the call site.
        card: 'var(--radius-card)',
        control: 'var(--radius-control)',
      },
      height: {
        row: 'var(--row-height)',
      },
      minHeight: {
        row: 'var(--row-height)',
      },
      colors: {
        /* ---------------- design tokens — use these ---------------- */
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        sunken: 'var(--sunken)',

        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
        },

        rule: {
          DEFAULT: 'var(--rule)',
          strong: 'var(--rule-strong)',
        },

        live: {
          DEFAULT: 'var(--live)',
          tint: 'var(--live-tint)',
          ink: 'var(--live-ink)',
          deep: 'var(--live-deep)',
        },
        ringing: {
          DEFAULT: 'var(--ringing)',
          tint: 'var(--ringing-tint)',
          ink: 'var(--ringing-ink)',
        },
        dropped: {
          DEFAULT: 'var(--dropped)',
          tint: 'var(--dropped-tint)',
          ink: 'var(--dropped-ink)',
        },
        blocked: {
          DEFAULT: 'var(--blocked)',
          tint: 'var(--blocked-tint)',
          ink: 'var(--blocked-ink)',
        },
        money: {
          DEFAULT: 'var(--money)',
          tint: 'var(--money-tint)',
          ink: 'var(--money-ink)',
        },

        /* ------------- shadcn aliases — compatibility only ------------- */
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
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
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      keyframes: {
        // The only motion in the system: a value that just changed takes the
        // live colour and settles back. Used by LiveStrip in prompt 3.
        settle: {
          '0%': { color: 'var(--live)' },
          '100%': { color: 'inherit' },
        },
        // Leading edge of an in-progress DurationBar.
        'edge-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        settle: 'settle 600ms ease-out',
        'edge-pulse': 'edge-pulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
};

export default config;
