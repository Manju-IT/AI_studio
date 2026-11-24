'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, FileAudio2, Loader2, RefreshCw, Search, XCircle } from 'lucide-react'
import { AudioPlayer } from '@/components/studio/AudioPlayer'
import { api, ApiError } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { GenerationJobOut } from '@/types/api'

type Filter = 'all' | 'completed' | 'processing' | 'failed'
const getError = (error: unknown) => error instanceof ApiError || error instanceof Error ? error.message : 'Unable to load generation history.'
const statuses = {
    completed: { label: 'Completed', icon: CheckCircle2, style: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' },
    failed: { label: 'Failed', icon: XCircle, style: 'border-rose-400/20 bg-rose-400/10 text-rose-300' },
    cancelled: { label: 'Cancelled', icon: XCircle, style: 'border-slate-700 bg-slate-800 text-slate-400' },
    loading_model: { label: 'Loading model', icon: Loader2, style: 'border-amber-400/20 bg-amber-400/10 text-amber-300' },
    running: { label: 'Running', icon: Loader2, style: 'border-amber-400/20 bg-amber-400/10 text-amber-300' },
    queued: { label: 'Queued', icon: Clock3, style: 'border-sky-400/20 bg-sky-400/10 text-sky-300' },
    processing: { label: 'Processing', icon: Loader2, style: 'border-amber-400/20 bg-amber-400/10 text-amber-300' },
    pending: { label: 'Pending', icon: Clock3, style: 'border-sky-400/20 bg-sky-400/10 text-sky-300' },
} as const

function JobCard({ job, expanded, onToggle }: { job: GenerationJobOut; expanded: boolean; onToggle: () => void }) {
    const status = statuses[job.status as keyof typeof statuses] ?? { label: job.status, icon: Clock3, style: 'border-slate-700 bg-slate-800 text-slate-300' }
    const StatusIcon = status.icon
    return <article className="overflow-hidden rounded-xl border border-slate-800 bg-[#171b23] transition-colors hover:border-slate-700">
        <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 flex-1 items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800"><FileAudio2 className="h-5 w-5 text-slate-400" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-medium text-slate-300">Generation</p><span className="text-xs text-slate-600">·</span><time dateTime={job.created_at} className="text-xs text-slate-500" title={new Date(job.created_at).toLocaleString()}>{formatRelativeTime(job.created_at)}</time></div><p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200 ${expanded ? '' : 'line-clamp-2'}`}>{job.text || 'No text supplied'}</p></div></div><span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${status.style}`}><StatusIcon className={`h-3.5 w-3.5 ${job.status === 'running' || job.status === 'loading_model' ? 'animate-spin' : ''}`} />{status.label}</span></div>
            {job.error_message && <div role="alert" className="mt-4 flex gap-2 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-xs leading-5 text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{job.error_message}</span></div>}
            {job.audio_asset && <div className="mt-4"><AudioPlayer asset={job.audio_asset} /></div>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3"><span className="font-mono text-[11px] text-slate-500">{job.id.slice(0, 8)}...</span><button type="button" onClick={onToggle} aria-expanded={expanded} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white">{expanded ? 'Hide details' : 'View details'}<ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button></div>
        </div>
        {expanded && <div className="grid gap-4 border-t border-slate-800 bg-[#141820] px-5 py-4 text-xs sm:grid-cols-2"><div><p className="text-slate-500">Job ID</p><p className="mt-1 break-all font-mono text-slate-300">{job.id}</p></div><div><p className="text-slate-500">Submitted</p><p className="mt-1 text-slate-300">{new Date(job.created_at).toLocaleString()}</p></div><div><p className="text-slate-500">Status</p><p className="mt-1 capitalize text-slate-300">{job.status}</p></div><div><p className="text-slate-500">Output</p><p className="mt-1 text-slate-300">{job.audio_asset ? 'Audio available' : 'No audio asset'}</p></div></div>}
    </article>
}

export default function JobsPage() {
    const [jobs, setJobs] = useState<GenerationJobOut[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<Filter>('all')
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
    const inFlight = useRef(false)

    const refresh = useCallback(async (initial = false) => {
        if (inFlight.current) return
        inFlight.current = true
        if (initial) setLoading(true)
        else setRefreshing(true)
        try {
            const data = await api.generations.list(50)
            setJobs(data)
            setError('')
        } catch (err) { setError(getError(err)) }
        finally { inFlight.current = false; setLoading(false); setRefreshing(false) }
    }, [])

    useEffect(() => {
        void refresh(true)
        const interval = window.setInterval(() => { if (!document.hidden) void refresh() }, 5000)
        return () => window.clearInterval(interval)
    }, [refresh])

    const counts = useMemo(() => ({ all: jobs.length, completed: jobs.filter(j => j.status === 'completed').length, processing: jobs.filter(j => !['completed', 'failed', 'cancelled'].includes(j.status)).length, failed: jobs.filter(j => j.status === 'failed').length }), [jobs])
    const visible = useMemo(() => jobs.filter(job => {
        const matches = `${job.id} ${job.text}`.toLowerCase().includes(query.trim().toLowerCase())
        if (!matches) return false
        if (filter === 'all') return true
        if (filter === 'processing') return !['completed', 'failed', 'cancelled'].includes(job.status)
        return job.status === filter
    }), [jobs, query, filter])

    return <main className="studio-light-tools mx-auto w-full max-w-7xl space-y-7 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">

        <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">Workspace / Inference</p><h1 className="text-2xl font-semibold tracking-tight text-white">Generation history</h1><p className="mt-2 text-sm text-slate-400">Track synthesis jobs, inspect errors, and listen to generated audio.</p></div><button type="button" disabled={loading || refreshing} onClick={() => void refresh()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-4 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? 'Refreshing' : 'Refresh jobs'}</button></header>
        {error && <div role="alert" className="flex gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        <section aria-label="Job summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[{ label: 'Recent jobs', value: counts.all }, { label: 'Completed', value: counts.completed }, { label: 'In progress', value: counts.processing }, { label: 'Failed', value: counts.failed }].map(item => <div key={item.label} className="rounded-xl border border-slate-800 bg-[#171b23] p-4 sm:p-5"><p className="text-xs font-medium text-slate-400">{item.label}</p><p className="mt-3 text-2xl font-semibold text-white">{loading ? '—' : item.value.toString().padStart(2, '0')}</p></div>)}</section>
        <section className="space-y-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-[#171b23] p-1">{([{ id: 'all', label: 'All' }, { id: 'completed', label: 'Completed' }, { id: 'processing', label: 'In progress' }, { id: 'failed', label: 'Failed' }] as const).map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`rounded-md px-3 py-2 text-xs font-medium ${filter === item.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>{item.label}</button>)}</div><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search text or job ID" aria-label="Search jobs" className="h-10 w-full rounded-lg border border-slate-700 bg-[#171b23] pl-9 pr-3 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-400 sm:w-64" /></div></div>
            {loading ? <div className="flex min-h-48 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-[#171b23] text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />Loading jobs...</div> : visible.length === 0 ? <div className="rounded-xl border border-slate-800 bg-[#171b23] px-5 py-14 text-center"><FileAudio2 className="mx-auto h-8 w-8 text-slate-500" /><h2 className="mt-3 text-sm font-semibold text-slate-200">{jobs.length ? 'No matching jobs' : 'No generations yet'}</h2><p className="mt-1 text-xs text-slate-500">{jobs.length ? 'Adjust the search or status filter.' : 'Submit a generation in Studio to see it here.'}</p></div> : <div className="space-y-3">{visible.map(job => <JobCard key={job.id} job={job} expanded={expanded.has(job.id)} onToggle={() => setExpanded(prev => { const next = new Set(prev); if (next.has(job.id)) next.delete(job.id); else next.add(job.id); return next })} />)}</div>}
            {!loading && jobs.length > 0 && <p className="px-1 text-xs text-slate-500">Showing {visible.length} of the latest {jobs.length} jobs · Refreshes every 5 seconds while this tab is visible</p>}
        </section>
    </main>
}
