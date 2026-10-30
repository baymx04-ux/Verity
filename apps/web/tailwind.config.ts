import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--color-canvas)',
        'canvas-subtle': 'var(--color-canvas-subtle)',
        surface: 'var(--color-surface)',
        'surface-hover': 'var(--color-surface-hover)',
        'surface-container': 'var(--color-surface-container)',
        'surface-container-low': 'var(--color-surface-container-low)',
        'surface-container-high': 'var(--color-surface-container-high)',
        muted: 'var(--color-muted)',
        inset: 'var(--color-inset)',
        line: 'var(--color-line)',
        'line-strong': 'var(--color-line-strong)',
        outline: 'var(--color-outline)',
        'outline-variant': 'var(--color-outline-variant)',
        ink: {
          900: 'var(--color-ink-900)',
          800: 'var(--color-ink-800)',
          700: 'var(--color-ink-700)',
          600: 'var(--color-ink-600)',
          500: 'var(--color-ink-500)',
          400: 'var(--color-ink-400)',
        },
        action: {
          DEFAULT: 'var(--color-action)',
          hover: 'var(--color-action-hover)',
          accent: 'var(--color-action-accent)',
          soft: 'var(--color-action-soft)',
          tint: 'var(--color-action-tint)',
          border: 'var(--color-action-border)',
        },
        verified: {
          DEFAULT: 'var(--color-verified)',
          bg: 'var(--color-verified-bg)',
          border: 'var(--color-verified-border)',
          text: 'var(--color-verified-text)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          bg: 'var(--color-danger-bg)',
          border: 'var(--color-danger-border)',
          text: 'var(--color-danger-text)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          bg: 'var(--color-warning-bg)',
          border: 'var(--color-warning-border)',
          text: 'var(--color-warning-text)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'display-2xl': [
          '2.5rem',
          { lineHeight: '2.85rem', letterSpacing: '-0.035em', fontWeight: '650' },
        ],
        'display-xl': [
          '2rem',
          { lineHeight: '2.4rem', letterSpacing: '-0.03em', fontWeight: '650' },
        ],
        'display-lg': [
          '1.625rem',
          { lineHeight: '2rem', letterSpacing: '-0.025em', fontWeight: '650' },
        ],
        'display-md': [
          '1.25rem',
          { lineHeight: '1.65rem', letterSpacing: '-0.02em', fontWeight: '600' },
        ],
        'display-sm': [
          '1rem',
          { lineHeight: '1.45rem', letterSpacing: '-0.012em', fontWeight: '600' },
        ],
        'display-xs': [
          '0.9375rem',
          { lineHeight: '1.35rem', letterSpacing: '-0.01em', fontWeight: '600' },
        ],
        'body-lg': ['1rem', { lineHeight: '1.625rem', letterSpacing: '-0.005em' }],
        'body-md': ['0.875rem', { lineHeight: '1.375rem' }],
        'body-sm': ['0.75rem', { lineHeight: '1.125rem', letterSpacing: '0.005em' }],
        'label-md': [
          '0.8125rem',
          { lineHeight: '1.125rem', letterSpacing: '0.005em', fontWeight: '500' },
        ],
        'label-sm': [
          '0.6875rem',
          { lineHeight: '1rem', letterSpacing: '0.04em', fontWeight: '600' },
        ],
        data: ['0.8125rem', { lineHeight: '1.25rem', letterSpacing: '-0.01em', fontWeight: '500' }],
      },
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.5rem',
        control: 'var(--radius-control)',
        nested: 'var(--radius-nested)',
        card: 'var(--radius-card)',
        xl: '1.25rem',
        '2xl': '1.5rem',
        full: 'var(--radius-pill)',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        inset: 'inset 0 1px 2px rgba(15, 23, 42, 0.05)',
        card: '0 4px 12px -2px rgba(15, 23, 42, 0.04), 0 2px 6px -1px rgba(15, 23, 42, 0.03)',
        elevated: '0 10px 25px -5px rgba(15, 23, 42, 0.07), 0 4px 10px -2px rgba(15, 23, 42, 0.04)',
        floating:
          '0 20px 35px -10px rgba(15, 23, 42, 0.08), 0 8px 16px -4px rgba(15, 23, 42, 0.04)',
        dropdown: '0 12px 24px -6px rgba(15, 23, 42, 0.1), 0 4px 8px -2px rgba(15, 23, 42, 0.05)',
        primary: '0 2px 4px rgba(3, 105, 161, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
        'primary-hover': '0 6px 12px rgba(3, 105, 161, 0.3)',
        'primary-pressed': '0 1px 2px rgba(3, 105, 161, 0.2)',
      },
      spacing: {
        'gutter-sm': '1rem',
        gutter: '1.5rem',
        'gutter-lg': '2rem',
        'margin-mobile': '1rem',
        margin: '2rem',
        'margin-desktop': '3rem',
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2.5rem',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translate3d(0, 12px, 0)' },
          '100%': { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        rise: 'rise 420ms cubic-bezier(0.23, 1, 0.32, 1) both',
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
