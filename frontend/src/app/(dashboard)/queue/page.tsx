'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
    Activity,
    AlertCircle,
    ArrowDownUp,
    ArrowUpRight,
    AudioLines,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Clock3,
    FileText,
    Layers3,
    ListFilter,
    Loader2,
    Mic,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    Search,
    X,
    XCircle,
} from 'lucide-react'

const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://localhost:8000'

type JobKind = 'tts' | 'asr' | 'extract'

type Job = {
    id: string
    kind: JobKind
    title: string
    status: string
    error: string | null
    updated_at: number
}

type StatusFilter =
    | 'all'
    | 'active'
    | 'queued'
    | 'completed'
    | 'failed'
    | 'cancelled'

type KindFilter = 'all' | JobKind
type SortOrder = 'newest' | 'oldest' | 'active'

const panel =
    'rounded-xl border border-border bg-bg-muted'

const secondary =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated px-3.5 py-2.5 text-xs font-medium transition hover:border-fg-subtle disabled:cursor-not-allowed disabled:opacity-40'

const primary =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-[#29221a] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40'

const activeStatuses = [
    'queued',
    'pending',
    'processing',
    'running',
    'loading_model',
]

const runningStatuses = [
    'processing',
    'running',
    'loading_model',
]

const kindConfig = {
    tts: {
        label: 'Speech generation',
        icon: AudioLines,
        href: '/jobs',
        link: 'Generation history',
    },
    asr: {
        label: 'Transcription',
        icon: FileText,
        href: '/transcriptions',
        link: 'Transcriptions',
    },
    extract: {
        label: 'Voice cloning',
        icon: Mic,
        href: '/voice-cloning',
        link: 'Voice cloning',
    },
}

function isActive(status: string) {
    return activeStatuses.includes(status)
}

function errorMessage(error: unknown) {
    return error instanceof Error
        ? error.message
        : 'The request could not be completed.'
}

function formatDate(timestamp: number) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return 'Not available'
    }

    const date = new Date(timestamp * 1000)

    return Number.isNaN(date.getTime())
        ? 'Not available'
        : date.toLocaleString()
}

function relativeTime(timestamp: number) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return 'Unknown'
    }

    const seconds = Math.max(
        0,
        Math.floor(Date.now() / 1000 - timestamp)
    )

    if (seconds < 60) return 'Just now'

    const minutes = Math.floor(seconds / 60)

    if (minutes < 60) return `${minutes}m ago`

    const hours = Math.floor(minutes / 60)

    if (hours < 24) return `${hours}h ago`

    return `${Math.floor(hours / 24)}d ago`
}

async function request<T>(
    path: string,
    method = 'GET'
): Promise<T> {
    const response = await fetch(
        `${base}/api/v1/queue${path}`,
        {
            method,
            credentials: 'include',
            cache: 'no-store',
        }
    )

    if (!response.ok) {
        const body = await response.json().catch(() => null)

        const message =
            typeof body?.detail === 'string'
                ? body.detail
                : typeof body?.message === 'string'
                    ? body.message
                    : `Request failed (${response.status})`

        throw new Error(message)
    }

    if (response.status === 204) {
        return undefined as T
    }

    return response.json()
}

