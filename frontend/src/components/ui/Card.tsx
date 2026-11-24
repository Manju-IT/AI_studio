import { cn } from '@/lib/utils'

export function Card({
    className,
    children,
}: {
    className?: string
    children: React.ReactNode
}) {
    return (
        <div className={cn('rounded-xl border border-border bg-bg-muted p-5', className)}>
            {children}
        </div>
    )
}

export function CardTitle({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return <h3 className={cn('text-sm font-semibold text-fg', className)}>{children}</h3>
}

export function CardDescription({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return <p className={cn('text-xs text-fg-muted', className)}>{children}</p>
}