import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--color-canvas)',
        surface: 'var(--color-surface)',
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
          700: 'var(--color-ink-700)',
          500: 'var(--color-ink-500)',
          400: 'var(--color-ink-400)',
        },
        action: {
          DEFAULT: 'var(--color-action)',
          hover: 'var(--color-action-hover)',
          accent: 'var(--color-action-accent)',
          soft: 'var(--color-action-soft)',
          tint: 'var(--color-action-tint)',
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
        sans: ['Inter', 'Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Manrope', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'display-xl': [
          '2.25rem',
          { lineHeight: '2.75rem', letterSpacing: '-0.025em', fontWeight: '700' },
        ],
        'display-lg': [
          '1.75rem',
          { lineHeight: '2.25rem', letterSpacing: '-0.02em', fontWeight: '600' },
        ],
        'display-md': [
          '1.25rem',
          { lineHeight: '1.75rem', letterSpacing: '-0.015em', fontWeight: '600' },
        ],
        'display-sm': [
          '1rem',
          { lineHeight: '1.5rem', letterSpacing: '-0.01em', fontWeight: '600' },
        ],
        'body-lg': ['1rem', { lineHeight: '1.625rem', letterSpacing: '-0.005em' }],
        'body-md': ['0.875rem', { lineHeight: '1.375rem' }],
        'body-sm': ['0.75rem', { lineHeight: '1.125rem', letterSpacing: '0.005em' }],
        'label-md': [
          '0.8125rem',
          { lineHeight: '1.125rem', letterSpacing: '0.01em', fontWeight: '500' },
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
        xl: '1.5rem',
        full: 'var(--radius-pill)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        dropdown: 'var(--shadow-dropdown)',
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
    },
  },
  plugins: [],
} satisfies Config;
