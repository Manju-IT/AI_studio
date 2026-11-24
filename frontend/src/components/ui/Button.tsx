'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant
    size?: Size
}

const variantClasses: Record<Variant, string> = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'bg-bg-elevated text-fg hover:bg-bg-muted border border-border',
    ghost: 'bg-transparent text-fg-muted hover:bg-bg-elevated hover:text-fg',
    danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
}

const sizeClasses: Record<Size, string> = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { className, variant = 'primary', size = 'md', ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                variantClasses[variant],
                sizeClasses[size],
                className,
            )}
            {...rest}
        />
    )
})