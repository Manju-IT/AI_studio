'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, ArrowRight, CheckCircle2, ChevronDown, Cpu, Database, FolderSearch, Gauge, HardDrive, Loader2, Play, RefreshCw, Search, ShieldCheck, Square, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { ModelInstallationOut } from '@/types/api'

type Action = 'validate' | 'load' | 'unload'
type Filter = 'all' | 'loaded' | 'unloaded' | 'errors'
type Busy = { id: string; action: Action } | null
const panel = 'rounded-xl border border-border bg-bg-muted'
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated px-3.5 text-xs font-semibold text-fg transition hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50'
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
const errorMessage = (error: unknown) => error instanceof ApiError || error instanceof Error ? error.message : 'Request failed.'
const label = (value: string | null | undefined) => value ? ({ cpu: 'CPU', cuda: 'CUDA', piper: 'Piper', kokoro: 'Kokoro', qwen_mnn: 'Qwen MNN', fp16: 'FP16', fp32: 'FP32', q8: 'Q8', q4: 'Q4', int8: 'INT8' } as Record<string, string>)[value.toLowerCase()] ?? value.replace(/[_-]/g, ' ') : 'Default'

function Status({ value, kind }: { value: string; kind: 'runtime' | 'installation' }) {
    const failed = value === 'error' || value === 'invalid'
    const good = value === 'loaded' || value === 'validated' || value === 'installed'
    const pending = value === 'loading'
    const tone = failed ? 'border-danger/30 bg-danger/10 text-danger' : good ? 'border-success/30 bg-success/10 text-success' : pending ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border bg-bg-elevated text-fg-muted'
    return <span title={`${kind === 'runtime' ? 'Runtime' : 'Installation'} state: ${value}`} className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        {label(value)}
    </span>
}

