
import type { Config } from 'tailwindcss'

const config: Config = {
    darkMode: 'class',

    content: [
        './src/app/**/*.{ts,tsx}',
        './src/components/**/*.{ts,tsx}',
        './src/hooks/**/*.{ts,tsx}',
        './src/lib/**/*.{ts,tsx}',
    ],

    theme: {
        extend: {
            colors: {
                bg: {
                    DEFAULT: 'rgb(var(--color-bg) / <alpha-value>)',
                    muted: 'rgb(var(--color-bg-muted) / <alpha-value>)',
                    elevated: 'rgb(var(--color-bg-elevated) / <alpha-value>)',
                },

                fg: {
                    DEFAULT: 'rgb(var(--color-fg) / <alpha-value>)',
                    muted: 'rgb(var(--color-fg-muted) / <alpha-value>)',
                    subtle: 'rgb(var(--color-fg-subtle) / <alpha-value>)',
                },

                border: {
                    DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
                    strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
                },

                accent: {
                    DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
                    hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
                },

                success: 'rgb(var(--color-success) / <alpha-value>)',
                warning: 'rgb(var(--color-warning) / <alpha-value>)',
                danger: 'rgb(var(--color-danger) / <alpha-value>)',
            },

            fontFamily: {
                sans: [
                    'Inter',
                    '-apple-system',
                    'BlinkMacSystemFont',
                    'Segoe UI',
                    'sans-serif',
                ],

                mono: [
                    'JetBrains Mono',
                    'Cascadia Code',
                    'Consolas',
                    'monospace',
                ],
            },

            borderRadius: {
                sm: '5px',
                md: '7px',
                lg: '9px',
                xl: '12px',
                '2xl': '15px',
            },

            boxShadow: {
                panel: '0 4px 18px rgb(0 0 0 / 0.10)',
                elevated: '0 16px 48px rgb(0 0 0 / 0.24)',
                focus: '0 0 0 3px rgb(var(--color-accent) / 0.14)',
            },

            transitionDuration: {
                160: '160ms',
                220: '220ms',
            },
        },
    },

    plugins: [],
}

export default config
