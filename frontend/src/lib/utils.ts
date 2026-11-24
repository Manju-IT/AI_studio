export function cn(...classes: Array<string | false | null | undefined>): string {
    return classes.filter(Boolean).join(' ')
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const value = bytes / Math.pow(1024, idx)
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`
}

export function formatDuration(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds)) return '—'
    const total = Math.round(seconds)
    const mins = Math.floor(total / 60)
    const secs = total % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatRelativeTime(iso: string | null | undefined): string {
    if (!iso) return '—'
    const then = new Date(iso).getTime()
    const now = Date.now()
    const delta = Math.floor((now - then) / 1000)
    if (delta < 30) return 'just now'
    if (delta < 60) return `${delta}s ago`
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
    return `${Math.floor(delta / 86400)}d ago`
}