function StatusBadge({ status }: { status: string }) {
    const config =
        status === 'completed'
            ? {
                label: 'Completed',
                icon: CheckCircle2,
                style: 'border-success/20 bg-success/10 text-success',
            }
            : status === 'failed'
                ? {
                    label: 'Failed',
                    icon: AlertCircle,
                    style: 'border-danger/20 bg-danger/10 text-danger',
                }
                : status === 'cancelled'
                    ? {
                        label: 'Cancelled',
                        icon: XCircle,
                        style: 'border-border bg-bg-elevated text-fg-muted',
                    }
                    : runningStatuses.includes(status)
                        ? {
                            label:
                                status === 'loading_model'
                                    ? 'Loading model'
                                    : status === 'running'
                                        ? 'Running'
                                        : 'Processing',
                            icon: Loader2,
                            style: 'border-warning/20 bg-warning/10 text-warning',
                        }
                        : {
                            label:
                                status.charAt(0).toUpperCase() +
                                status.slice(1).replace(/_/g, ' '),
                            icon: Clock3,
                            style: 'border-border bg-bg-elevated text-fg-muted',
                        }

    const Icon = config.icon

    return (
        <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium ${config.style}`}
        >
            <Icon
                className={`h-3.5 w-3.5 ${runningStatuses.includes(status)
                    ? 'animate-spin'
                    : ''
                    }`}
            />
            {config.label}
        </span>
    )
}

function MetricCard({
    label,
    value,
    description,
    icon: Icon,
    tone = 'text-fg-muted',
    loading,
}: {
    label: string
    value: number
    description: string
    icon: typeof Activity
    tone?: string
    loading: boolean
}) {
    return (
        <div className={`${panel} min-w-0 p-4`}>
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-fg-muted">
                    {label}
                </p>

                <Icon className={`h-4 w-4 ${tone}`} />
            </div>

            <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight tabular-nums">
                {loading
                    ? '—'
                    : value.toString().padStart(2, '0')}
            </p>

            <p className="mt-2 text-[11px] text-fg-subtle">
                {description}
            </p>
        </div>
    )
}

export default function QueuePage() {
    const [jobs, setJobs] = useState<Job[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [live, setLive] = useState(true)

    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')

    const [search, setSearch] = useState('')
    const [kind, setKind] = useState<KindFilter>('all')
    const [status, setStatus] =
        useState<StatusFilter>('all')
    const [sort, setSort] =
        useState<SortOrder>('newest')

    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(10)
    const tableScroll = useRef<HTMLDivElement>(null)

    const [expanded, setExpanded] =
        useState<string | null>(null)

    const [busy, setBusy] = useState<string | null>(null)
    const [lastUpdated, setLastUpdated] =
        useState<number | null>(null)

    const mounted = useRef(false)
    const requestId = useRef(0)
    const fetching = useRef(false)
    const operating = useRef(false)

    const refresh = useCallback(
        async (initial = false, manual = false) => {
            if (fetching.current || operating.current) {
                return
            }

            fetching.current = true
            const token = ++requestId.current

            if (initial) setLoading(true)
            if (manual) setRefreshing(true)

            try {
                const data = await request<Job[]>('')

                if (
                    mounted.current &&
                    token === requestId.current
                ) {
                    setJobs(data)
                    setLastUpdated(Date.now())
                    setError('')
                }
            } catch (err) {
                if (
                    mounted.current &&
                    token === requestId.current
                ) {
                    setError(errorMessage(err))
                }
            } finally {
                if (token === requestId.current) {
                    fetching.current = false

                    if (mounted.current) {
                        setLoading(false)
                        setRefreshing(false)
                    }
                }
            }
        },
        []
    )

    useEffect(() => {
        mounted.current = true

        void refresh(true)

        return () => {
            mounted.current = false
            requestId.current += 1
            fetching.current = false
        }
    }, [refresh])

    useEffect(() => {
        if (!live) return

        const timer = window.setInterval(() => {
            if (!document.hidden) {
                void refresh()
            }
        }, 3000)

        return () => window.clearInterval(timer)
    }, [live, refresh])

    async function action(
        job: Job,
        operation: 'cancel' | 'retry'
    ) {
        if (operating.current) return

        if (
            operation === 'cancel' &&
            !window.confirm('Cancel this queued job?')
        ) {
            return
        }

        operating.current = true

        // Invalidate any earlier polling response.
        requestId.current += 1
        fetching.current = false
        setRefreshing(false)

        const key = `${job.kind}-${job.id}`

        setBusy(key)
        setError('')
        setNotice('')

        try {
            await request(
                `/${job.kind}/${encodeURIComponent(job.id)}/${operation}`,
                'POST'
            )

            if (mounted.current) {
                setNotice(
                    operation === 'cancel'
                        ? 'Cancellation request accepted.'
                        : 'Retry request accepted.'
                )
            }

            const updated = await request<Job[]>('')

            if (mounted.current) {
                setJobs(updated)
                setLastUpdated(Date.now())
            }
        } catch (err) {
            if (mounted.current) {
                setError(errorMessage(err))
            }
        } finally {
            operating.current = false

            if (mounted.current) {
                setBusy(null)
            }
        }
    }

    const counts = useMemo(() => ({
        total: jobs.length,
        active: jobs.filter(j => isActive(j.status)).length,
        queued: jobs.filter(j => j.status === 'queued').length,
        running: jobs.filter(j =>
            runningStatuses.includes(j.status)
        ).length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        cancelled: jobs.filter(j => j.status === 'cancelled').length,
    }), [jobs])

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase()

        const result = jobs.filter(job => {
            if (kind !== 'all' && job.kind !== kind) {
                return false
            }

            if (
                status === 'active' &&
                !isActive(job.status)
            ) {
                return false
            }

            if (
                status !== 'all' &&
                status !== 'active' &&
                job.status !== status
            ) {
                return false
            }

            return [
                job.id,
                job.title,
                job.status,
                kindConfig[job.kind].label,
                job.error ?? '',
            ]
                .join(' ')
                .toLowerCase()
                .includes(query)
        })

        return result.sort((a, b) => {
            if (sort === 'active') {
                const priority =
                    Number(isActive(b.status)) -
                    Number(isActive(a.status))

                if (priority !== 0) return priority
            }

            return sort === 'oldest'
                ? a.updated_at - b.updated_at
                : b.updated_at - a.updated_at
        })
    }, [jobs, search, kind, status, sort])

    const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
    const currentPage = Math.min(page, totalPages)
    const start = (currentPage - 1) * pageSize
    const pageJobs = visible.slice(start, start + pageSize)

    useEffect(() => {
        setPage(previous => Math.min(previous, totalPages))
    }, [totalPages])

    useEffect(() => {
        setPage(1)
        setExpanded(null)
        if (tableScroll.current) tableScroll.current.scrollTop = 0
    }, [search, kind, status, sort, pageSize])

    function goToPage(next: number) {
        setPage(Math.max(1, Math.min(next, totalPages)))
        setExpanded(null)
        if (tableScroll.current) tableScroll.current.scrollTop = 0
    }

    const tabs: {
        id: StatusFilter
        label: string
        count: number
    }[] = [
            { id: 'all', label: 'All jobs', count: counts.total },
            { id: 'active', label: 'Active', count: counts.active },
            { id: 'queued', label: 'Queued', count: counts.queued },
            { id: 'completed', label: 'Completed', count: counts.completed },
            { id: 'failed', label: 'Failed', count: counts.failed },
            { id: 'cancelled', label: 'Cancelled', count: counts.cancelled },
        ]

    function clearFilters() {
        setSearch('')
        setKind('all')
        setStatus('all')
        setSort('newest')
    }

    return (
        <main className="w-full min-w-0 max-w-none space-y-6 px-4 py-5 sm:px-5 lg:px-6">

            {/* Page header */}
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-subtle">
                        <Layers3 className="h-3.5 w-3.5" />
                        Workspace / Job management
                    </p>

                    <h1 className="text-3xl font-semibold tracking-tight sm:text-[32px]">
                        Job queue
                    </h1>

                    <p className="mt-2 text-sm text-fg-muted">
                        Monitor and manage speech generation,
                        transcription and voice cloning workloads.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setLive(value => !value)}
                        className={secondary}
                        aria-pressed={live}
                    >
                        <span
                            className={`h-2 w-2 rounded-full ${live
                                ? 'bg-success'
                                : 'bg-fg-subtle'
                                }`}
                        />

                        {live ? 'Live updates' : 'Updates paused'}

                        {live
                            ? <Pause className="h-3.5 w-3.5" />
                            : <Play className="h-3.5 w-3.5" />}
                    </button>

                    <button
                        type="button"
                        disabled={loading || refreshing || !!busy}
                        onClick={() => void refresh(false, true)}
                        className={secondary}
                    >
                        <RefreshCw
                            className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''
                                }`}
                        />
                        Refresh
                    </button>

                    <Link href="/studio" className={primary}>
                        <AudioLines className="h-4 w-4" />
                        New generation
                    </Link>
                </div>
            </header>

            {/* Notifications */}
            {error && (
                <div
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

                    <span className="min-w-0 flex-1 break-words">
                        {error}
                    </span>

                    <button
                        type="button"
                        aria-label="Dismiss error"
                        onClick={() => setError('')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {notice && (
                <div
                    role="status"
                    className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/5 p-4 text-sm text-success"
                >
                    <CheckCircle2 className="h-4 w-4 shrink-0" />

                    <span className="flex-1">{notice}</span>

                    <button
                        type="button"
                        aria-label="Dismiss notification"
                        onClick={() => setNotice('')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Queue metrics */}
            <section
                aria-label="Queue statistics"
                className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
            >
                <MetricCard
                    label="Recent jobs"
                    value={counts.total}
                    description="Returned by the queue"
                    icon={Layers3}
                    loading={loading}
                />

                <MetricCard
                    label="Queued"
                    value={counts.queued}
                    description="Waiting to start"
                    icon={Clock3}
                    loading={loading}
                />

                <MetricCard
                    label="Processing"
                    value={counts.running}
                    description="Currently executing"
                    icon={Activity}
                    tone="text-warning"
                    loading={loading}
                />

                <MetricCard
                    label="Completed"
                    value={counts.completed}
                    description="Successfully finished"
                    icon={CheckCircle2}
                    tone="text-success"
                    loading={loading}
                />

                <MetricCard
                    label="Failed"
                    value={counts.failed}
                    description="Require attention"
                    icon={AlertCircle}
                    tone="text-danger"
                    loading={loading}
                />

                <MetricCard
                    label="Cancelled"
                    value={counts.cancelled}
                    description="Stopped jobs"
                    icon={XCircle}
                    loading={loading}
                />
            </section>

            {/* Queue table */}
            <section className={`${panel} overflow-hidden`}>

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
                    <div>
                        <h2 className="text-base font-semibold">
                            Queue activity
                        </h2>

                        <p className="mt-1 text-xs text-fg-muted">
                            View and manage recent jobs across all AI tools.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-fg-muted">
                        <span
                            className={`h-2 w-2 rounded-full ${counts.active
                                ? 'animate-pulse bg-warning'
                                : 'bg-fg-subtle'
                                }`}
                        />

                        {counts.active
                            ? `${counts.active} active jobs`
                            : 'No active jobs'}
                    </div>
                </div>

                {/* Status tabs */}
                <div className="flex gap-1 overflow-x-auto border-b border-border px-4 pt-3">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            aria-pressed={status === tab.id}
                            onClick={() => setStatus(tab.id)}
                            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-medium transition ${status === tab.id
                                ? 'border-accent text-fg'
                                : 'border-transparent text-fg-muted hover:text-fg'
                                }`}
                        >
                            {tab.label}

                            <span
                                className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${status === tab.id
                                    ? 'bg-accent/15'
                                    : 'bg-bg-elevated'
                                    }`}
                            >
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Search and filters */}
                <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">

                    <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />

                        <input
                            type="search"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search jobs by title, ID or error..."
                            aria-label="Search queue"
                            className="h-10 w-full rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-sm outline-none focus:border-accent"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">

                        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3">
                            <ListFilter className="h-4 w-4 text-fg-muted" />

                            <select
                                value={kind}
                                aria-label="Filter job type"
                                onChange={e =>
                                    setKind(e.target.value as KindFilter)
                                }
                                className="h-10 bg-transparent text-xs outline-none"
                            >
                                <option value="all">All job types</option>
                                <option value="tts">Speech generation</option>
                                <option value="asr">Transcription</option>
                                <option value="extract">Voice cloning</option>
                            </select>
                        </div>

                        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3">
                            <ArrowDownUp className="h-4 w-4 text-fg-muted" />

                            <select
                                value={sort}
                                aria-label="Sort jobs"
                                onChange={e =>
                                    setSort(e.target.value as SortOrder)
                                }
                                className="h-10 bg-transparent text-xs outline-none"
                            >
                                <option value="newest">Recently updated</option>
                                <option value="oldest">Oldest first</option>
                                <option value="active">Active first</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Loading / empty states */}
                {loading ? (
                    <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-fg-muted">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Loading job queue...
                    </div>
                ) : visible.length === 0 ? (
                    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">

                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-elevated">
                            <Layers3 className="h-7 w-7 text-fg-subtle" />
                        </div>

                        <h3 className="mt-4 text-sm font-semibold">
                            {jobs.length
                                ? 'No matching jobs'
                                : error
                                    ? 'Queue unavailable'
                                    : 'Your queue is empty'}
                        </h3>

                        <p className="mt-2 max-w-sm text-xs leading-5 text-fg-muted">
                            {jobs.length
                                ? 'Try changing your search or filters.'
                                : error
                                    ? 'Refresh the queue to try again.'
                                    : 'New generation, transcription and cloning jobs will appear here.'}
                        </p>

                        {jobs.length > 0 && (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className={`${secondary} mt-4`}
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                    <div
                        ref={tableScroll}
                        tabIndex={0}
                        role="region"
                        aria-label="Scrollable job queue"
                        className="max-h-[clamp(240px,45dvh,560px)] overflow-auto overscroll-contain"
                    >
                        <table className="w-full min-w-[850px] text-left">

                            <thead className="sticky top-0 z-10 border-b border-border bg-bg-elevated shadow-sm">
                                <tr className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
                                    <th className="px-5 py-3.5">Job</th>
                                    <th className="px-4 py-3.5">Type</th>
                                    <th className="px-4 py-3.5">Status</th>
                                    <th className="px-4 py-3.5">Updated</th>
                                    <th className="px-5 py-3.5 text-right">Actions</th>
                                </tr>
                            </thead>

                            {pageJobs.map(job => {
                                const key = `${job.kind}-${job.id}`
                                const config = kindConfig[job.kind]
                                const Icon = config.icon

                                const open = expanded === key
                                const working = busy === key

                                return (
                                    <tbody
                                        key={key}
                                        className="border-b border-border last:border-b-0"
                                    >
                                        <tr className="transition hover:bg-bg-elevated/50">

                                            <td className="px-5 py-4">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10">
                                                        <Icon className="h-5 w-5 text-[#a37336]" />
                                                    </div>

                                                    <div className="min-w-0">
                                                        <p
                                                            className="max-w-[320px] truncate text-sm font-medium"
                                                            title={job.title}
                                                        >
                                                            {job.title || 'Untitled job'}
                                                        </p>

                                                        <p className="mt-1 font-mono text-[11px] text-fg-subtle">
                                                            {job.id.slice(0, 8)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-4 py-4 text-xs text-fg-muted">
                                                {config.label}
                                            </td>

                                            <td className="px-4 py-4">
                                                <StatusBadge status={job.status} />
                                            </td>

                                            <td
                                                className="whitespace-nowrap px-4 py-4 text-xs text-fg-muted"
                                                title={formatDate(job.updated_at)}
                                            >
                                                {relativeTime(job.updated_at)}
                                            </td>

                                            <td className="px-5 py-4">
                                                <div className="flex items-center justify-end gap-2">

                                                    {job.kind !== 'tts' &&
                                                        job.status === 'queued' && (
                                                            <button
                                                                type="button"
                                                                disabled={!!busy}
                                                                onClick={() =>
                                                                    void action(job, 'cancel')
                                                                }
                                                                className="inline-flex items-center gap-1.5 rounded-lg border border-danger/20 px-3 py-2 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-40"
                                                            >
                                                                {working
                                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                    : <XCircle className="h-3.5 w-3.5" />}
                                                                Cancel
                                                            </button>
                                                        )}

                                                    {job.kind === 'asr' &&
                                                        ['failed', 'cancelled'].includes(job.status) && (
                                                            <button
                                                                type="button"
                                                                disabled={!!busy}
                                                                onClick={() =>
                                                                    void action(job, 'retry')
                                                                }
                                                                className={secondary}
                                                            >
                                                                <RotateCcw
                                                                    className={`h-3.5 w-3.5 ${working ? 'animate-spin' : ''
                                                                        }`}
                                                                />
                                                                Retry
                                                            </button>
                                                        )}

                                                    <Link
                                                        href={config.href}
                                                        title={config.link}
                                                        className={secondary}
                                                    >
                                                        Open
                                                        <ArrowUpRight className="h-3.5 w-3.5" />
                                                    </Link>

                                                    <button
                                                        type="button"
                                                        aria-expanded={open}
                                                        aria-label={`${open ? 'Hide' : 'Show'} job details`}
                                                        onClick={() =>
                                                            setExpanded(open ? null : key)
                                                        }
                                                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-fg-muted hover:bg-bg-elevated"
                                                    >
                                                        <ChevronDown
                                                            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''
                                                                }`}
                                                        />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>

                                        {open && (
                                            <tr>
                                                <td colSpan={5}>
                                                    <div className="space-y-4 border-t border-border bg-bg-elevated/50 p-5">

                                                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                                            {[
                                                                ['Job ID', job.id],
                                                                ['Job type', config.label],
                                                                ['Last updated', formatDate(job.updated_at)],
                                                                ['Status', job.status.replace(/_/g, ' ')],
                                                            ].map(([label, value]) => (
                                                                <div key={label} className="min-w-0">
                                                                    <p className="text-xs text-fg-muted">
                                                                        {label}
                                                                    </p>

                                                                    <p className="mt-1 break-all text-xs font-medium">
                                                                        {value}
                                                                    </p>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div>
                                                            <p className="text-xs text-fg-muted">
                                                                Job title
                                                            </p>

                                                            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                                                                {job.title}
                                                            </p>
                                                        </div>

                                                        {job.error && (
                                                            <div className="flex items-start gap-3 rounded-lg border border-danger/20 bg-danger/5 p-4">
                                                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />

                                                                <div className="min-w-0">
                                                                    <p className="text-xs font-semibold text-danger">
                                                                        Job error
                                                                    </p>

                                                                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-danger">
                                                                        {job.error}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                )
                            })}
                        </table>
                    </div>
                )}

                {/* Pagination stays outside the scrollable table */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-fg-muted">
                    <div className="space-y-1">
                        <p aria-live="polite">
                            Showing {visible.length ? start + 1 : 0}–{Math.min(start + pageSize, visible.length)} of {visible.length} matching jobs
                        </p>
                        <p className="text-[11px] text-fg-subtle">
                            {jobs.length} recent jobs · {lastUpdated ? `Updated at ${new Date(lastUpdated).toLocaleTimeString()}` : 'Not refreshed yet'}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2">
                            Rows per page
                            <select
                                value={pageSize}
                                onChange={e => { setPage(1); setPageSize(Number(e.target.value)) }}
                                className="h-9 rounded-lg border border-border bg-bg-elevated px-2 text-xs"
                            >
                                {[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}
                            </select>
                        </label>
                        <span className="px-2 tabular-nums">Page {currentPage} of {totalPages}</span>
                        {[
                            { label: 'First page', icon: ChevronsLeft, target: 1, disabled: currentPage === 1 },
                            { label: 'Previous page', icon: ChevronLeft, target: currentPage - 1, disabled: currentPage === 1 },
                            { label: 'Next page', icon: ChevronRight, target: currentPage + 1, disabled: currentPage === totalPages },
                            { label: 'Last page', icon: ChevronsRight, target: totalPages, disabled: currentPage === totalPages },
                        ].map(({ label, icon: Icon, target, disabled }) => (
                            <button key={label} type="button" aria-label={label} title={label}
                                disabled={disabled || loading}
                                onClick={() => goToPage(target)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-elevated hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Icon className="h-4 w-4" />
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {/* Workspace shortcuts */}
            <section className="grid gap-3 md:grid-cols-3">
                {Object.entries(kindConfig).map(([key, config]) => {
                    const Icon = config.icon

                    const total = jobs.filter(
                        job => job.kind === key
                    ).length

                    const active = jobs.filter(
                        job =>
                            job.kind === key &&
                            isActive(job.status)
                    ).length

                    return (
                        <Link
                            key={key}
                            href={config.href}
                            className={`${panel} group flex items-center gap-4 p-4 transition hover:border-accent/50`}
                        >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                                <Icon className="h-5 w-5 text-[#a37336]" />
                            </div>

                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-medium">
                                    {config.label}
                                </h3>

                                <p className="mt-1 text-xs text-fg-muted">
                                    {total} recent jobs · {active} active
                                </p>
                            </div>

                            <ArrowUpRight className="h-4 w-4 text-fg-subtle transition group-hover:text-fg" />
                        </Link>
                    )
                })}
            </section>

            <p className="text-xs leading-5 text-fg-subtle">
                Queue statistics reflect the recent jobs returned by
                the backend, not lifetime totals.
                {live
                    ? ' Automatic refresh runs every 3 seconds while this tab is visible.'
                    : ' Automatic refresh is currently paused.'}
            </p>
        </main>
    )
}