function ModelRow({ model, busy, onAction }: { model: ModelInstallationOut; busy: Busy; onAction: (id: string, action: Action) => void }) {
    const [expanded, setExpanded] = useState(false)
    const isLoaded = model.loading_state === 'loaded'
    const isLoading = model.loading_state === 'loading'
    const isInvalid = model.installation_state === 'invalid'
    const canLoad = !busy && !isLoaded && !isLoading && !isInvalid
    const operation = busy?.id === model.manifest_id ? busy.action : null
    return <article className="border-b border-border last:border-b-0">
        <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-bg-elevated"><Cpu className="h-5 w-5 text-accent" /></div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-fg">{model.definition.display_name}</h3>{model.is_active_model && <span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">ACTIVE</span>}</div>
                    <p className="mt-1 break-all font-mono text-[11px] text-fg-subtle">{model.manifest_id}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">{[model.runtime, model.device, model.quantization].filter(Boolean).map((item, index) => <span key={index} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-fg-muted">{label(item)}</span>)}</div>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <Status kind="installation" value={model.installation_state} />
                <Status kind="runtime" value={model.loading_state} />
                <button className={button} disabled={!!busy} onClick={() => onAction(model.manifest_id, 'validate')}>{operation === 'validate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Validate</button>
                {isLoaded ? <button className={button} disabled={!!busy} onClick={() => onAction(model.manifest_id, 'unload')}>{operation === 'unload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Unload</button> : <button className={primary} disabled={!canLoad} onClick={() => onAction(model.manifest_id, 'load')}>{operation === 'load' || isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{isLoading ? 'Loading' : 'Load'}</button>}
                <button aria-label={`${expanded ? 'Hide' : 'Show'} details for ${model.definition.display_name}`} aria-expanded={expanded} className={button} onClick={() => setExpanded(v => !v)}><ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>
            </div>
        </div>
        {model.last_error && <div role="alert" className="mx-4 mb-4 flex gap-2 rounded-lg border border-danger/25 bg-danger/5 p-3 text-xs text-danger sm:mx-5"><AlertCircle className="h-4 w-4 shrink-0" /><span className="break-all">{model.last_error}</span></div>}
        {expanded && <div className="grid gap-4 border-t border-border bg-bg-elevated/40 p-5 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {([['Architecture', model.definition.architecture], ['Runtime', model.runtime], ['Device', model.device], ['Precision', model.quantization ?? 'Default'], ['Memory estimate', model.memory_estimate_mb == null ? 'Unknown' : `${model.memory_estimate_mb} MB`], ['Languages', model.definition.languages?.join(', ') || 'Not specified'], ['Installation', model.installation_state], ['Runtime state', model.loading_state]] as [string, string][]).map(([key, value]) => <div key={key}><dt className="text-fg-subtle">{key}</dt><dd className="mt-1 break-words font-medium text-fg">{value}</dd></div>)}
            <div className="sm:col-span-2 lg:col-span-4"><dt className="text-fg-subtle">Model path</dt><dd className="mt-1 break-all font-mono text-fg">{model.model_path || 'Not provided'}</dd></div>
        </div>}
    </article>
}

export default function ModelsPage() {
    const [models, setModels] = useState<ModelInstallationOut[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [busy, setBusy] = useState<Busy>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<Filter>('all')
    const mounted = useRef(false)
    const requestId = useRef(0)
    const operation = useRef(false)
    const fetchModels = useCallback(async (initial = false, silent = false) => {
        const id = ++requestId.current
        if (initial) setLoading(true)
        else if (!silent) setRefreshing(true)
        try {
            const result = await api.models.list()
            if (mounted.current && requestId.current === id) { setModels(result); if (!silent) setError('') }
        } catch (err) { if (mounted.current && requestId.current === id && !silent) setError(errorMessage(err)) }
        finally { if (mounted.current && requestId.current === id) { setLoading(false); setRefreshing(false) } }
    }, [])
    useEffect(() => { mounted.current = true; void fetchModels(true); return () => { mounted.current = false; requestId.current++ } }, [fetchModels])
    const hasPending = models.some(model => model.loading_state === 'loading')
    useEffect(() => { if (!hasPending) return; const timer = setInterval(() => { if (!operation.current) void fetchModels(false, true) }, 3000); return () => clearInterval(timer) }, [hasPending, fetchModels])
    async function handleAction(id: string, action: Action) {
        if (operation.current) return
        operation.current = true; setBusy({ id, action }); setError(''); setNotice('')
        try {
            if (action === 'validate') {
                const result = await api.models.validate(id)
                if (result.valid) setNotice(`${id}: validation passed.`)
                else setError(`${id}: ${result.errors?.join('; ') || 'Validation failed.'}`)
            } else if (action === 'load') { await api.models.load(id); setNotice(`${id}: load request accepted; waiting for backend status.`) }
            else { await api.models.unload(id); setNotice(`${id}: unload request accepted.`) }
            await fetchModels(false, true)
        } catch (err) { if (mounted.current) setError(errorMessage(err)) }
        finally { operation.current = false; if (mounted.current) setBusy(null) }
    }
    const counts = useMemo(() => ({ registered: models.length, ready: models.filter(m => ['installed', 'validated'].includes(m.installation_state)).length, loaded: models.filter(m => m.loading_state === 'loaded').length, issues: models.filter(m => m.loading_state === 'error' || m.installation_state === 'invalid').length }), [models])
    const filtered = useMemo(() => models.filter(model => {
        const searchable = [model.definition.display_name, model.manifest_id, model.runtime, model.device, model.quantization ?? ''].join(' ').toLowerCase()
        if (!searchable.includes(search.trim().toLowerCase())) return false
        if (filter === 'loaded') return model.loading_state === 'loaded'
        if (filter === 'unloaded') return model.loading_state === 'unloaded'
        if (filter === 'errors') return model.loading_state === 'error' || model.installation_state === 'invalid'
        return true
    }), [models, search, filter])
    return <main className="studio-page space-y-6 pb-12">
        <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="studio-eyebrow mb-3">Local inference / Models</p><h1 className="studio-heading">Model registry</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">Validate installations, monitor runtime state, and manage locally hosted speech models.</p></div><div className="flex flex-wrap gap-2"><Link href="/models/benchmarks" className={button}><Gauge className="h-4 w-4" /> Benchmarks <ArrowRight className="h-3.5 w-3.5" /></Link><button className={button} disabled={loading || refreshing || !!busy} onClick={() => void fetchModels()}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh</button></div></header>
        {error && <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger"><AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1 break-words">{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}
        {notice && <div role="status" className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-fg"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" /><span className="flex-1">{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X className="h-4 w-4" /></button></div>}
        <section aria-label="Registry overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([{ name: 'Registered', value: counts.registered, icon: Database, description: 'Known manifest entries' }, { name: 'Installed / validated', value: counts.ready, icon: HardDrive, description: 'Reported installation state' }, { name: 'Loaded', value: counts.loaded, icon: Activity, description: 'Available in runtime' }, { name: 'Issues', value: counts.issues, icon: AlertCircle, description: 'Invalid or runtime error' }] as const).map(item => { const Icon = item.icon; return <div key={item.name} className={`${panel} p-5`}><div className="flex items-center justify-between text-xs text-fg-muted"><span>{item.name}</span><Icon className="h-4 w-4 text-accent" /></div><p className="mt-3 text-3xl font-semibold tabular-nums text-fg">{loading ? '—' : item.value.toString().padStart(2, '0')}</p><p className="mt-2 text-xs text-fg-subtle">{item.description}</p></div> })}</section>
        <section className={`${panel} overflow-hidden`}><div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5"><div><h2 className="text-base font-semibold text-fg">Available installations</h2><p className="mt-1 text-xs text-fg-muted">{filtered.length} of {models.length} registered models</p></div><div className="flex flex-wrap items-center gap-2"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" /><input aria-label="Search models" type="search" placeholder="Search models..." value={search} onChange={e => setSearch(e.target.value)} className="studio-input w-full pl-9 sm:w-52" /></label><select aria-label="Filter model state" value={filter} onChange={e => setFilter(e.target.value as Filter)} className="studio-input"><option value="all">All states</option><option value="loaded">Loaded</option><option value="unloaded">Unloaded</option><option value="errors">Issues</option></select></div></div>
            {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading registry...</div> : filtered.length ? filtered.map(model => <ModelRow key={model.manifest_id} model={model} busy={busy} onAction={(id, action) => void handleAction(id, action)} />) : <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-8 text-center"><FolderSearch className="h-7 w-7 text-accent" /><p className="text-sm font-semibold text-fg">{models.length ? 'No matching models' : 'No models registered'}</p><p className="text-xs text-fg-muted">{models.length ? 'Change your search or filter.' : 'Check model registry configuration in the backend.'}</p></div>}
        </section><p className="text-xs leading-5 text-fg-muted"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Installation status and runtime status are separate. A successful API load request is not proof that model weights loaded successfully.</p>
    </main>
}
