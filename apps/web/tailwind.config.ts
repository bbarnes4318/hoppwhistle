import type { Config } from 'tailwindcss';

/**
 * Project Cortex | Neuro-Luminescent Design System
 * Tailwind CSS v4 Configuration
 *
 * Color Palette: Electric Cyber
 * Typography: Space Grotesk / JetBrains Mono / Inter
 * Mode: Dark Default (Void Charcoal)
 */

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // =======================================================================
      // TYPOGRAPHY - Neuro-Luminescent Font Stack
      // =======================================================================
      fontFamily: {
        // Headlines: Authority/Technical
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        // Data/Code: Raw Data/Timestamps
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        // Body: Clean/Readable
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },

      // =======================================================================
      // COLORS - Electric Cyber Palette
      // =======================================================================
      colors: {
        // Canvas - Surface Colors
        surface: {
          light: '#F0EEE9', // Cloud Dancer (Light Mode)
          dark: '#0B0D10', // Void Charcoal (Dark Mode Default)
          panel: '#151A21', // Carbon Obsidian
        },

        // Electric Cyber Accents
        brand: {
          cyan: '#00E5FF', // The "Live" Signal
          violet: '#9C4AFF', // The AI Mind
          lime: '#CCFF00', // Toxic Lime - Disruptor Alert
          magenta: '#FF00FF', // Neon Magenta
        },

        // Grid & Structure
        grid: {
          line: '#1A1D23',
          glow: 'rgba(0, 229, 255, 0.15)',
        },

        // Text Hierarchy
        text: {
          primary: '#F0F4F8', // Plasma White
          secondary: '#A0AEC0', // Muted Cyber
          muted: '#4A5568', // Ghost Gray
        },

        // Semantic States
        status: {
          live: '#00E5FF',
          success: '#00D084',
          warning: '#CCFF00',
          error: '#FF4757',
          offline: '#4A5568',
        },

        // Legacy Shadcn/UI compatibility
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

      // =======================================================================
      // BORDER RADIUS
      // =======================================================================
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },

      // =======================================================================
      // ANIMATIONS - Neon Stream & Neural Pulse
      // =======================================================================
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'neon-stream': 'neon-stream 3s linear infinite',
        'neural-awakening': 'neural-awakening 0.6s ease-out',
        'grid-scan': 'grid-scan 4s linear infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': {
            boxShadow: '0 0 20px rgba(0, 229, 255, 0.3)',
            transform: 'scale(1)',
          },
          '50%': {
            boxShadow: '0 0 40px rgba(0, 229, 255, 0.6)',
            transform: 'scale(1.02)',
          },
        },
        'neon-stream': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        'neural-awakening': {
          '0%': { opacity: '0', transform: 'scale(0.8)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'grid-scan': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },

      // =======================================================================
      // BACKDROP BLUR - Glassmorphism
      // =======================================================================
      backdropBlur: {
        glass: '20px',
      },

      // =======================================================================
      // GRADIENTS - Iridescent Effects
      // =======================================================================
      backgroundImage: {
        'gradient-iridescent': 'linear-gradient(135deg, #00E5FF 0%, #9C4AFF 100%)',
        'gradient-toxic': 'linear-gradient(135deg, #CCFF00 0%, #00E5FF 100%)',
        'gradient-ai-mind': 'linear-gradient(135deg, #9C4AFF 0%, #FF00FF 100%)',
        'gradient-neon-stream':
          'linear-gradient(90deg, transparent, #00E5FF, #9C4AFF, transparent)',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
};

export default config;
