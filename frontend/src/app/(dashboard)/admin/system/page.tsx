
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
    Activity,
    ArrowUpRight,
    AudioLines,
    Boxes,
    CheckCircle2,
    Cpu,
    HardDrive,
    ListChecks,
    Loader2,
    MemoryStick,
    RefreshCw,
    Sparkles,
    XCircle,
} from 'lucide-react'

import { api } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type {
    GenerationJobOut,
    SystemStatusResponse,
} from '@/types/api'

function percent(value: number) {
    return Number.isFinite(value) ? `${value.toFixed(0)}%` : '—'
}

function gigabytes(value: number) {
    return Number.isFinite(value)
        ? `${(value / 1024).toFixed(1)} GB`
        : '—'
}

function ProgressBar({
    value,
    tone = 'accent',
}: {
    value: number
    tone?: 'accent' | 'success' | 'warning'
}) {
    const safe = Number.isFinite(value)
        ? Math.min(100, Math.max(0, value))
        : 0

    const colors = {
        accent: 'bg-accent',
        success: 'bg-success',
        warning: 'bg-warning',
    }

    return (
        <div className="h-[5px] overflow-hidden rounded-full bg-bg-elevated">
            <div
                className={`h-full rounded-full ${colors[tone]} transition-[width] duration-300`}
                style={{ width: `${safe}%` }}
            />
        </div>
    )
}

function JobStatus({ status }: { status: string }) {
    const styles: Record<string, string> = {
        completed: 'text-success',
        failed: 'text-danger',
        running: 'text-accent',
        queued: 'text-warning',
        cancelled: 'text-fg-subtle',
    }

    return (
        <span
            className={`inline-flex items-center gap-1.5 text-xs capitalize ${styles[status] ?? 'text-fg-muted'
                }`}
        >
            {status === 'completed' ? (
                <CheckCircle2 size={13} />
            ) : status === 'failed' ? (
                <XCircle size={13} />
            ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
            )}
            {status}
        </span>
    )
}

