/** @type {import('tailwindcss').Config} */
// Afrinov design tokens. Brand red #E3001B is the primary accent.
// Semantic colors are derived from the brand + a neutral slate scale.
// Colors are defined via CSS custom properties so Light/Dark themes
// can swap values without changing component code.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  'rgb(var(--color-brand-50) / <alpha-value>)',
          100: 'rgb(var(--color-brand-100) / <alpha-value>)',
          200: 'rgb(var(--color-brand-200) / <alpha-value>)',
          300: 'rgb(var(--color-brand-300) / <alpha-value>)',
          400: 'rgb(var(--color-brand-400) / <alpha-value>)',
          500: 'rgb(var(--color-brand-500) / <alpha-value>)',
          600: 'rgb(var(--color-brand-600) / <alpha-value>)',
          700: 'rgb(var(--color-brand-700) / <alpha-value>)',
          800: 'rgb(var(--color-brand-800) / <alpha-value>)',
          900: 'rgb(var(--color-brand-900) / <alpha-value>)',
        },
        surface: {
          0:   'rgb(var(--color-surface-0) / <alpha-value>)',
          50:  'rgb(var(--color-surface-50) / <alpha-value>)',
          100: 'rgb(var(--color-surface-100) / <alpha-value>)',
          200: 'rgb(var(--color-surface-200) / <alpha-value>)',
          300: 'rgb(var(--color-surface-300) / <alpha-value>)',
          400: 'rgb(var(--color-surface-400) / <alpha-value>)',
          500: 'rgb(var(--color-surface-500) / <alpha-value>)',
          600: 'rgb(var(--color-surface-600) / <alpha-value>)',
          700: 'rgb(var(--color-surface-700) / <alpha-value>)',
          800: 'rgb(var(--color-surface-800) / <alpha-value>)',
          900: 'rgb(var(--color-surface-900) / <alpha-value>)',
        },
        success: {
          50:  'rgb(var(--color-success-50) / <alpha-value>)',
          100: 'rgb(var(--color-success-100) / <alpha-value>)',
          500: 'rgb(var(--color-success-500) / <alpha-value>)',
          600: 'rgb(var(--color-success-600) / <alpha-value>)',
          700: 'rgb(var(--color-success-700) / <alpha-value>)',
        },
        warning: {
          50:  'rgb(var(--color-warning-50) / <alpha-value>)',
          100: 'rgb(var(--color-warning-100) / <alpha-value>)',
          500: 'rgb(var(--color-warning-500) / <alpha-value>)',
          600: 'rgb(var(--color-warning-600) / <alpha-value>)',
          700: 'rgb(var(--color-warning-700) / <alpha-value>)',
        },
        danger: {
          50:  'rgb(var(--color-danger-50) / <alpha-value>)',
          100: 'rgb(var(--color-danger-100) / <alpha-value>)',
          500: 'rgb(var(--color-danger-500) / <alpha-value>)',
          600: 'rgb(var(--color-danger-600) / <alpha-value>)',
          700: 'rgb(var(--color-danger-700) / <alpha-value>)',
        },
        info: {
          50:  'rgb(var(--color-info-50) / <alpha-value>)',
          100: 'rgb(var(--color-info-100) / <alpha-value>)',
          500: 'rgb(var(--color-info-500) / <alpha-value>)',
          600: 'rgb(var(--color-info-600) / <alpha-value>)',
          700: 'rgb(var(--color-info-700) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        'display': ['1.625rem', { lineHeight: '1.25', fontWeight: '600', letterSpacing: '-0.01em' }],
        'h1':      ['1.375rem', { lineHeight: '1.3',  fontWeight: '600', letterSpacing: '-0.01em' }],
        'h2':      ['1.125rem', { lineHeight: '1.35', fontWeight: '600' }],
        'h3':      ['0.9375rem',{ lineHeight: '1.4',  fontWeight: '600' }],
        'body':    ['0.875rem', { lineHeight: '1.5'  }],
        'small':   ['0.8125rem',{ lineHeight: '1.45' }],
        'xs':      ['0.75rem',  { lineHeight: '1.4'  }],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '14px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(17,21,27,0.04), 0 1px 1px rgba(17,21,27,0.03)',
        'card': '0 1px 2px rgba(17,21,27,0.05), 0 1px 3px rgba(17,21,27,0.04)',
        'popover': '0 4px 12px rgba(17,21,27,0.08), 0 2px 4px rgba(17,21,27,0.04)',
        'focus': '0 0 0 3px rgba(227,0,27,0.25)',
      },
      transitionDuration: {
        DEFAULT: '120ms',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
