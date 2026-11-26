'use client'

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import Link from 'next/link'

import {
    Activity,
    AlertCircle,
    ArrowDownUp,
    AudioLines,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Copy,
    FileAudio2,
    History,
    Loader2,
    Play,
    RefreshCw,
    Search,
    Sparkles,
    StopCircle,
    X,
    XCircle,
} from 'lucide-react'

import { AudioPlayer } from '@/components/studio/AudioPlayer'
import { api, ApiError } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { GenerationJobOut } from '@/types/api'


// ============================================================
// Types and constants
// ============================================================

type Filter =
    | 'all'
    | 'completed'
    | 'processing'
    | 'failed'
    | 'cancelled'

type SortOrder = 'newest' | 'oldest'

const PAGE_SIZE = 10
const FETCH_LIMIT = 50
const REFRESH_INTERVAL = 5000

const ACTIVE_STATUSES = [
    'queued',
    'pending',
    'loading_model',
    'running',
    'processing',
]

const FILTERS: {
    id: Filter
    label: string
}[] = [
        { id: 'all', label: 'All jobs' },
        { id: 'completed', label: 'Completed' },
        { id: 'processing', label: 'In progress' },
        { id: 'failed', label: 'Failed' },
        { id: 'cancelled', label: 'Cancelled' },
    ]


// ============================================================
// Shared styles
// ============================================================

const styles = {
    panel: `
        rounded-xl
        border border-[rgb(var(--color-border))]
        bg-[rgb(var(--color-bg-muted))]
    `,

    secondaryButton: `
        inline-flex min-h-9 items-center justify-center gap-2
        rounded-lg border border-[rgb(var(--color-border))]
        bg-[rgb(var(--color-bg-muted))]
        px-3.5 py-2
        text-xs font-medium
        text-[rgb(var(--color-fg))]
        transition-colors
        hover:bg-[rgb(var(--color-bg-elevated))]
        hover:border-[rgb(var(--color-border-strong))]
        focus-visible:outline-none
        focus-visible:ring-2
        focus-visible:ring-[rgb(var(--color-accent))]
        disabled:cursor-not-allowed
        disabled:opacity-40
    `,

    primaryButton: `
        inline-flex min-h-9 items-center justify-center gap-2
        rounded-lg
        bg-[rgb(var(--color-accent))]
        px-4 py-2
        text-xs font-semibold text-[#29221a]
        transition-colors
        hover:bg-[rgb(var(--color-accent-hover))]
        focus-visible:outline-none
        focus-visible:ring-2
        focus-visible:ring-[rgb(var(--color-accent))]
        disabled:cursor-not-allowed
        disabled:opacity-40
    `,

    iconButton: `
        inline-flex h-9 w-9 shrink-0
        items-center justify-center
        rounded-lg
        border border-[rgb(var(--color-border))]
        text-[rgb(var(--color-fg-muted))]
        transition-colors
        hover:bg-[rgb(var(--color-bg-elevated))]
        hover:text-[rgb(var(--color-fg))]
        focus-visible:outline-none
        focus-visible:ring-2
        focus-visible:ring-[rgb(var(--color-accent))]
        disabled:opacity-40
    `,

    muted: 'text-[rgb(var(--color-fg-muted))]',

    subtle: 'text-[rgb(var(--color-fg-subtle))]',
}


// ============================================================
// Utility functions
// ============================================================

function getError(error: unknown): string {
    if (error instanceof ApiError) {
        return error.message
    }

    if (error instanceof Error) {
        return error.message
    }

    return 'The requested operation could not be completed.'
}


function isActive(status: string): boolean {
    return ACTIVE_STATUSES.includes(status)
}


function formatDuration(
    seconds: number | null | undefined
): string {
    if (
        seconds == null ||
        !Number.isFinite(seconds) ||
        seconds < 0
    ) {
        return '—'
    }

    const total = Math.floor(seconds)

    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const remaining = total % 60

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    }

    return `${minutes}:${String(remaining).padStart(2, '0')}`
}


function formatDate(value: string | null | undefined) {
    if (!value) return '—'

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
        return '—'
    }

    return date.toLocaleString()
}


function formatLanguage(language: string | null | undefined) {
    if (!language) return 'Not specified'

    const languages: Record<string, string> = {
        en: 'English',
        hi: 'Hindi',
        te: 'Telugu',
        ta: 'Tamil',
        kn: 'Kannada',
        ml: 'Malayalam',
        zh: 'Chinese',
        ja: 'Japanese',
        ko: 'Korean',
        fr: 'French',
        de: 'German',
        es: 'Spanish',
        it: 'Italian',
        pt: 'Portuguese',
        ru: 'Russian',
        auto: 'Automatic',
    }

    return languages[language.toLowerCase()] ?? language
}


function getProgress(job: GenerationJobOut): number | null {
    const current = job.progress_current
    const total = job.progress_total

    if (
        typeof current !== 'number' ||
        typeof total !== 'number' ||
        !Number.isFinite(current) ||
        !Number.isFinite(total) ||
        total <= 0
    ) {
        return null
    }

    return Math.max(
        0,
        Math.min(100, Math.round((current / total) * 100))
    )
}


