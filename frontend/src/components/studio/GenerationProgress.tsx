'use client'

import type { JobProgressEvent } from '@/types/api'

export function GenerationProgress({ progress }: { progress: JobProgressEvent | null }) {
    if (!progress) return null
    const { status, progress_current, progress_total, error_message } = progress
    const total = Math.max(progress_total, 1)
    const pct = Math.min(100, Math.round((progress_current / total) * 100))

    const labelByStatus: Record<string, string> = {
        queued: 'Queued — waiting for worker…',
        loading_model: 'Loading model…',
        running: progress_total > 1 ? `Generating ${progress_current}/${progress_total}` : 'Generating…',
        completed: 'Completed',
        failed: 'Failed',
        cancelled: 'Cancelled',
    }

    const isError = status === 'failed'
    const isSuccess = status === 'completed'

    return (
        <div className="space-y-2 rounded-lg border border-border bg-bg-muted p-4">
            <div className="flex items-center justify-between text-xs">
                <span className={isError ? 'text-danger' : isSuccess ? 'text-success' : 'text-fg-muted'}>
                    {labelByStatus[status] ?? status}
                </span>
                {status === 'running' && <span className="text-fg-subtle">{pct}%</span>}
            </div>
            {(status === 'running' || status === 'queued' || status === 'loading_model') && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                    <div
                        className="h-full rounded-full bg-accent transition-all duration-300"
                        style={{ width: `${Math.max(4, pct)}%` }}
                    />
                </div>
            )}
            {error_message && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                    {error_message}
                </div>
            )}
        </div>
    )
}