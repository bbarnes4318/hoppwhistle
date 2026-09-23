import type { Config } from 'tailwindcss';

/**
 * The NetEnroll agency portal: a bright, calm workspace — cool grey canvas,
 * white cards on soft layered shadows, Inter with tabular figures, and the
 * NetEnroll green as the single accent. This supersedes the "paper and ink,
 * no shadows" direction of hoppwhistle-redesign.md for palette, type and
 * elevation; its signal semantics (live, ringing, dropped, blocked, money)
 * still stand and are untouched.
 *
 * Two colour groups, matching the two token groups in globals.css.
 *
 * The DESIGN TOKENS resolve straight to their hex custom property. They do not
 * support Tailwind's opacity modifier syntax (`bg-live/10` will not work) —
 * that is deliberate. Alpha over an unknown backdrop is unpredictable, so the
 * palette ships precomputed `*-tint` values for chip and lane backgrounds and
 * `*-ink` values for signal-coloured text, each contrast-checked against the
 * surface it is designed to sit on.
 *
 * The SHADCN ALIASES stay in `hsl(var(--x))` form so pages still written
 * against shadcn's names keep working. Do not reach for them in new code.
 *
 * Elevation is three named shadows — `shadow-card`, `shadow-raised`,
 * `shadow-pop` — each a token in globals.css.
 */
const config: Config = {
  // Dark is a per-subtree opt-in, never the document: `dark:` variants follow
  // the same [data-theme='dark'] attribute the tokens do, so the admin live
  // board is the only place either applies.
  darkMode: ['selector', "[data-theme='dark']"],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Inter, like everything else. Page titles and hero figures are set in
        // the same face as the body; `font-display` is kept as a name so older
        // call sites resolve, and it resolves to Inter.
        display: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Inter — body, labels, buttons, navigation, and every figure (with
        // `tabular-nums`).
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // IBM Plex Mono — phone numbers, call IDs, API keys, webhook URLs and
        // table timestamps only.
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        hero: ['36px', { lineHeight: '1.1', fontWeight: '600', letterSpacing: '-0.02em' }],
        figure: ['26px', { lineHeight: '1.15', fontWeight: '600', letterSpacing: '-0.01em' }],
        title: ['22px', { lineHeight: '1.25', fontWeight: '600', letterSpacing: '-0.01em' }],
        section: ['16px', { lineHeight: '1.35', fontWeight: '600' }],
        body: ['14px', { lineHeight: '1.55', fontWeight: '400' }],
        // Pair with `uppercase` — Tailwind font sizes cannot set a transform.
        label: ['11px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '0.06em' }],
        meta: ['12px', { lineHeight: '1.45', fontWeight: '400' }],
        data: ['13px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        pop: 'var(--shadow-pop)',
      },
      borderRadius: {
        // shadcn's scale, driven by --radius (12px): lg 12px, md 10px, sm 8px.
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

        /*
         * The NetEnroll accent. `brand` is a bright fill (pair it with `text-ink`);
         * `brand-ink` is the only brand green that may be used for text;
         * `brand-tint` is the ground for an active or selected item.
         */
        brand: {
          DEFAULT: 'var(--brand)',
          tint: 'var(--brand-tint)',
          ink: 'var(--brand-ink)',
          // Text on the bright brand fill: `bg-brand text-brand-fg`.
          fg: 'var(--brand-fg)',
          // The primary button: `bg-brand-strong text-white`, 5.48:1.
          strong: 'var(--brand-strong)',
          'strong-hover': 'var(--brand-strong-hover)',
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