// ============================================================
// Status configuration
// ============================================================

const statusConfig = {
    completed: {
        label: 'Completed',
        icon: CheckCircle2,
        style: `
            border-[rgb(var(--color-success)/0.25)]
            bg-[rgb(var(--color-success)/0.08)]
            text-[rgb(var(--color-success))]
        `,
    },

    failed: {
        label: 'Failed',
        icon: XCircle,
        style: `
            border-[rgb(var(--color-danger)/0.25)]
            bg-[rgb(var(--color-danger)/0.08)]
            text-[rgb(var(--color-danger))]
        `,
    },

    cancelled: {
        label: 'Cancelled',
        icon: StopCircle,
        style: `
            border-[rgb(var(--color-border))]
            bg-[rgb(var(--color-bg-elevated))]
            text-[rgb(var(--color-fg-muted))]
        `,
    },

    queued: {
        label: 'Queued',
        icon: Clock3,
        style: `
            border-[rgb(var(--color-accent)/0.3)]
            bg-[rgb(var(--color-accent)/0.10)]
            text-[#916027]
        `,
    },

    pending: {
        label: 'Pending',
        icon: Clock3,
        style: `
            border-[rgb(var(--color-border))]
            bg-[rgb(var(--color-bg-elevated))]
            text-[rgb(var(--color-fg-muted))]
        `,
    },

    loading_model: {
        label: 'Loading model',
        icon: Loader2,
        style: `
            border-[rgb(var(--color-warning)/0.25)]
            bg-[rgb(var(--color-warning)/0.08)]
            text-[rgb(var(--color-warning))]
        `,
    },

    running: {
        label: 'Generating',
        icon: Loader2,
        style: `
            border-[rgb(var(--color-warning)/0.25)]
            bg-[rgb(var(--color-warning)/0.08)]
            text-[rgb(var(--color-warning))]
        `,
    },

    processing: {
        label: 'Processing',
        icon: Loader2,
        style: `
            border-[rgb(var(--color-warning)/0.25)]
            bg-[rgb(var(--color-warning)/0.08)]
            text-[rgb(var(--color-warning))]
        `,
    },
}


