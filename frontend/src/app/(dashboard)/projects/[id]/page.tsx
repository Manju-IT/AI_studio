'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, Clock3, Cpu, Gauge, Loader2, Play, RefreshCw, X, XCircle } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { BenchmarkOut, BenchmarkSummary, ModelInstallationOut } from '@/types/api'

type Sample = 'short' | 'medium' | 'long'
const options: { id: Sample; title: string; description: string }[] = [{ id: 'short', title: 'Short', description: 'Quick response' }, { id: 'medium', title: 'Medium', description: 'Typical sentence' }, { id: 'long', title: 'Long', description: 'Extended speech' }]
const panel = 'rounded-xl border border-border bg-bg-muted'
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated px-4 text-xs font-semibold text-fg transition hover:border-border-strong disabled:opacity-50'
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const errorText = (err: unknown) => err instanceof ApiError || err instanceof Error ? err.message : 'Request failed.'
const numeric = (value: number | null | undefined, digits = 2) => value != null && Number.isFinite(value) ? value.toFixed(digits) : '—'
const memory = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value >= 1024 ? `${(value / 1024).toFixed(2)} GB` : `${Math.round(value)} MB`
const rtfTone = (value: number | null | undefined) => value == null || value <= 0 ? 'text-fg-muted' : value < 1 ? 'text-success' : value <= 2 ? 'text-warning' : 'text-danger'

