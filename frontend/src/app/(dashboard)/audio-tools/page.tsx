'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Download, FileAudio2, Layers3, Loader2, RefreshCw, Scissors, Search, X } from 'lucide-react'
import './audio-workspace.css'
import { AudioPlayer } from '@/components/studio/AudioPlayer'
import { api, ApiError } from '@/lib/api'
import { formatDuration } from '@/lib/utils'
import type { AudioAssetOut } from '@/types/api'

type Tab = 'trim' | 'merge' | 'export' | 'process'
const operations = {normalize: ['Peak normalization (dBFS)', -1, -30, 0], gain: ['Gain (dB)', 0, -30, 12], fade_in: ['Fade in (seconds)', 1, 0.01, 10], fade_out: ['Fade out (seconds)', 1, 0.01, 10], trim_silence: ['Trim edge silence (dBFS)', -40, -80, -10], mono: ['Convert to mono', 0, 0, 0], stereo: ['Convert to stereo', 0, 0, 0]} as const
const field = 'studio-input'
const button = 'studio-button-primary'
const getError = (error: unknown) => error instanceof ApiError || error instanceof Error ? error.message : 'Audio operation failed.'
const filename = (asset: AudioAssetOut) => asset.title || asset.original_filename || 'Untitled audio'

export default function AudioToolsPage() {
    const [operation, setOperation] = useState<keyof typeof operations>('normalize')
    const [value, setValue] = useState(-1)
    const [assets, setAssets] = useState<AudioAssetOut[]>([])
    const [selection, setSelection] = useState<string[]>([])
    const [tab, setTab] = useState<Tab>('trim')
    const [query, setQuery] = useState('')
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(6)
    const [format, setFormat] = useState('all')
    const [preview, setPreview] = useState(false)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [result, setResult] = useState<AudioAssetOut | null>(null)
    const [start, setStart] = useState(0)
    const [end, setEnd] = useState(0)
    const [trimTitle, setTrimTitle] = useState('')
    const [mergeTitle, setMergeTitle] = useState('')
    const [pauseMs, setPauseMs] = useState(350)
    const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('mp3')

    const refresh = useCallback(async (initial = false) => {
        if (initial) setLoading(true)
        else setRefreshing(true)
        setError('')
        try {
            const list = await api.audio.list(100)
            setAssets(list)
            setSelection(prev => prev.filter(id => list.some(asset => asset.id === id)))
        } catch (err) { setError(getError(err)) }
        finally { setLoading(false); setRefreshing(false) }
    }, [])

    useEffect(() => { void refresh(true) }, [refresh])

    const visible = useMemo(() => assets.filter(asset => (format === 'all' || asset.format.toLowerCase() === format) && `${filename(asset)} ${asset.format}`.toLowerCase().includes(query.toLowerCase())), [assets, query, format])
    const pages = Math.max(1, Math.ceil(visible.length / pageSize))
    const current = Math.min(page, pages)
    const paged = visible.slice((current - 1) * pageSize, current * pageSize)
    const chosen = useMemo(() => selection.map(id => assets.find(asset => asset.id === id)).filter((asset): asset is AudioAssetOut => Boolean(asset)), [assets, selection])
    const single = chosen.length === 1 ? chosen[0] : null
    const trimValid = single !== null && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= single.duration_seconds
    const pauseValid = Number.isInteger(pauseMs) && pauseMs >= 0 && pauseMs <= 5000

    function toggle(asset: AudioAssetOut) {
        setSelection(prev => {
            if (prev.includes(asset.id)) return prev.filter(id => id !== asset.id)
            return tab === 'merge' ? [...prev, asset.id] : [asset.id]
        })
        if (tab !== 'merge') {
            setStart(0)
            setEnd(asset.duration_seconds)
        }
        setError('')
    }

    function switchTab(next: Tab) {
        setTab(next)
        setPreview(false)
        setError('')
        if (next !== 'merge' && selection.length > 1) {
            const id = selection[0]
            setSelection([id])
            const asset = assets.find(item => item.id === id)
            if (asset) { setStart(0); setEnd(asset.duration_seconds) }
        }
    }

    async function run() {
        if (busy) return
        if (tab === 'trim' && !trimValid) { setError('Select one file and enter a valid trim range within its duration.'); return }
        if (tab === 'merge' && (chosen.length < 2 || !pauseValid)) { setError('Select at least two files and a pause between 0 and 5000 ms.'); return }
        if ((tab === 'export' || tab === 'process') && !single) { setError('Select exactly one recording.'); return }
        setBusy(true); setError(''); setResult(null)
        try {
            let output: AudioAssetOut
            if (tab === 'trim') {
                output = await api.audio.trim({ audio_asset_id: single!.id, start_seconds: start, end_seconds: end, title: trimTitle.trim() || undefined })
            } else if (tab === 'merge') {
                output = await api.audio.merge({ audio_asset_ids: chosen.map(asset => asset.id), pause_ms: pauseMs, title: mergeTitle.trim() || undefined })
            } else if (tab === 'process') {
                output = await api.audio.process({audio_asset_id: single!.id, operation, value})
            } else {
                output = await api.audio.export({ audio_asset_id: single!.id, format: exportFormat })
            }
            setResult(output)
            setSelection([])
            setPreview(false)
            await refresh()
        } catch (err) { setError(getError(err)) }
        finally { setBusy(false) }
    }

    const tabs = [{ id: 'trim' as const, title: 'Trim audio', icon: Scissors, detail: 'Extract a precise segment' }, { id: 'merge' as const, title: 'Merge files', icon: Layers3, detail: 'Join clips in order' }, { id: 'export' as const, title: 'Export', icon: Download, detail: 'Convert audio format' }, {id: 'process' as const, title: 'Enhance', icon: FileAudio2, detail: 'Non-destructive audio processing'}]

    return <main className="studio-page audio-workspace space-y-7">
        <div className="aw-hero"><div><p className="aw-kicker">AUDIO INTELLIGENCE / POST-PRODUCTION</p><h1>Sound, <em>refined.</em></h1><p>Shape every recording with precise editing, seamless assembly and local audio processing.</p><a href="#audio-workbench" className="aw-cta">Open workbench ↗</a></div><div className="aw-art" aria-hidden="true"><div className="aw-orbit"/><div className="aw-display"><span>POST-PRODUCTION / SIGNAL</span><div className="aw-wave">{Array.from({length:48},(_,i)=><i key={i} style={{height:`${8+88*Math.abs(Math.sin(i*.37)*Math.cos(i*.14))}%`,animationDelay:`${-i*.08}s`}}/>)}</div><div className="aw-track"><b/><b/><b/></div><small>TRIM · MERGE · EXPORT · ENHANCE</small></div></div></div>
        <div className="aw-stats">{[['Recent recordings',assets.length],['Selected clips',chosen.length],['Library duration',formatDuration(assets.reduce((n,a)=>n+a.duration_seconds,0))]].map(([label,n])=><div key={label}><span>{label}</span><strong>{n}</strong></div>)}</div>
        <div className="aw-tools" id="audio-workbench">{tabs.map(item=><button type="button" key={item.id} disabled={busy} aria-pressed={tab===item.id} onClick={()=>switchTab(item.id)} className={tab===item.id?'active':''}><item.icon size={22}/><strong>{item.title}</strong><span>{item.detail}</span></button>)}</div>
        {error && <div role="alert" className="flex gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}<button onClick={() => setError('')} aria-label="Dismiss error" className="ml-auto"><X className="h-4 w-4" /></button></div>}
        <div className="aw-grid">
            <section className="aw-panel">
                <div className="border-b border-border p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-fg">Audio library</h2><p className="mt-1 text-xs text-fg-subtle">{assets.length} files · {selection.length} selected</p></div><button type="button" disabled={refreshing || busy} onClick={() => void refresh()} aria-label="Refresh audio" className="rounded-lg border border-border-strong p-2 text-fg-muted hover:bg-bg-elevated disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></div><div className="relative mt-4"><Search className="absolute left-3 top-3 h-4 w-4 text-fg-subtle" /><input value={query} onChange={e => {setQuery(e.target.value);setPage(1)}} placeholder="Search audio files" aria-label="Search audio files" className={`${field} pl-9`} /></div></div>
                <div className="aw-filter"><label>Format <select value={format} onChange={e=>{setFormat(e.target.value);setPage(1)}}><option value="all">All formats</option>{Array.from(new Set(assets.map(a=>a.format.toLowerCase()))).map(f=><option key={f} value={f}>{f.toUpperCase()}</option>)}</select></label><label>Per page <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1)}}>{[6,12,24].map(n=><option key={n}>{n}</option>)}</select></label></div><div className="aw-rows">
                    {loading && <div className="flex justify-center gap-2 p-10 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading audio...</div>}
                    {!loading && visible.length === 0 && <div className="p-10 text-center"><FileAudio2 className="mx-auto h-7 w-7 text-fg-subtle" /><p className="mt-3 text-sm text-fg-muted">{assets.length ? 'No matching files' : 'No audio files yet'}</p><p className="mt-1 text-xs text-fg-subtle">{assets.length ? 'Try another search.' : 'Generate audio in Studio to get started.'}</p></div>}
                    {!loading && paged.map(asset => { const index = selection.indexOf(asset.id); const checked = index >= 0; return <label key={asset.id} className={`mb-1 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 transition-colors ${checked ? 'border-accent/40 bg-accent/10' : 'border-transparent hover:bg-bg-elevated/60'}`}><input type="checkbox" checked={checked} disabled={busy} onChange={() => toggle(asset)} className="h-4 w-4 accent-accent" /><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-elevated"><FileAudio2 className="h-4 w-4 text-fg-muted" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-fg" title={filename(asset)}>{filename(asset)}</p><p className="mt-1 text-xs text-fg-subtle">{formatDuration(asset.duration_seconds)} · {asset.format.toUpperCase()}</p></div>{tab === 'merge' && checked && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-xs font-semibold text-accent">{index + 1}</span>}{checked && tab !== 'merge' && <Check className="h-4 w-4 text-accent" />}</label> })}
                </div>
                <div className="aw-pagination"><span>{visible.length ? (current-1)*pageSize+1 : 0}–{Math.min(current*pageSize,visible.length)} of {visible.length}</span><button disabled={current===1} onClick={()=>setPage(current-1)}>←</button><span>{current} / {pages}</span><button disabled={current===pages} onClick={()=>setPage(current+1)}>→</button></div>
                {selection.length > 0 && <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-fg-muted"><span>{selection.length} selected</span><button type="button" disabled={busy} onClick={() => setSelection([])} className="font-medium text-accent hover:text-accent-hover">Clear selection</button></div>}
            </section>

            <section className="aw-panel">
                <div className="aw-panel-head"><span className="aw-kicker">02 / EDITING CONSOLE</span><span>Non-destructive operations</span></div>
                <div className="space-y-5 p-5 sm:p-6"><div><h2 className="text-base font-semibold text-fg">{tabs.find(item => item.id === tab)?.title}</h2><p className="mt-1 text-xs text-fg-muted">{tabs.find(item => item.id === tab)?.detail}</p></div>
                    {single && <div className="aw-preview"><button type="button" onClick={()=>setPreview(v=>!v)}>{preview?'Hide source preview':'Listen to source recording'}</button>{preview && <AudioPlayer key={single.id} asset={single}/>}</div>}
                    {tab === 'trim' && single && single.duration_seconds > 0 && <div className="aw-range"><div className="aw-range-track"><b style={{left:`${Math.max(0,Math.min(100,(Number.isFinite(start)?start:0)/single.duration_seconds*100))}%`,width:`${trimValid?(end-start)/single.duration_seconds*100:0}%`}}/></div><label>Start <input type="range" min={0} max={single.duration_seconds} step="any" value={Number.isFinite(start)?start:0} disabled={busy} onChange={e=>setStart(Number(e.target.value))}/></label><label>End <input type="range" min={0} max={single.duration_seconds} step="any" value={Number.isFinite(end)?end:0} disabled={busy} onChange={e=>setEnd(Number(e.target.value))}/></label><small>Selected interval · {trimValid?formatDuration(end-start):'Invalid range'}</small></div>}
                    {tab === 'trim' && <><div className="rounded-lg border border-border bg-bg p-3 text-xs text-fg-muted">{single ? <><p className="truncate font-medium text-fg">{filename(single)}</p><p className="mt-1">Duration: {formatDuration(single.duration_seconds)}</p></> : 'Select one audio file from the library.'}</div><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-xs text-fg-muted">Start time (seconds)<input type="number" step="0.1" min={0} max={single?.duration_seconds} value={Number.isFinite(start) ? start : ''} onChange={e => setStart(e.target.value === '' ? NaN : Number(e.target.value))} className={field} disabled={!single || busy} /></label><label className="space-y-1.5 text-xs text-fg-muted">End time (seconds)<input type="number" step="0.1" min={0} max={single?.duration_seconds} value={Number.isFinite(end) ? end : ''} onChange={e => setEnd(e.target.value === '' ? NaN : Number(e.target.value))} className={field} disabled={!single || busy} /></label></div><label className="block space-y-1.5 text-xs text-fg-muted">Output title (optional)<input value={trimTitle} onChange={e => setTrimTitle(e.target.value)} placeholder="Trimmed recording" className={field} /></label>{single && <p className={`text-xs ${trimValid ? 'text-fg-muted' : 'text-warning'}`}>{trimValid ? `Output duration: ${formatDuration(end - start)}` : 'Enter an end time greater than the start and within the file duration.'}</p>}</>}
                    {tab === 'merge' && <><div className="rounded-lg border border-border bg-bg p-3"><p className="text-xs font-medium text-fg-muted">Merge sequence ({chosen.length} files)</p>{chosen.length === 0 ? <p className="mt-2 text-xs text-fg-subtle">Select at least two files. Files merge in selection order.</p> : <ol className="mt-3 space-y-2">{chosen.map((asset, index) => <li key={asset.id} className="flex items-center gap-2 text-xs text-fg-muted"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent/15 text-accent">{index + 1}</span><span className="min-w-0 flex-1 truncate">{filename(asset)}</span><button type="button" disabled={busy || index === 0} onClick={() => setSelection(prev => { const next = [...prev];[next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })} aria-label={`Move ${filename(asset)} up`} className="text-fg-muted hover:text-fg disabled:opacity-30">↑</button><button type="button" disabled={busy || index === chosen.length - 1} onClick={() => setSelection(prev => { const next = [...prev];[next[index + 1], next[index]] = [next[index], next[index + 1]]; return next })} aria-label={`Move ${filename(asset)} down`} className="text-fg-muted hover:text-fg disabled:opacity-30">↓</button></li>)}</ol>}</div><label className="block space-y-1.5 text-xs text-fg-muted">Pause between clips (milliseconds)<input type="number" min={0} max={5000} step={50} value={Number.isFinite(pauseMs) ? pauseMs : ''} onChange={e => setPauseMs(e.target.value === '' ? NaN : Number(e.target.value))} className={field} /></label><label className="block space-y-1.5 text-xs text-fg-muted">Output title (optional)<input value={mergeTitle} onChange={e => setMergeTitle(e.target.value)} placeholder="Combined recording" className={field} /></label></>}
                    {tab === 'process' && <><p className="text-xs text-fg-muted">{single ? `${filename(single)} · ${single.sample_rate} Hz · ${single.channels} channels` : 'Select one recording.'}</p><label className="block text-xs text-fg-muted">Operation<select className={field} value={operation} onChange={e => {const op = e.target.value as keyof typeof operations; setOperation(op); setValue(operations[op][1])}}>{Object.entries(operations).map(([key, spec]) => <option key={key} value={key}>{spec[0]}</option>)}</select></label>{operations[operation][2] !== operations[operation][3] && <input aria-label={operations[operation][0]} className={field} type="number" step="0.01" min={operations[operation][2]} max={operations[operation][3]} value={value} onChange={e => setValue(e.target.valueAsNumber)} />}</>}
                    {tab === 'export' && <><div className="rounded-lg border border-border bg-bg p-3 text-xs text-fg-muted">{single ? filename(single) : 'Select one audio file to export.'}</div><label className="block space-y-1.5 text-xs text-fg-muted">Output format<select value={exportFormat} onChange={e => setExportFormat(e.target.value as 'wav' | 'mp3')} className={field}><option value="mp3">MP3</option><option value="wav">WAV</option></select></label><p className="text-xs leading-5 text-fg-subtle">MP3 conversion requires FFmpeg to be available to the backend.</p></>}
                    <button type="button" onClick={() => void run()} disabled={busy || (tab === 'trim' && !trimValid) || (tab === 'merge' && (chosen.length < 2 || !pauseValid)) || ((tab === 'export' || tab === 'process') && !single) || (tab === 'process' && (!Number.isFinite(value) || value < operations[operation][2] || value > operations[operation][3]))} className={`${button} aw-run w-full`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === 'trim' ? <Scissors className="h-4 w-4" /> : tab === 'merge' ? <Layers3 className="h-4 w-4" /> : <Download className="h-4 w-4" />}{busy ? 'Processing...' : tab === 'trim' ? 'Trim audio' : tab === 'merge' ? 'Merge selected files' : tab === 'process' ? 'Process audio' : 'Export audio'}</button>
                </div>
            </section>
        </div>
        {result && <section aria-live="polite" className="rounded-xl border border-success/30 bg-bg-muted p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold text-fg"><Check className="h-4 w-4 text-success" />Operation complete</p><p className="mt-1 text-xs text-fg-muted">{filename(result)}</p></div><button type="button" onClick={() => setResult(null)} aria-label="Dismiss result" className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button></div><AudioPlayer asset={result} /></section>}
    </main>
}