function StatusBadge({
    status,
    cancellationRequested,
}: {
    status: string
    cancellationRequested?: boolean
}) {
    const config =
        statusConfig[status as keyof typeof statusConfig] ?? {
            label: status,
            icon: Clock3,
            style: `
                border-[rgb(var(--color-border))]
                bg-[rgb(var(--color-bg-elevated))]
                text-[rgb(var(--color-fg-muted))]
            `,
        }

    const Icon = config.icon

    const cancelling =
        cancellationRequested && isActive(status)

    const spinning =
        cancelling ||
        ['running', 'processing', 'loading_model'].includes(status)

    return (
        <span
            className={`
                inline-flex shrink-0 items-center gap-1.5
                rounded-md border px-2.5 py-1
                text-xs font-medium
                ${config.style}
            `}
        >
            {cancelling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
                <Icon
                    className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''
                        }`}
                />
            )}

            {cancelling ? 'Cancelling' : config.label}
        </span>
    )
}


// ============================================================
// Statistics card
// ============================================================

function StatCard({
    label,
    value,
    icon: Icon,
    description,
    selected,
    loading,
    onClick,
}: {
    label: string
    value: number
    icon: typeof History
    description: string
    selected: boolean
    loading: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={selected}
            className={`
                ${styles.panel}
                min-w-0 p-4 text-left
                transition-colors sm:p-5
                hover:border-[rgb(var(--color-accent)/0.55)]
                focus-visible:outline-none
                focus-visible:ring-2
                focus-visible:ring-[rgb(var(--color-accent))]
                ${selected
                    ? 'border-[rgb(var(--color-accent)/0.65)]'
                    : ''
                }
            `}
        >
            <div className="flex items-center justify-between gap-2">
                <span
                    className={`text-xs font-medium sm:text-sm ${styles.muted}`}
                >
                    {label}
                </span>

                <Icon
                    className={`h-4 w-4 shrink-0 ${selected
                        ? 'text-[#98652d]'
                        : styles.subtle
                        }`}
                    strokeWidth={1.7}
                />
            </div>

            <p className="mt-3 text-[29px] font-semibold leading-none tracking-tight tabular-nums">
                {loading
                    ? '—'
                    : value.toString().padStart(2, '0')}
            </p>

            <p className={`mt-2 text-[11px] ${styles.subtle}`}>
                {description}
            </p>
        </button>
    )
}


// ============================================================
// Copy button
// ============================================================

function CopyButton({
    value,
    label,
}: {
    value: string
    label: string
}) {
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState(false)

    const timerRef = useRef<
        ReturnType<typeof setTimeout> | null
    >(null)

    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current)
            }
        }
    }, [])

    async function handleCopy() {
        if (!value) return

        if (timerRef.current) {
            clearTimeout(timerRef.current)
        }

        try {
            await navigator.clipboard.writeText(value)

            setCopied(true)
            setCopyError(false)

            timerRef.current = setTimeout(() => {
                setCopied(false)
            }, 1800)
        } catch {
            setCopied(false)
            setCopyError(true)

            timerRef.current = setTimeout(() => {
                setCopyError(false)
            }, 2500)
        }
    }

    return (
        <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!value}
            title={
                copied
                    ? 'Copied'
                    : copyError
                        ? 'Clipboard unavailable'
                        : label
            }
            aria-label={
                copied
                    ? 'Copied'
                    : copyError
                        ? 'Unable to copy'
                        : label
            }
            className={styles.iconButton}
        >
            {copied ? (
                <Check className="h-4 w-4 text-[rgb(var(--color-success))]" />
            ) : copyError ? (
                <AlertCircle className="h-4 w-4 text-[rgb(var(--color-danger))]" />
            ) : (
                <Copy className="h-3.5 w-3.5" />
            )}
        </button>
    )
}


// ============================================================
// Job progress
// ============================================================

function JobProgress({
    job,
}: {
    job: GenerationJobOut
}) {
    if (!isActive(job.status)) {
        return null
    }

    const progress = getProgress(job)

    const waiting = job.status === 'queued'

    const loadingModel = job.status === 'loading_model'

    let description = 'Generating speech'

    if (job.cancellation_requested) {
        description = 'Waiting for cancellation'
    } else if (waiting) {
        description = 'Waiting in the generation queue'
    } else if (loadingModel) {
        description = 'Initializing speech model'
    }

    return (
        <div className="mt-4 rounded-lg border border-[rgb(var(--color-border))] bg-[rgb(var(--color-bg-elevated))] p-3.5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    {waiting ? (
                        <Clock3 className={`h-3.5 w-3.5 ${styles.subtle}`} />
                    ) : (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#98652d]" />
                    )}

                    <span className={`text-xs font-medium ${styles.muted}`}>
                        {description}
                    </span>
                </div>

                {!waiting &&
                    !loadingModel &&
                    progress !== null && (
                        <span className="text-xs font-semibold tabular-nums">
                            {progress}%
                        </span>
                    )}
            </div>

            {!waiting &&
                !loadingModel &&
                progress !== null && (
                    <>
                        <div
                            role="progressbar"
                            aria-label="Generation progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress}
                            className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--color-border))]"
                        >
                            <div
                                className="h-full rounded-full bg-[rgb(var(--color-accent))] transition-all duration-500"
                                style={{ width: `${progress}%` }}
                            />
                        </div>

                        <p className={`mt-2 text-[11px] ${styles.subtle}`}>
                            {job.progress_current} of {job.progress_total} work units completed
                        </p>
                    </>
                )}
        </div>
    )
}


// ============================================================
// Job detail field
// ============================================================

function DetailField({
    label,
    value,
    monospace = false,
}: {
    label: string
    value: string
    monospace?: boolean
}) {
    return (
        <div className="min-w-0">
            <dt className={`text-xs ${styles.subtle}`}>
                {label}
            </dt>

            <dd
                className={`
                    mt-1 break-words text-xs font-medium
                    text-[rgb(var(--color-fg))]
                    ${monospace ? 'font-mono break-all' : ''}
                `}
            >
                {value}
            </dd>
        </div>
    )
}


// ============================================================
// Generation card
// ============================================================

function JobCard({
    job,
    expanded,
    audioOpen,
    cancelling,
    onToggle,
    onToggleAudio,
    onCancel,
}: {
    job: GenerationJobOut
    expanded: boolean
    audioOpen: boolean
    cancelling: boolean
    onToggle: () => void
    onToggleAudio: () => void
    onCancel: () => void
}) {
    const active = isActive(job.status)

    const hasAudio = Boolean(job.audio_asset)

    const canCancel =
        active &&
        !job.cancellation_requested &&
        !cancelling

    const duration =
        job.audio_asset?.duration_seconds ??
        job.duration_seconds

    const generationType = job.is_long_form
        ? 'Long-form generation'
        : 'Text to speech'

    return (
        <article
            className={`
                ${styles.panel}
                overflow-hidden
                transition-colors
                hover:border-[rgb(var(--color-border-strong))]
            `}
        >
            <div className="p-4 sm:p-5">

                {/* Job heading */}

                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgb(var(--color-accent)/0.25)] bg-[rgb(var(--color-accent)/0.10)]">
                            <AudioLines
                                className="h-5 w-5 text-[#98652d]"
                                strokeWidth={1.7}
                            />
                        </div>

                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-xs font-semibold">
                                    {generationType}
                                </span>

                                <span className={styles.subtle}>
                                    ·
                                </span>

                                <time
                                    dateTime={job.created_at}
                                    title={formatDate(job.created_at)}
                                    className={`text-xs ${styles.subtle}`}
                                >
                                    {formatRelativeTime(job.created_at)}
                                </time>
                            </div>

                            <p
                                className={`
                                    mt-2 whitespace-pre-wrap
                                    break-words text-sm leading-6
                                    text-[rgb(var(--color-fg))]
                                    ${expanded ? '' : 'line-clamp-2'}
                                `}
                            >
                                {job.text || 'No text supplied'}
                            </p>

                            {/* Compact metadata */}

                            <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] ${styles.subtle}`}>
                                <span>
                                    {formatLanguage(job.language)}
                                </span>

                                <span>·</span>

                                <span>
                                    {(job.text ?? '').length.toLocaleString()} characters
                                </span>

                                {duration != null && (
                                    <>
                                        <span>·</span>

                                        <span className="inline-flex items-center gap-1">
                                            <Clock3 className="h-3 w-3" />

                                            {formatDuration(duration)}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <StatusBadge
                        status={job.status}
                        cancellationRequested={
                            job.cancellation_requested
                        }
                    />
                </div>

                {/* Error information */}

                {job.error_message && (
                    <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[rgb(var(--color-danger)/0.22)] bg-[rgb(var(--color-danger)/0.05)] px-3.5 py-3">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--color-danger))]" />

                        <div className="min-w-0">
                            <p className="text-xs font-semibold text-[rgb(var(--color-danger))]">
                                Generation error
                            </p>

                            <p
                                className={`
                                    mt-1 break-words text-xs leading-5
                                    text-[rgb(var(--color-danger))]
                                    ${expanded ? '' : 'line-clamp-2'}
                                `}
                            >
                                {job.error_message}
                            </p>
                        </div>
                    </div>
                )}

                {/* Live generation progress */}

                <JobProgress job={job} />

                {/* Audio preview */}

                {audioOpen && job.audio_asset && (
                    <div className="mt-4">
                        <AudioPlayer asset={job.audio_asset} />
                    </div>
                )}

                {/* Job actions */}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--color-border))] pt-3">
                    <div className="flex items-center gap-2">
                        <span
                            title={job.id}
                            className={`font-mono text-[11px] ${styles.subtle}`}
                        >
                            #{job.id.slice(0, 8)}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">

                        {hasAudio && (
                            <button
                                type="button"
                                onClick={onToggleAudio}
                                aria-expanded={audioOpen}
                                className={
                                    audioOpen
                                        ? styles.secondaryButton
                                        : styles.primaryButton
                                }
                            >
                                {audioOpen ? (
                                    <X className="h-3.5 w-3.5" />
                                ) : (
                                    <Play className="h-3.5 w-3.5 fill-current" />
                                )}

                                {audioOpen
                                    ? 'Close audio'
                                    : 'Preview audio'}
                            </button>
                        )}

                        {active && (
                            <button
                                type="button"
                                disabled={!canCancel}
                                onClick={onCancel}
                                className="
                                    inline-flex min-h-9 items-center
                                    justify-center gap-2 rounded-lg
                                    border border-[rgb(var(--color-danger)/0.25)]
                                    bg-[rgb(var(--color-danger)/0.06)]
                                    px-3.5 py-2 text-xs font-medium
                                    text-[rgb(var(--color-danger))]
                                    transition-colors
                                    hover:bg-[rgb(var(--color-danger)/0.12)]
                                    disabled:cursor-not-allowed
                                    disabled:opacity-40
                                "
                            >
                                {cancelling ||
                                    job.cancellation_requested ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <StopCircle className="h-3.5 w-3.5" />
                                )}

                                {cancelling ||
                                    job.cancellation_requested
                                    ? 'Cancelling'
                                    : 'Cancel job'}
                            </button>
                        )}

                        <CopyButton
                            value={job.text ?? ''}
                            label="Copy generation text"
                        />

                        <button
                            type="button"
                            onClick={onToggle}
                            aria-expanded={expanded}
                            className={styles.secondaryButton}
                        >
                            {expanded
                                ? 'Hide details'
                                : 'Details'}

                            <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''
                                    }`}
                            />
                        </button>
                    </div>
                </div>
            </div>

            {/* Expanded job details */}

            {expanded && (
                <div className="border-t border-[rgb(var(--color-border))] bg-[rgb(var(--color-bg-elevated))] px-4 py-5 sm:px-5">

                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className={`text-xs font-semibold ${styles.muted}`}>
                            Generation details
                        </h3>

                        <CopyButton
                            value={job.id}
                            label="Copy job ID"
                        />
                    </div>

                    <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                        <DetailField
                            label="Job ID"
                            value={job.id}
                            monospace
                        />

                        <DetailField
                            label="Submitted"
                            value={formatDate(job.created_at)}
                        />

                        <DetailField
                            label="Status"
                            value={
                                statusConfig[
                                    job.status as keyof typeof statusConfig
                                ]?.label ?? job.status
                            }
                        />

                        <DetailField
                            label="Language"
                            value={formatLanguage(job.language)}
                        />

                        <DetailField
                            label="Generation type"
                            value={generationType}
                        />

                        <DetailField
                            label="Audio duration"
                            value={formatDuration(duration)}
                        />

                        <DetailField
                            label="Output"
                            value={
                                hasAudio
                                    ? 'Audio available'
                                    : 'No audio generated'
                            }
                        />

                        {job.audio_asset && (
                            <>
                                <DetailField
                                    label="Audio format"
                                    value={
                                        job.audio_asset.format?.toUpperCase() ??
                                        '—'
                                    }
                                />

                                <DetailField
                                    label="Sample rate"
                                    value={
                                        job.audio_asset.sample_rate
                                            ? `${job.audio_asset.sample_rate.toLocaleString()} Hz`
                                            : '—'
                                    }
                                />
                            </>
                        )}
                    </dl>
                </div>
            )}
        </article>
    )
}


// ============================================================
// Loading skeleton
// ============================================================

function JobSkeleton() {
    return (
        <div className={`${styles.panel} animate-pulse p-5`}>
            <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-[rgb(var(--color-bg-elevated))]" />

                <div className="flex-1 space-y-3">
                    <div className="h-3 w-36 rounded bg-[rgb(var(--color-border))]" />

                    <div className="h-3 w-full max-w-lg rounded bg-[rgb(var(--color-bg-elevated))]" />

                    <div className="h-3 w-2/3 rounded bg-[rgb(var(--color-bg-elevated))]" />
                </div>

                <div className="h-6 w-20 rounded-md bg-[rgb(var(--color-bg-elevated))]" />
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-[rgb(var(--color-border))] pt-3">
                <div className="h-8 w-24 rounded-lg bg-[rgb(var(--color-bg-elevated))]" />

                <div className="h-8 w-16 rounded-lg bg-[rgb(var(--color-bg-elevated))]" />
            </div>
        </div>
    )
}


// ============================================================
// Main page
// ============================================================

export default function JobsPage() {
    const [jobs, setJobs] = useState<GenerationJobOut[]>([])

    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)

    const [error, setError] = useState('')
    const [actionError, setActionError] = useState('')
    const [notice, setNotice] = useState('')

    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<Filter>('all')
    const [sortOrder, setSortOrder] = useState<SortOrder>('newest')

    const [page, setPage] = useState(1)

    const [expanded, setExpanded] = useState<Set<string>>(
        () => new Set()
    )

    const [audioJobId, setAudioJobId] = useState<string | null>(
        null
    )

    const [cancellingJobs, setCancellingJobs] = useState<Set<string>>(
        () => new Set()
    )

    const [lastUpdated, setLastUpdated] = useState<Date | null>(
        null
    )

    const mountedRef = useRef(false)
    const requestIdRef = useRef(0)
    const inFlightRef = useRef(false)

    const cancellingRef = useRef<Set<string>>(new Set())


    // --------------------------------------------------------
    // Fetch jobs
    // --------------------------------------------------------

    const refresh = useCallback(
        async (
            mode: 'initial' | 'manual' | 'background' = 'manual'
        ) => {
            if (inFlightRef.current) return

            inFlightRef.current = true

            const requestId = ++requestIdRef.current

            if (mode === 'initial') {
                setLoading(true)
            }

            if (mode === 'manual') {
                setRefreshing(true)
            }

            try {
                const data = await api.generations.list(FETCH_LIMIT)

                if (
                    !mountedRef.current ||
                    requestId !== requestIdRef.current
                ) {
                    return
                }

                setJobs(data)
                setError('')
                setLastUpdated(new Date())

                const validIds = new Set(
                    data.map(job => job.id)
                )

                setExpanded(previous => {
                    return new Set(
                        [...previous].filter(id => validIds.has(id))
                    )
                })

                setAudioJobId(previous => {
                    if (previous && !validIds.has(previous)) {
                        return null
                    }

                    return previous
                })
            } catch (err) {
                if (
                    mountedRef.current &&
                    requestId === requestIdRef.current
                ) {
                    setError(getError(err))
                }
            } finally {
                if (requestId === requestIdRef.current) {
                    inFlightRef.current = false

                    if (mountedRef.current) {
                        setLoading(false)
                        setRefreshing(false)
                    }
                }
            }
        },
        []
    )


    // --------------------------------------------------------
    // Automatic refresh
    // --------------------------------------------------------

    useEffect(() => {
        mountedRef.current = true

        void refresh('initial')

        const interval = window.setInterval(() => {
            if (
                !document.hidden &&
                cancellingRef.current.size === 0
            ) {
                void refresh('background')
            }
        }, REFRESH_INTERVAL)

        function handleVisibility() {
            if (
                !document.hidden &&
                cancellingRef.current.size === 0
            ) {
                void refresh('background')
            }
        }

        document.addEventListener(
            'visibilitychange',
            handleVisibility
        )

        return () => {
            mountedRef.current = false
            requestIdRef.current += 1
            inFlightRef.current = false

            window.clearInterval(interval)

            document.removeEventListener(
                'visibilitychange',
                handleVisibility
            )
        }
    }, [refresh])


    // --------------------------------------------------------
    // Job cancellation
    // --------------------------------------------------------

    async function handleCancel(job: GenerationJobOut) {
        if (
            !isActive(job.status) ||
            job.cancellation_requested ||
            cancellingRef.current.has(job.id)
        ) {
            return
        }

        const confirmed = window.confirm(
            'Cancel this generation? Any unfinished audio may be lost.'
        )

        if (!confirmed) return

        cancellingRef.current.add(job.id)

        setCancellingJobs(
            new Set(cancellingRef.current)
        )

        setActionError('')
        setNotice('')

        try {
            await api.generations.cancel(job.id)

            if (!mountedRef.current) return

            // Invalidate an older list request that may have
            // started before the cancellation was accepted.

            requestIdRef.current += 1
            inFlightRef.current = false

            setNotice(
                'Cancellation requested. The final status will update when the worker acknowledges it.'
            )

            await refresh('manual')
        } catch (err) {
            if (mountedRef.current) {
                setActionError(getError(err))
            }
        } finally {
            cancellingRef.current.delete(job.id)

            if (mountedRef.current) {
                setCancellingJobs(
                    new Set(cancellingRef.current)
                )
            }
        }
    }


    // --------------------------------------------------------
    // Statistics
    // --------------------------------------------------------

    const counts = useMemo(() => {
        return {
            all: jobs.length,

            completed: jobs.filter(
                job => job.status === 'completed'
            ).length,

            processing: jobs.filter(
                job => isActive(job.status)
            ).length,

            failed: jobs.filter(
                job => job.status === 'failed'
            ).length,

            cancelled: jobs.filter(
                job => job.status === 'cancelled'
            ).length,
        }
    }, [jobs])


    // --------------------------------------------------------
    // Search, filtering and sorting
    // --------------------------------------------------------

    const visible = useMemo(() => {
        const search = query.trim().toLowerCase()

        const filtered = jobs.filter(job => {
            const searchable = [
                job.id,
                job.text ?? '',
                job.language ?? '',
                job.error_message ?? '',
                job.status,
            ]
                .join(' ')
                .toLowerCase()

            if (search && !searchable.includes(search)) {
                return false
            }

            if (filter === 'all') {
                return true
            }

            if (filter === 'processing') {
                return isActive(job.status)
            }

            return job.status === filter
        })

        return filtered.sort((a, b) => {
            const first = new Date(a.created_at).getTime()
            const second = new Date(b.created_at).getTime()

            return sortOrder === 'newest'
                ? second - first
                : first - second
        })
    }, [jobs, query, filter, sortOrder])


    // --------------------------------------------------------
    // Pagination
    // --------------------------------------------------------

    const totalPages = Math.max(
        1,
        Math.ceil(visible.length / PAGE_SIZE)
    )

    const currentPage = Math.min(page, totalPages)

    const paginatedJobs = visible.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE
    )

    useEffect(() => {
        setPage(previous => Math.min(previous, totalPages))
    }, [totalPages])

    function changeFilter(next: Filter) {
        setFilter(next)
        setPage(1)
        setAudioJobId(null)
    }

    function changePage(next: number) {
        setPage(
            Math.max(1, Math.min(totalPages, next))
        )

        setAudioJobId(null)
    }

    function clearFilters() {
        setQuery('')
        setFilter('all')
        setPage(1)
        setAudioJobId(null)
    }

    function toggleExpanded(id: string) {
        setExpanded(previous => {
            const next = new Set(previous)

            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }

            return next
        })
    }


    // --------------------------------------------------------
    // Statistics configuration
    // --------------------------------------------------------

    const metrics = [
        {
            id: 'all' as const,
            label: 'Recent jobs',
            value: counts.all,
            description: `Latest ${FETCH_LIMIT} generations`,
            icon: History,
        },
        {
            id: 'completed' as const,
            label: 'Completed',
            value: counts.completed,
            description: 'Successful generations',
            icon: CheckCircle2,
        },
        {
            id: 'processing' as const,
            label: 'In progress',
            value: counts.processing,
            description: 'Queued or generating',
            icon: Activity,
        },
        {
            id: 'failed' as const,
            label: 'Failed',
            value: counts.failed,
            description: 'Unsuccessful generations',
            icon: AlertCircle,
        },
        {
            id: 'cancelled' as const,
            label: 'Cancelled',
            value: counts.cancelled,
            description: 'Stopped generations',
            icon: StopCircle,
        },
    ]


    // ========================================================
    // Render
    // ========================================================

    return (
        <main
            className="
        w-full min-w-0 max-w-none
        space-y-6 px-4 py-5
        text-[rgb(var(--color-fg))]
        sm:px-5 lg:px-6
    "
        >

            {/* Page header */}

            <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className={`mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${styles.subtle}`}>
                        <History className="h-3.5 w-3.5" />

                        Workspace

                        <span>/</span>

                        History
                    </div>

                    <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                        Generation history
                    </h1>

                    <p className={`mt-1.5 max-w-xl text-sm leading-6 ${styles.muted}`}>
                        Manage your speech generations, preview audio,
                        and monitor active jobs.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        disabled={loading || refreshing}
                        onClick={() => void refresh('manual')}
                        className={styles.secondaryButton}
                    >
                        <RefreshCw
                            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''
                                }`}
                        />

                        {refreshing
                            ? 'Refreshing'
                            : 'Refresh'}
                    </button>

                    <Link
                        href="/studio"
                        className={styles.primaryButton}
                    >
                        <Sparkles className="h-4 w-4" />

                        New generation
                    </Link>
                </div>
            </header>


            {/* Request errors */}

            {error && (
                <div
                    role="alert"
                    className="flex items-start gap-3 rounded-lg border border-[rgb(var(--color-danger)/0.25)] bg-[rgb(var(--color-danger)/0.06)] px-4 py-3"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--color-danger))]" />

                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[rgb(var(--color-danger))]">
                            Unable to refresh history
                        </p>

                        <p className="mt-1 text-xs leading-5 text-[rgb(var(--color-danger))]">
                            {error}
                        </p>

                        {jobs.length > 0 && (
                            <p className={`mt-1 text-xs ${styles.muted}`}>
                                Previously loaded results are still displayed.
                            </p>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={() => void refresh('manual')}
                        disabled={refreshing}
                        className={styles.secondaryButton}
                    >
                        Retry
                    </button>
                </div>
            )}


            {/* Action errors */}

            {actionError && (
                <div
                    role="alert"
                    className="flex items-start gap-3 rounded-lg border border-[rgb(var(--color-danger)/0.25)] bg-[rgb(var(--color-danger)/0.06)] px-4 py-3"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--color-danger))]" />

                    <p className="flex-1 text-sm leading-5 text-[rgb(var(--color-danger))]">
                        {actionError}
                    </p>

                    <button
                        type="button"
                        onClick={() => setActionError('')}
                        aria-label="Dismiss error"
                    >
                        <X className="h-4 w-4 text-[rgb(var(--color-danger))]" />
                    </button>
                </div>
            )}


            {/* Notifications */}

            {notice && (
                <div
                    role="status"
                    className="flex items-start gap-3 rounded-lg border border-[rgb(var(--color-accent)/0.3)] bg-[rgb(var(--color-accent)/0.08)] px-4 py-3"
                >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#98652d]" />

                    <p className="flex-1 text-sm leading-5">
                        {notice}
                    </p>

                    <button
                        type="button"
                        onClick={() => setNotice('')}
                        aria-label="Dismiss notification"
                        className={styles.muted}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}


            {/* Statistics */}

            <section
                aria-label="Generation statistics"
                className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
            >
                {metrics.map(metric => (
                    <StatCard
                        key={metric.id}
                        label={metric.label}
                        value={metric.value}
                        description={metric.description}
                        icon={metric.icon}
                        selected={filter === metric.id}
                        loading={loading}
                        onClick={() => changeFilter(metric.id)}
                    />
                ))}
            </section>


            {/* Generation history */}

            <section className="space-y-4">

                {/* Section heading */}

                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">
                            Recent generations
                        </h2>

                        <p className={`mt-1 text-xs ${styles.subtle}`}>
                            Browse and manage your recent synthesis jobs.
                        </p>
                    </div>

                    {lastUpdated && (
                        <div
                            className={`flex items-center gap-2 text-[11px] ${styles.subtle}`}
                            title={lastUpdated.toLocaleString()}
                        >
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${error
                                    ? 'bg-[rgb(var(--color-danger))]'
                                    : 'bg-[rgb(var(--color-success))]'
                                    }`}
                            />

                            {error
                                ? 'Refresh unavailable'
                                : 'Auto-refresh enabled'}
                        </div>
                    )}
                </div>


                {/* Search and filters */}

                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className={`${styles.panel} flex flex-wrap items-center gap-1 p-1`}>
                        {FILTERS.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => changeFilter(item.id)}
                                aria-pressed={filter === item.id}
                                className={`
                                    inline-flex items-center gap-1.5
                                    rounded-md px-3 py-2
                                    text-xs font-medium
                                    transition-colors
                                    ${filter === item.id
                                        ? `
                                                bg-[rgb(var(--color-accent)/0.16)]
                                                text-[rgb(var(--color-fg))]
                                            `
                                        : `
                                                text-[rgb(var(--color-fg-muted))]
                                                hover:bg-[rgb(var(--color-bg-elevated))]
                                            `
                                    }
                                `}
                            >
                                {item.label}

                                {!loading && (
                                    <span
                                        className={`
                                            text-[10px] tabular-nums
                                            ${filter === item.id
                                                ? 'text-[#98652d]'
                                                : styles.subtle
                                            }
                                        `}
                                    >
                                        {counts[item.id]}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">

                        {/* Search */}

                        <div className="relative flex-1">
                            <Search
                                className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${styles.subtle}`}
                            />

                            <input
                                type="search"
                                value={query}
                                onChange={event => {
                                    setQuery(event.target.value)
                                    setPage(1)
                                    setAudioJobId(null)
                                }}
                                placeholder="Search generations..."
                                aria-label="Search generations"
                                className="
                                    h-10 w-full rounded-lg
                                    border border-[rgb(var(--color-border))]
                                    bg-[rgb(var(--color-bg-muted))]
                                    pl-9 pr-3 text-xs
                                    text-[rgb(var(--color-fg))]
                                    outline-none
                                    placeholder:text-[rgb(var(--color-fg-subtle))]
                                    focus:border-[rgb(var(--color-accent-hover))]
                                    sm:w-56
                                "
                            />
                        </div>

                        {/* Sort */}

                        <button
                            type="button"
                            onClick={() => {
                                setSortOrder(previous =>
                                    previous === 'newest'
                                        ? 'oldest'
                                        : 'newest'
                                )

                                setPage(1)
                                setAudioJobId(null)
                            }}
                            title="Change chronological sort order"
                            className={`${styles.secondaryButton} h-10`}
                        >
                            <ArrowDownUp className="h-3.5 w-3.5" />

                            {sortOrder === 'newest'
                                ? 'Newest first'
                                : 'Oldest first'}
                        </button>
                    </div>
                </div>


                {/* Loading state */}

                {loading ? (
                    <div
                        className="space-y-3"
                        aria-label="Loading generation history"
                        aria-busy="true"
                    >
                        <JobSkeleton />
                        <JobSkeleton />
                        <JobSkeleton />
                    </div>


                    /* Initial request failure */

                ) : error && jobs.length === 0 ? (
                    <div className={`${styles.panel} px-6 py-14 text-center`}>
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[rgb(var(--color-danger)/0.08)]">
                            <AlertCircle className="h-6 w-6 text-[rgb(var(--color-danger))]" />
                        </div>

                        <h3 className="mt-4 text-sm font-semibold">
                            History unavailable
                        </h3>

                        <p className={`mx-auto mt-2 max-w-sm text-xs leading-5 ${styles.muted}`}>
                            Generation history could not be retrieved.
                            Check that the backend is running and try again.
                        </p>

                        <button
                            type="button"
                            onClick={() => void refresh('manual')}
                            disabled={refreshing}
                            className={`${styles.secondaryButton} mt-5`}
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''
                                    }`}
                            />

                            Try again
                        </button>
                    </div>


                    /* Empty state */

                ) : visible.length === 0 ? (
                    <div className={`${styles.panel} px-6 py-14 text-center`}>
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgb(var(--color-accent)/0.2)] bg-[rgb(var(--color-accent)/0.08)]">
                            {jobs.length > 0 ? (
                                <Search
                                    className="h-6 w-6 text-[#98652d]"
                                    strokeWidth={1.5}
                                />
                            ) : (
                                <FileAudio2
                                    className="h-6 w-6 text-[#98652d]"
                                    strokeWidth={1.5}
                                />
                            )}
                        </div>

                        <h3 className="mt-4 text-sm font-semibold">
                            {jobs.length > 0
                                ? 'No matching generations'
                                : 'No generations yet'}
                        </h3>

                        <p className={`mx-auto mt-2 max-w-sm text-xs leading-5 ${styles.muted}`}>
                            {jobs.length > 0
                                ? 'Try a different search term or select another status.'
                                : 'Create your first speech generation in Studio. Your audio and generation history will appear here.'}
                        </p>

                        {jobs.length > 0 ? (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className={`${styles.secondaryButton} mt-5`}
                            >
                                Clear filters
                            </button>
                        ) : (
                            <Link
                                href="/studio"
                                className={`${styles.primaryButton} mt-5`}
                            >
                                <Sparkles className="h-4 w-4" />

                                Open Studio
                            </Link>
                        )}
                    </div>


                    /* Generation list */

                ) : (
                    <div className="space-y-3">
                        {paginatedJobs.map(job => (
                            <JobCard
                                key={job.id}
                                job={job}
                                expanded={expanded.has(job.id)}
                                audioOpen={audioJobId === job.id}
                                cancelling={cancellingJobs.has(job.id)}
                                onToggle={() => toggleExpanded(job.id)}
                                onToggleAudio={() => {
                                    setAudioJobId(previous =>
                                        previous === job.id
                                            ? null
                                            : job.id
                                    )
                                }}
                                onCancel={() => void handleCancel(job)}
                            />
                        ))}
                    </div>
                )}


                {/* Pagination */}

                {!loading && visible.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-1">
                        <p className={`text-xs ${styles.subtle}`}>
                            Showing{' '}

                            <span className="font-medium text-[rgb(var(--color-fg))]">
                                {(currentPage - 1) * PAGE_SIZE + 1}
                                –
                                {Math.min(
                                    currentPage * PAGE_SIZE,
                                    visible.length
                                )}
                            </span>

                            {' '}of {visible.length} matching jobs
                        </p>

                        {totalPages > 1 && (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={currentPage <= 1}
                                    onClick={() =>
                                        changePage(currentPage - 1)
                                    }
                                    aria-label="Previous page"
                                    className={styles.iconButton}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>

                                <span className={`min-w-20 text-center text-xs tabular-nums ${styles.muted}`}>
                                    Page {currentPage} of {totalPages}
                                </span>

                                <button
                                    type="button"
                                    disabled={currentPage >= totalPages}
                                    onClick={() =>
                                        changePage(currentPage + 1)
                                    }
                                    aria-label="Next page"
                                    className={styles.iconButton}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </section>


            {/* Footer */}

            {!loading && jobs.length > 0 && (
                <footer className={`flex flex-wrap items-center justify-between gap-2 border-t border-[rgb(var(--color-border))] pt-4 text-[11px] ${styles.subtle}`}>
                    <span className="inline-flex items-center gap-1.5">
                        <History className="h-3.5 w-3.5" />

                        History covers the latest {FETCH_LIMIT} generation jobs.
                    </span>

                    <span>
                        Refreshes every 5 seconds while this page is visible.
                    </span>
                </footer>
            )}
        </main>
    )
}