function Diagnostics() {
    const [status, setStatus] = useState<SystemStatusResponse | null>(null)
    const [recent, setRecent] = useState<GenerationJobOut[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async (initial = false) => {
        if (initial) setLoading(true)
        else setRefreshing(true)

        setError(null)

        try {
            const [system, jobs] = await Promise.all([
                api.system.status(),
                api.generations.list(5),
            ])

            setStatus(system)
            setRecent(jobs)
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Unable to load dashboard data.'
            )
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [])

    useEffect(() => {
        void load(true)
    }, [load])

    const resources = status?.resources
    const worker = status?.worker

    const memoryPercent =
        resources && resources.ram_total_mb > 0
            ? (resources.ram_used_mb / resources.ram_total_mb) * 100
            : 0

    return (
        <main className="studio-page space-y-8">
            <header className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-7">
                <div>
                    <p className="studio-eyebrow mb-3">Administration / Diagnostics</p>
                    <h1 className="studio-heading">System Health</h1>
                    <p className="mt-2 text-sm text-fg-muted">
                        Your local production workspace at a glance.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading || refreshing}
                    className="studio-button-secondary"
                >
                    <RefreshCw
                        size={15}
                        className={refreshing ? 'animate-spin' : ''}
                    />
                    Refresh
                </button>
            </header>

            {error && (
                <div
                    role="alert"
                    className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
                >
                    {error}
                </div>
            )}

            {/* System status */}
            <section aria-labelledby="system-heading">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 id="system-heading" className="text-base font-semibold">
                            System overview
                        </h2>
                        <p className="mt-1 text-xs text-fg-subtle">
                            Resource usage on your local machine
                        </p>
                    </div>

                    <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
                        <span
                            className={`h-2 w-2 rounded-full ${worker?.alive ? 'bg-success' : 'bg-warning'
                                }`}
                        />
                        {loading
                            ? 'Checking worker'
                            : worker?.alive
                                ? 'Worker online'
                                : 'Worker unavailable'}
                    </span>
                </div>

                <div className="grid overflow-hidden rounded-xl border border-border bg-bg-muted md:grid-cols-3">
                    <div className="border-b border-border p-6 md:border-b-0 md:border-r">
                        <div className="mb-7 flex items-center justify-between">
                            <span className="text-xs text-fg-muted">CPU</span>
                            <Cpu size={17} className="text-fg-subtle" />
                        </div>

                        <div className="text-[30px] font-semibold tracking-tight text-fg">
                            {loading || !resources
                                ? '—'
                                : percent(resources.cpu_percent)}
                        </div>

                        <div className="mt-5">
                            <ProgressBar value={resources?.cpu_percent ?? 0} />
                        </div>

                        <p className="mt-3 text-xs text-fg-subtle">
                            Current processor utilization
                        </p>
                    </div>

                    <div className="border-b border-border p-6 md:border-b-0 md:border-r">
                        <div className="mb-7 flex items-center justify-between">
                            <span className="text-xs text-fg-muted">Memory</span>
                            <MemoryStick size={17} className="text-fg-subtle" />
                        </div>

                        <div className="text-[30px] font-semibold tracking-tight text-fg">
                            {loading || !resources
                                ? '—'
                                : gigabytes(resources.ram_used_mb)}
                        </div>

                        <div className="mt-5">
                            <ProgressBar
                                value={memoryPercent}
                                tone={memoryPercent > 85 ? 'warning' : 'accent'}
                            />
                        </div>

                        <p className="mt-3 text-xs text-fg-subtle">
                            {resources
                                ? `of ${gigabytes(resources.ram_total_mb)} total`
                                : 'System memory'}
                        </p>
                    </div>

                    <div className="p-6">
                        <div className="mb-7 flex items-center justify-between">
                            <span className="text-xs text-fg-muted">Available storage</span>
                            <HardDrive size={17} className="text-fg-subtle" />
                        </div>

                        <div className="text-[30px] font-semibold tracking-tight text-fg">
                            {loading || !resources
                                ? '—'
                                : gigabytes(resources.disk_free_mb)}
                        </div>

                        <div className="mt-5 flex h-[5px] items-center">
                            <span className="h-[5px] w-12 rounded-full bg-success" />
                        </div>

                        <p className="mt-3 text-xs text-fg-subtle">
                            Free space for models and audio
                        </p>
                    </div>
                </div>
            </section>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
                {/* Recent activity */}
                <section className="studio-panel min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-5 sm:px-6">
                        <div>
                            <h2 className="text-base font-semibold">Recent activity</h2>
                            <p className="mt-1 text-xs text-fg-subtle">
                                Your latest five speech generations
                            </p>
                        </div>

                        <Link
                            href="/jobs"
                            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
                        >
                            All jobs
                            <ArrowUpRight size={14} />
                        </Link>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-sm text-fg-muted">
                            <Loader2 size={17} className="animate-spin" />
                            Loading activity…
                        </div>
                    ) : recent.length === 0 ? (
                        <div className="px-6 py-16 text-center">
                            <AudioLines
                                size={27}
                                className="mx-auto text-fg-subtle"
                            />
                            <h3 className="mt-4 text-sm font-semibold">
                                No generations yet
                            </h3>
                            <p className="mt-2 text-xs text-fg-muted">
                                Create your first recording in Studio.
                            </p>
                            <Link
                                href="/studio"
                                className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-accent"
                            >
                                Open Studio
                                <ArrowUpRight size={14} />
                            </Link>
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {recent.map(job => (
                                <Link
                                    key={job.id}
                                    href={`/jobs?focus=${encodeURIComponent(job.id)}`}
                                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50 sm:px-6"
                                >
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-elevated">
                                        <AudioLines size={17} className="text-fg-muted" />
                                    </span>

                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] font-medium text-fg">
                                            {job.text.slice(0, 100) || 'Untitled generation'}
                                        </p>
                                        <p className="mt-1 text-[11px] text-fg-subtle">
                                            {formatRelativeTime(job.created_at)}
                                        </p>
                                    </div>

                                    <JobStatus status={job.status} />

                                    <ArrowUpRight
                                        size={15}
                                        className="hidden text-fg-subtle transition-colors group-hover:text-fg sm:block"
                                    />
                                </Link>
                            ))}
                        </div>
                    )}
                </section>

                <div className="space-y-5">
                    {/* Primary action */}
                    <section className="rounded-xl border border-border bg-bg-elevated p-6">
                        <div className="flex items-center gap-2 text-accent">
                            <Sparkles size={18} />
                            <span className="text-xs font-medium uppercase tracking-wider">
                                Start creating
                            </span>
                        </div>

                        <h2 className="mt-5 text-xl font-semibold tracking-tight">
                            Create your next recording.
                        </h2>

                        <p className="mt-2 text-sm leading-6 text-fg-muted">
                            Write a script, choose a voice, and generate speech locally.
                        </p>

                        <Link
                            href="/studio"
                            className="studio-button-primary mt-6 w-full"
                        >
                            Open Studio
                            <ArrowUpRight size={16} />
                        </Link>
                    </section>

                    {/* Shortcuts */}
                    <section className="studio-panel overflow-hidden">
                        <div className="border-b border-border px-5 py-4">
                            <h2 className="text-sm font-semibold">Workspace shortcuts</h2>
                        </div>

                        {[
                            {
                                href: '/voices',
                                label: 'Voice library',
                                icon: AudioLines,
                            },
                            {
                                href: '/projects',
                                label: 'Projects',
                                icon: ListChecks,
                            },
                            {
                                href: '/models',
                                label: 'Model registry',
                                icon: Boxes,
                            },
                        ].map(item => {
                            const Icon = item.icon

                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className="group flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0 hover:bg-bg-elevated/50"
                                >
                                    <Icon size={16} className="text-fg-muted" />
                                    <span className="flex-1 text-[13px] text-fg">
                                        {item.label}
                                    </span>
                                    <ArrowUpRight
                                        size={14}
                                        className="text-fg-subtle group-hover:text-accent"
                                    />
                                </Link>
                            )
                        })}
                    </section>

                    {/* Worker state */}
                    <section className="studio-panel p-5">
                        <div className="flex items-center gap-2">
                            <Activity size={16} className="text-fg-muted" />
                            <h2 className="text-sm font-semibold">Inference worker</h2>
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                            <span
                                className={`h-2 w-2 rounded-full ${worker?.alive ? 'bg-success' : 'bg-warning'
                                    }`}
                            />
                            <span className="text-sm font-medium">
                                {loading
                                    ? 'Checking status'
                                    : worker?.alive
                                        ? 'Online'
                                        : 'Not detected'}
                            </span>
                        </div>

                        <p className="mt-2 text-xs leading-5 text-fg-muted">
                            Worker availability is based on the backend heartbeat.
                            Long-running inference may delay heartbeat updates.
                        </p>

                        <Link
                            href="/models"
                            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent"
                        >
                            Manage models
                            <ArrowUpRight size={14} />
                        </Link>
                    </section>
                </div>
            </div>
        </main>
    )
}

export default function SystemHealthPage(){const [allowed,setAllowed]=useState<boolean|null>(null);useEffect(()=>{let active=true;api.auth.me().then(u=>{if(active)setAllowed(u.role==='admin')}).catch(()=>{if(active)setAllowed(false)});return()=>{active=false}},[]);return allowed===null?<p>Checking access…</p>:allowed?<Diagnostics/>:<p role="alert">Administrator access required.</p>}
