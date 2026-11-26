'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import './project-workspace.css'
import { api } from '@/lib/api'
import { ModelVoiceSelector } from '@/components/studio/ModelVoiceSelector'
import { AudioPlayer } from '@/components/studio/AudioPlayer'
import type { Script, Segment } from '@/types/project-editor'
import type { ProjectOut, ModelInstallationOut, VoiceOut, GenerationJobOut, AudioAssetOut } from '@/types/api'
const button = 'rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm font-medium disabled:opacity-50'
const primary = 'rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
const terminal = ['completed', 'failed', 'cancelled']
export default function ProjectEditor() {
    const { id } = useParams<{ id: string }>()
    const [project, setProject] = useState<ProjectOut | null>(null)
    const [script, setScript] = useState<Script | null>(null)
    const [models, setModels] = useState<ModelInstallationOut[]>([])
    const [voices, setVoices] = useState<VoiceOut[]>([])
    const [jobs, setJobs] = useState<Record<string, GenerationJobOut>>({})
    const [dirty, setDirty] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [exported, setExported] = useState<AudioAssetOut | null>(null)
    const [bulk, setBulk] = useState('')
    const [dialogue, setDialogue] = useState(false)
    const [selected, setSelected] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState('all')
    const [page, setPage] = useState(1)
    const [size, setSize] = useState(6)
    const [showImport, setShowImport] = useState(false)
    const [preview, setPreview] = useState<string | null>(null)
    useEffect(() => {
        let alive = true
        setSelected(null); setQuery(''); setFilter('all'); setPage(1); setPreview(null); setBulk(''); setShowImport(false); setScript(null); setProject(null); setDirty(false); setJobs({}); setExported(null); setError('')
        Promise.all([api.projects.get(id), api.projects.script(id), api.models.list(), api.voices.list()]).then(([p, s, m, v]) => { if (alive) { setProject(p); setScript(s); setModels(m); setVoices(v) } }).catch(e => { if (alive) setError(String(e.message ?? e)) })
        return () => { alive = false }
    }, [id])
    const jobIds = (script?.segments ?? []).map(s => s.job_id).filter(Boolean).join(',')
    useEffect(() => {
        let alive = true, running = false
        const finished = new Set<string>()
        async function poll() {
            if (running || !jobIds) return
            running = true
            try { const ids = Array.from(new Set(jobIds.split(','))).filter(j => !finished.has(j)); for (let i = 0; i < ids.length && alive; i += 5) { const results = await Promise.allSettled(ids.slice(i, i + 5).map(j => api.generations.get(j))); if (!alive) return; const updates: Record<string, GenerationJobOut> = {}; for (const result of results) { if (result.status === 'fulfilled') { const j = result.value; updates[j.id] = j; if (terminal.includes(j.status)) finished.add(j.id) } else setError(String(result.reason?.message ?? result.reason)) } setJobs(old => ({ ...old, ...updates })) } }
            catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)) } finally { running = false }
        }
        void poll(); const timer = setInterval(poll, 2500); return () => { alive = false; clearInterval(timer) }
    }, [jobIds])
    useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty])
    function edit(segments: Segment[]) { setScript(s => s ? { ...s, segments } : s); setDirty(true); setExported(null) }
    function patch(index: number, changes: Partial<Segment>) { if (!script) return; edit(script.segments.map((s, i) => i === index ? { ...s, ...changes, ...(Object.keys(changes).some(k => ['text', 'model_installation_id', 'voice_id', 'language'].includes(k)) ? { job_id: null } : {}) } : s)) }
    function add() { if (!script || script.segments.length >= 100) return; const model = models.find(m => m.generation_contract?.available && m.installation_state !== 'invalid'); const newId = crypto.randomUUID(); setSelected(newId); setQuery(''); setFilter('all'); setPage(Math.floor(script.segments.length / size) + 1); edit([...script.segments, { id: newId, text: '', model_installation_id: model?.id ?? null, voice_id: null, language: model?.definition.languages[0] ?? 'en', pause_ms: 300, job_id: null }]) }
    function move(i: number, d: number) { if (!script) return; const rows = [...script.segments];[rows[i], rows[i + d]] = [rows[i + d], rows[i]]; edit(rows) }
    async function action(fn: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
    async function save() { if (!script) return; await action(async () => { setScript(await api.projects.saveScript(id, script)); setDirty(false); setNotice('Script saved.') }) }
    async function generate(s: Segment) { if (!script) return; await action(async () => { setScript(await api.projects.generateSegment(id, s.id, script.revision)); setExported(null); setNotice('Segment queued.') }) }
    function importScript() {
        if (!script) return
        const model = models.find(m => m.generation_contract?.available && m.installation_state !== 'invalid')
        const lines = bulk.split(dialogue ? /\r?\n/ : /\r?\n\s*\r?\n/).map(x => x.trim()).filter(Boolean)
        if (!lines.length || lines.length + script.segments.length > 100) { setError('Import must fit within 100 segments.'); return }
        const rows: Segment[] = []
        for (const line of lines) {
            const match = dialogue ? line.match(/^([^:]{1,100}):\s*(.+)$/) : null
            if (dialogue && !match) { setError('Use Speaker: text on every dialogue line.'); return }
            const text = match ? match[2] : line
            if (text.length > 50000) { setError('Each segment must be at most 50,000 characters.'); return }
            rows.push({ id: crypto.randomUUID(), speaker: match ? match[1].trim() : '', text, model_installation_id: model?.id ?? null, voice_id: null, language: model?.definition.languages[0] ?? 'en', pause_ms: 300, job_id: null })
        }
        edit([...script.segments, ...rows]); setBulk(''); setError('')
    }
    function applySpeaker(s: Segment) {
        if (!script || !s.speaker?.trim()) return
        const targets = script.segments.filter(x => x.id !== s.id && x.speaker === s.speaker)
        if (targets.some(x => x.job_id && (!jobs[x.job_id] || !terminal.includes(jobs[x.job_id].status)))) { setError('Wait for active speaker jobs before changing voices.'); return }
        edit(script.segments.map(x => x.id !== s.id && x.speaker === s.speaker ? { ...x, model_installation_id: s.model_installation_id, voice_id: s.voice_id, language: s.language, job_id: null } : x))
    }
    async function batch(retry: boolean) { if (!script) return; await action(async () => { setScript(await api.projects.generateBatch(id, script.revision, retry)); setExported(null); setNotice('Eligible segments queued.') }) }
    const completed = script?.segments.filter(s => s.job_id && jobs[s.job_id]?.status === 'completed').length ?? 0
    const failed = script?.segments.filter(s => s.job_id && ['failed', 'cancelled'].includes(jobs[s.job_id]?.status ?? '')).length ?? 0
    const pending = script?.segments.filter(s => !s.job_id).length ?? 0
    const locked = busy || !!project?.is_archived
    const ready = !!script?.segments.length && script.segments.every(s => s.job_id && jobs[s.job_id]?.status === 'completed')
    const rows = script?.segments ?? []
    const statusOf = (s: Segment) => s.job_id ? (jobs[s.job_id]?.status ?? 'checking') : 'draft'
    const filtered = rows.map((s, i) => ({ s, i })).filter(({ s }) => (filter === 'all' || statusOf(s) === filter || (filter === 'failed' && statusOf(s) === 'cancelled') || (filter === 'active' && !!s.job_id && !terminal.includes(statusOf(s)))) && `${s.speaker ?? ''} ${s.text} ${s.source_text ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    const pages = Math.max(1, Math.ceil(filtered.length / size)), current = Math.min(page, pages)
    const chosen = rows.find(s => s.id === selected) ?? filtered[0]?.s
    const activeCount = rows.length - completed - failed - pending
    return <main className="studio-page pe-workspace">
        <header className="pe-hero"><div><Link href="/projects" className="studio-eyebrow" onClick={e => { if (dirty && !window.confirm('Discard unsaved edits?')) e.preventDefault() }}>← All projects</Link><p className="pe-kicker">AUDIO PRODUCTION / EDITOR</p><h1>{project?.name ?? 'Project editor'}</h1><p>Compose, direct and assemble your next audio production.</p></div><div className="pe-signal" aria-hidden="true"><small>PRODUCTION / SIGNAL</small>
            <div className="pe-signal-bars">
                {Array.from({ length: 32 }, (_, i) => (
                    <i key={i} className={`pe-signal-bar pe-signal-bar-${i}`} />
                ))}
            </div>
            <small>COMPOSE · GENERATE · MASTER</small></div></header>
        {error && <p role="alert" className="rounded-lg border border-danger/30 p-3 text-sm text-danger">{error}</p>}
        {notice && <p role="status" className="text-sm text-success">{notice}</p>}
        {!script ? <p>{error ? 'Unable to open project.' : 'Loading project…'}</p> : <>
            {project?.is_archived && <p className="text-sm text-warning">Archived project. Restore it before editing.</p>}
            <section className="pe-stats">{[['Segments', rows.length], ['Completed', completed], ['In progress', activeCount], ['Needs attention', failed], ['Drafts', pending]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</section>
            <div className="pe-toolbar"><button className={primary} disabled={locked || !dirty} onClick={() => void save()}>Save script</button><button className={button} disabled={locked || script.segments.length >= 100} onClick={add}>Add segment</button><button className={button} disabled={locked || dirty || !ready} onClick={() => void action(async () => { setExported(await api.projects.exportScript(id, script.revision)); setNotice('Project exported.') })}>Export combined WAV</button>{script.segments.some(s => s.source_start != null) && <button className={button} disabled={locked || dirty || !ready || script.segments.some(s => s.source_start == null || s.source_end == null)} onClick={() => void action(async () => { setExported(await api.projects.exportScript(id, script.revision, true)); setNotice("Aligned dub exported. Longer speech may shift later turns.") })}>Export aligned dub</button>}<span className="text-xs text-fg-muted">{dirty ? 'Unsaved changes' : 'Saved'} · {script.segments.length}/100 segments</span></div>
            <section className="pe-panel space-y-3">
                <div className="flex flex-wrap gap-2 items-center"><button className={primary} disabled={locked || dirty || !(pending + failed)} onClick={() => void batch(false)}>Generate all unfinished</button><button className={button} disabled={locked || dirty || !failed} onClick={() => void batch(true)}>Retry failed / cancelled</button><span className="text-sm text-fg-muted">{completed}/{script.segments.length} completed · {failed} failed/cancelled · {pending} not queued</span></div>
                <progress className="w-full" value={completed} max={Math.max(1, script.segments.length)} />
                <button className={button} aria-expanded={showImport} onClick={() => setShowImport(v => !v)}>{showImport ? 'Close import' : 'Import script / dialogue'}</button>
                {showImport && <div className="pe-import space-y-3"><label className="flex gap-2 text-sm"><input type="checkbox" checked={dialogue} disabled={locked} onChange={e => setDialogue(e.target.checked)} /> Dialogue import (Speaker: text per line)</label>
                    <textarea className="studio-input w-full min-h-24" aria-label="Bulk script" placeholder={dialogue ? 'Alice: Welcome.\nBob: Thank you.' : 'Paste paragraphs separated by blank lines.'} value={bulk} disabled={locked} onChange={e => setBulk(e.target.value)} />
                    <input type="file" accept=".txt,text/plain" disabled={locked} onChange={async e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 5000000) { setError('TXT file exceeds 5 MB.'); return } try { setBulk(await f.text()) } catch { setError('Unable to read file.') } }} />
                    <button className={button} disabled={locked || !bulk.trim()} onClick={importScript}>Append imported segments</button></div>}
            </section>
            {!script.segments.length && <p className="rounded-xl border border-border p-6 text-fg-muted">Add your first speech segment to start.</p>}
            <div className="pe-grid"><aside className="pe-panel pe-library"><div className="pe-kicker">01 / SCRIPT SEQUENCE</div><h2>Segments</h2><input className="studio-input w-full" placeholder="Search script or speaker" aria-label="Search segments" value={query} onChange={e => { setQuery(e.target.value); setPage(1); setSelected(null); setPreview(null) }} /><div className="pe-filters"><select className="studio-input" aria-label="Filter status" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); setSelected(null); setPreview(null) }}>{[['all', 'All statuses'], ['draft', 'Draft'], ['active', 'In progress'], ['completed', 'Completed'], ['failed', 'Failed / cancelled']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><select className="studio-input" aria-label="Segments per page" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1) }}>{[6, 12, 24].map(n => <option key={n} value={n}>{n} / page</option>)}</select></div>
                <div className="pe-list">{filtered.slice((current - 1) * size, current * size).map(({ s, i }) => <button key={s.id} className={`pe-row ${chosen?.id === s.id ? 'pe-selected' : ''}`} aria-pressed={chosen?.id === s.id} onClick={() => { setSelected(s.id); setPreview(null) }}><span className="pe-number">{String(i + 1).padStart(2, '0')}</span><span className="pe-row-copy"><strong>{s.speaker || `Segment ${i + 1}`}</strong><span>{s.text || s.source_text || 'Empty script'}</span><small className={`pe-status pe-${statusOf(s)}`}>{statusOf(s).replace(/_/g, ' ')}</small></span><span aria-hidden="true">›</span></button>)}</div>{!filtered.length && <p className="text-sm text-fg-muted">No matching segments.</p>}
                <div className="pe-pagination"><small>{filtered.length ? (current - 1) * size + 1 : 0}–{Math.min(current * size, filtered.length)} of {filtered.length}</small><button className={button} disabled={current === 1} onClick={() => setPage(current - 1)}>‹</button><small>{current}/{pages}</small><button className={button} disabled={current === pages} onClick={() => setPage(current + 1)}>›</button></div></aside><div className="pe-detail">
                    {!chosen && <section className="pe-panel">Select or add a segment to begin.</section>}
                    {script.segments.map((s, i) => {
                        if (s.id !== chosen?.id) return null; const job = s.job_id ? jobs[s.job_id] : undefined; const active = !!s.job_id && (!job || !terminal.includes(job.status)); return <section key={s.id} className="pe-panel pe-editor space-y-4">
                            <div className="pe-kicker">02 / SEGMENT EDITOR</div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold flex-1">Segment {i + 1}</h2><span className="text-xs text-fg-muted">{job?.status ?? (s.job_id ? 'Checking status' : 'Not generated')}</span><button className={button} disabled={locked || i === 0} onClick={() => move(i, -1)}>↑</button><button className={button} disabled={locked || i === script.segments.length - 1} onClick={() => move(i, 1)}>↓</button><button className={button} disabled={locked || active} onClick={() => { if (window.confirm('Remove this segment? Existing audio remains in your library.')) edit(script.segments.filter(x => x.id !== s.id)) }}>Remove</button></div>
                            <div className="flex flex-wrap gap-2 items-center"><input className="studio-input" aria-label="Speaker name" placeholder="Speaker name" maxLength={100} value={s.speaker ?? ''} disabled={locked || active} onChange={e => patch(i, { speaker: e.target.value })} /><button className={button} disabled={locked || active || !s.speaker?.trim() || !s.model_installation_id} onClick={() => applySpeaker(s)}>Apply voice to matching speaker</button></div>
                            {s.source_text != null && <div className="rounded-lg border border-border p-3 text-sm"><p className="text-fg-muted">Original · {s.source_start?.toFixed(2)}s – {s.source_end?.toFixed(2)}s</p><p className="whitespace-pre-wrap">{s.source_text}</p><p className="mt-2 text-fg-muted">Enter the translated text below. Select a compatible target voice and language.</p></div>}
                            <textarea aria-label={`Script for segment ${i + 1}`} className="studio-input pe-script w-full" value={s.text} maxLength={50000} disabled={locked || active} onChange={e => patch(i, { text: e.target.value })} />
                            <ModelVoiceSelector models={models} voices={voices} selectedModelId={s.model_installation_id ?? ''} selectedVoiceId={s.voice_id ?? ''} language={s.language} disabled={locked || active} onModelChange={v => patch(i, { model_installation_id: v || null, voice_id: null, language: models.find(m => m.id === v)?.definition.languages.includes(s.language) ? s.language : (models.find(m => m.id === v)?.definition.languages[0] ?? 'en') })} onVoiceChange={v => patch(i, { voice_id: v || null })} onLanguageChange={v => patch(i, { language: v, voice_id: null })} />
                            <label className="block text-xs text-fg-muted">Pause after segment (ms)<input type="number" min={0} max={10000} step={100} className="studio-input ml-3" disabled={locked} value={s.pause_ms} onChange={e => patch(i, { pause_ms: Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0))) })} /></label>
                            <div className="flex flex-wrap gap-2"><button className={primary} disabled={locked || dirty || active || !s.text.trim() || !s.model_installation_id} onClick={() => void generate(s)}>{job ? 'Regenerate' : 'Generate'}</button>{active && s.job_id && <button className={button} disabled={busy} onClick={() => void action(async () => { const j = await api.generations.cancel(s.job_id!); setJobs(old => ({ ...old, [j.id]: j })) })}>Cancel</button>}{job?.audio_asset && <button className={button} onClick={() => setPreview(preview === s.id ? null : s.id)}>{preview === s.id ? 'Hide player' : 'Preview audio'}</button>}</div>
                            {job?.error_message && <p className="text-sm text-danger">{job.error_message}</p>}{preview === s.id && job?.audio_asset && <AudioPlayer key={job.audio_asset.id} asset={job.audio_asset} />}
                        </section>
                    })}</div></div>
            {exported && <section className="rounded-xl border border-border p-5 space-y-3"><h2 className="font-semibold">Combined recording</h2><AudioPlayer key={exported.id} asset={exported} /></section>}
        </>}
    </main>
}