export default function BenchmarksPage() {
    const [models, setModels] = useState<ModelInstallationOut[]>([])
    const [summary, setSummary] = useState<BenchmarkSummary[]>([])
    const [details, setDetails] = useState<BenchmarkOut[]>([])
    const [manifestId, setManifestId] = useState('')
    const [samples, setSamples] = useState<Sample[]>(['short', 'medium'])
    const [coldStart, setColdStart] = useState(true)
    const [loading, setLoading] = useState(true)
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [running, setRunning] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [detailError, setDetailError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [guide, setGuide] = useState(false)
    const requestRef = useRef(0)
    const selectedRef = useRef('')
    const mountedRef = useRef(false)
    const refresh = useCallback(async (initial = false) => {
        if (initial) setLoading(true); else setRefreshing(true)
        try {
            const [installations, summaries] = await Promise.all([api.models.list(), api.models.benchmarkSummary()])
            if (!mountedRef.current) return
            setModels(installations); setSummary(summaries)
            setManifestId(previous => { const next = installations.some(model => model.manifest_id === previous) ? previous : installations[0]?.manifest_id ?? ''; selectedRef.current = next; return next })
            setError(null)
        } catch (err) { if (mountedRef.current) setError(errorText(err)) }
        finally { if (mountedRef.current) { setLoading(false); setRefreshing(false) } }
    }, [])
    useEffect(() => { mountedRef.current = true; void refresh(true); return () => { mountedRef.current = false; requestRef.current++ } }, [refresh])
    const loadDetails = useCallback(async (id: string) => {
        const request = ++requestRef.current
        if (!id) { setDetails([]); setDetailsLoading(false); return }
        setDetailsLoading(true); setDetailError(null)
        try { const rows = await api.models.benchmarks(id); if (mountedRef.current && requestRef.current === request) setDetails(rows) }
        catch (err) { if (mountedRef.current && requestRef.current === request) { setDetails([]); setDetailError(errorText(err)) } }
        finally { if (mountedRef.current && requestRef.current === request) setDetailsLoading(false) }
    }, [])
    useEffect(() => { void loadDetails(manifestId) }, [manifestId, loadDetails])
    const current = models.find(model => model.manifest_id === manifestId)
    const warmSuccess = details.filter(row => row.success && !row.cold_start && row.real_time_factor > 0)
    const best = warmSuccess.length ? Math.min(...warmSuccess.map(row => row.real_time_factor)) : null
    const totalRuns = useMemo(() => summary.reduce((sum, row) => sum + row.runs, 0), [summary])
    const benchmarked = summary.filter(row => row.runs > 0).length
    function toggleSample(sample: Sample) { setSamples(previous => previous.includes(sample) ? previous.filter(item => item !== sample) : options.filter(item => previous.includes(item.id) || item.id === sample).map(item => item.id)) }
    async function runBenchmark() {
        if (!manifestId || !samples.length || running) return
        const requested = manifestId; const display = current?.definition.display_name ?? requested
        setRunning(true); setError(null); setNotice(null)
        try {
            const results = await api.models.runBenchmark({ manifest_id: requested, samples, include_cold_start: coldStart })
            if (!mountedRef.current) return
            const success = results.filter(row => row.success).length
            const firstError = results.find(row => !row.success)?.error_message
            setNotice(`${display}: ${success}/${results.length} tests succeeded.${firstError ? ` First failure: ${firstError}` : ''}`)
            await refresh()
            if (selectedRef.current === requested) await loadDetails(requested)
        } catch (err) { if (mountedRef.current) setError(errorText(err)) }
        finally { if (mountedRef.current) setRunning(false) }
    }
    return <main className="studio-page space-y-6 pb-12">
        <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/models" className="studio-eyebrow mb-3 inline-flex items-center gap-2 hover:text-accent"><ArrowLeft className="h-3.5 w-3.5" /> Models / Benchmarks</Link><h1 className="studio-heading">Model benchmarks</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">Measure local synthesis performance and compare inference speed, memory usage, and reliability.</p></div><button className={button} disabled={loading || refreshing || running} onClick={() => void refresh()}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh data</button></header>
        {error && <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger"><AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1 break-words">{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>}
        {notice && <div role="status" className="flex items-start gap-3 rounded-lg border border-border bg-bg-elevated p-4 text-sm text-fg"><CheckCircle2 className="h-4 w-4 shrink-0 text-accent" /><span className="flex-1 break-words">{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X className="h-4 w-4" /></button></div>}
        <section aria-label="Benchmark overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[{ title: 'Registered models', value: models.length, hint: 'Available in registry' }, { title: 'Models benchmarked', value: benchmarked, hint: 'With saved results' }, { title: 'Recorded runs', value: totalRuns, hint: 'Reported by summary API' }, { title: 'Best warm RTF', value: best == null ? '—' : numeric(best), hint: 'Selected model · lower is better' }].map(item => <div key={item.title} className={`${panel} p-5`}><p className="text-xs text-fg-muted">{item.title}</p><p className="mt-3 text-3xl font-semibold tabular-nums text-fg">{loading ? '—' : item.value}</p><p className="mt-2 text-xs text-fg-subtle">{item.hint}</p></div>)}</section>
        <section className={`${panel} overflow-hidden`}><div className="border-b border-border p-5"><div className="flex items-center gap-2"><Play className="h-4 w-4 text-accent" /><h2 className="text-base font-semibold text-fg">Run a benchmark</h2></div><p className="mt-1 text-xs leading-5 text-fg-muted">Select an installation and sample lengths. CPU and RAM usage may increase during testing.</p></div><div className="grid gap-6 p-5 lg:grid-cols-2"><div><label htmlFor="benchmark-model" className="mb-2 block text-xs font-semibold text-fg">Model installation</label><select id="benchmark-model" className="studio-input w-full" disabled={loading || running} value={manifestId} onChange={e => { selectedRef.current = e.target.value; setManifestId(e.target.value); setNotice(null) }}>{!models.length && <option value="">No registered models</option>}{models.map(model => <option key={model.manifest_id} value={model.manifest_id}>{model.definition.display_name}</option>)}</select>{current && <p className="mt-2 break-all text-xs text-fg-muted">{current.runtime} · {current.device.toUpperCase()} · {current.manifest_id}</p>}</div><div><p className="mb-2 text-xs font-semibold text-fg">Test samples</p><div className="grid grid-cols-3 gap-2">{options.map(item => { const active = samples.includes(item.id); return <button key={item.id} disabled={running} aria-pressed={active} onClick={() => toggleSample(item.id)} className={`rounded-lg border p-3 text-left transition disabled:opacity-50 ${active ? 'border-accent bg-accent/10' : 'border-border bg-bg-elevated'}`}><span className="block text-xs font-semibold text-fg">{item.title}</span><span className="mt-1 block text-[11px] text-fg-muted">{item.description}</span></button> })}</div><label className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-bg-elevated p-3"><input type="checkbox" checked={coldStart} disabled={running} onChange={e => setColdStart(e.target.checked)} className="mt-0.5 accent-current" /><span><span className="block text-xs font-semibold text-fg">Include cold-start test</span><span className="mt-1 block text-xs text-fg-muted">Measure initial model-loading overhead.</span></span></label></div></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4"><p className="text-xs text-fg-muted">{running ? 'Benchmark running. Keep this page open.' : 'Results are measured on your local machine.'}</p><button className={primary} disabled={loading || running || !manifestId || samples.length === 0} onClick={() => void runBenchmark()}>{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? 'Running benchmark...' : 'Run benchmark'}</button></div></section>
        <section className={`${panel} overflow-hidden`}><div className="border-b border-border p-5"><h2 className="text-base font-semibold text-fg">Model comparison</h2><p className="mt-1 text-xs text-fg-muted">Aggregate history reported by the benchmark API. Select a model to inspect individual runs.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[730px] text-left text-xs"><thead className="bg-bg-elevated text-fg-muted"><tr>{['Model', 'Runs', 'Best RTF', 'Worst RTF', 'Peak RAM', 'Last run'].map(name => <th key={name} className="px-5 py-3 font-semibold">{name}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.map(row => <tr key={row.manifest_id} className={row.manifest_id === manifestId ? 'bg-accent/5' : ''}><td className="px-5 py-3"><button className="text-left font-semibold text-fg hover:text-accent" onClick={() => { selectedRef.current = row.manifest_id; setManifestId(row.manifest_id) }}>{row.display_name}</button><p className="mt-1 font-mono text-fg-subtle">{row.manifest_id}</p></td><td className="px-5 py-3 text-fg">{row.runs}</td><td className={`px-5 py-3 font-semibold ${rtfTone(row.best_rtf)}`}>{numeric(row.best_rtf)}</td><td className="px-5 py-3 text-fg">{numeric(row.worst_rtf)}</td><td className="px-5 py-3 text-fg">{memory(row.peak_ram_mb)}</td><td className="px-5 py-3 text-fg-muted">{row.last_run_at ? formatRelativeTime(row.last_run_at) : '—'}</td></tr>)}{!loading && !summary.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-fg-muted">No benchmark summary available yet.</td></tr>}</tbody></table></div></section>
        <section className={`${panel} overflow-hidden`}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-5"><div><h2 className="text-base font-semibold text-fg">Detailed results</h2><p className="mt-1 text-xs text-fg-muted">{current?.definition.display_name ?? 'Select a model'} · {details.length} loaded records</p></div><Clock3 className="h-4 w-4 text-fg-subtle" /></div>{detailError && <div role="alert" className="m-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{detailError}</div>}{detailsLoading ? <div className="flex justify-center gap-2 p-10 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading results...</div> : !details.length ? <div className="p-10 text-center"><Gauge className="mx-auto h-7 w-7 text-accent" /><p className="mt-3 text-sm font-semibold text-fg">No saved results for this model</p><p className="mt-1 text-xs text-fg-muted">Run a benchmark to see measurements and errors.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-bg-elevated text-fg-muted"><tr>{['Sample', 'Start', 'Generation', 'Audio', 'RTF', 'Peak RAM', 'CPU', 'Result'].map(item => <th key={item} className="px-4 py-3 font-semibold">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{details.map(row => <tr key={row.id}><td className="px-4 py-3 font-medium capitalize text-fg">{row.sample_name}</td><td className="px-4 py-3 text-fg-muted">{row.cold_start ? 'Cold' : 'Warm'}</td><td className="px-4 py-3 text-fg">{row.success ? `${numeric(row.generation_time_seconds)} s` : '—'}</td><td className="px-4 py-3 text-fg">{row.success ? `${numeric(row.audio_duration_seconds)} s` : '—'}</td><td className={`px-4 py-3 font-semibold ${rtfTone(row.real_time_factor)}`}>{row.success && row.real_time_factor > 0 ? numeric(row.real_time_factor) : '—'}</td><td className="px-4 py-3 text-fg">{memory(row.peak_ram_mb)}</td><td className="px-4 py-3 text-fg">{row.cpu_percent == null ? '—' : `${numeric(row.cpu_percent, 1)}%`}</td><td className="max-w-[300px] px-4 py-3">{row.success ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Passed</span> : <span className="inline-flex items-start gap-1 text-danger"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words">{row.error_message || 'Failed'}</span></span>}</td></tr>)}</tbody></table></div>}</section>
        <section className={`${panel} overflow-hidden`}><button className="flex w-full items-center justify-between p-5 text-left text-sm font-semibold text-fg" aria-expanded={guide} onClick={() => setGuide(v => !v)}><span className="flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /> Understanding benchmark metrics</span><ChevronDown className={`h-4 w-4 transition-transform ${guide ? 'rotate-180' : ''}`} /></button>{guide && <div className="grid gap-4 border-t border-border p-5 text-xs leading-5 text-fg-muted sm:grid-cols-2"><p><strong className="block text-fg">Real-time factor</strong>Generation time divided by generated audio duration. Below 1 means faster than real time.</p><p><strong className="block text-fg">Cold versus warm</strong>Cold tests include loading overhead; warm tests measure subsequent synthesis.</p><p><strong className="block text-fg">Peak RAM</strong>Reported peak memory usage during a run, not simply model file size.</p><p><strong className="block text-fg">Comparability</strong>Compare similar sample lengths and runtime settings. Other processes may affect results.</p></div>}</section>
        <p className="text-xs text-fg-muted"><Cpu className="mr-1 inline h-3.5 w-3.5" /> These are local measurements, not standardized cross-device performance scores.</p>
    </main>
}
