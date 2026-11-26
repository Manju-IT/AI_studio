'use client'

import Link from 'next/link'
import './voice-identity.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, AudioLines, CheckCircle2, FileAudio2, Loader2, Mic2, ShieldCheck, UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { api, ApiError } from '@/lib/api'
import { formatBytes } from '@/lib/utils'
import type { ModelInstallationOut, VoiceOut } from '@/types/api'

const LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko', 'ru']
const ACCEPT = '.wav,.mp3,.flac,.ogg,.m4a,.webm,audio/*'
const getError = (err: unknown) => err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)

export default function VoiceCloningPage() {
    const [models, setModels] = useState<ModelInstallationOut[]>([])
    const [voices, setVoices] = useState<VoiceOut[]>([])
    const [loading, setLoading] = useState(true)
    const [name, setName] = useState('')
    const [language, setLanguage] = useState('en')
    const [speakerName, setSpeakerName] = useState('')
    const [referenceText, setReferenceText] = useState('')
    const [consentChecked, setConsentChecked] = useState(false)
    const [modelId, setModelId] = useState('')
    const [file, setFile] = useState<File | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [progressStep, setProgressStep] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [created, setCreated] = useState<{ voice: VoiceOut; fileName: string } | null>(null)
    const [partialVoiceId, setPartialVoiceId] = useState<string | null>(null)
    const [preview, setPreview] = useState('')
    const [duration, setDuration] = useState<number | null>(null)
    const [query, setQuery] = useState('')
    const [page, setPage] = useState(1)
    useEffect(() => { setDuration(null); if (!file) { setPreview(''); return }; const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url) }, [file])
    const filtered = voices.filter(v => v.name.toLowerCase().includes(query.toLowerCase()))
    const pages = Math.max(1, Math.ceil(filtered.length / 5))
    const current = Math.min(page, pages)
    const inputRef = useRef<HTMLInputElement>(null)
    const capable = useMemo(() => models.filter(m => m.runtime === "qwen_mnn" && Boolean((m.definition.capabilities as Record<string, unknown> | undefined)?.voice_cloning)), [models])
    useEffect(() => { let active = true; Promise.all([api.models.list(), api.voices.list()]).then(([m, v]) => { if (!active) return; setModels(m); setVoices(v.filter(x => x.source === 'cloned')); const first = m.find(x => x.runtime === "qwen_mnn" && Boolean((x.definition.capabilities as Record<string, unknown> | undefined)?.voice_cloning)); if (first) setModelId(first.id) }).catch(err => { if (active) setError(getError(err)) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])
    useEffect(() => {
        let stopped = false
        const timer = setInterval(async () => {
            try { const rows = await api.voices.list(); if (!stopped) setVoices(rows.filter(v => v.source === 'cloned')) } catch { /* retry next poll */ }
        }, 5000)
        return () => { stopped = true; clearInterval(timer) }
    }, [])
    async function extractAndWait(id: string) {
        let job = await api.voices.extract(id)
        while (job.status === 'queued' || job.status === 'processing') {
            setProgressStep(job.status === 'queued' ? 'Queued — waiting for inference worker...' : 'Extracting voice on CPU...')
            await new Promise(resolve => setTimeout(resolve, 3000))
            job = await api.voices.extractionStatus(id)
        }
        if (job.status !== 'completed') throw new Error(job.error || 'Extraction did not complete')
    }
    const canSubmit = !submitting && (duration === null || (duration >= 3 && duration <= 15)) && name.trim().length > 0 && speakerName.trim().length > 0 && referenceText.trim().length > 0 && consentChecked && file !== null && !!modelId
    async function onSubmit(event: React.FormEvent) {
        event.preventDefault(); if (!canSubmit || !file) return; setSubmitting(true); setError(null); setCreated(null); setPartialVoiceId(null)
        let registeredId: string | null = null
        try {
            setProgressStep('Creating authorized voice profile...')
            const voice = await api.voices.clone({ name: name.trim(), language, speaker_name: speakerName.trim(), consent_statement: `The submitting user confirms that ${speakerName.trim()} explicitly authorized cloning this voice for internal company use. Confirmation recorded at ${new Date().toISOString()}.`, reference_text: referenceText.trim(), model_installation_id: modelId || null })
            registeredId = voice.id
            setProgressStep('Uploading reference recording...')
            await api.voices.uploadReference(voice.id, file)
            setProgressStep('Extracting voice on CPU...')
            await extractAndWait(voice.id)
            setProgressStep('Refreshing voice library...')
            const updated = await api.voices.list()
            setVoices(updated.filter(x => x.source === 'cloned'))
            setCreated({ voice: updated.find(x => x.id === voice.id) ?? voice, fileName: file.name })
            setName(''); setSpeakerName(''); setReferenceText(''); setConsentChecked(false); setFile(null)
            if (inputRef.current) inputRef.current.value = ''
        } catch (err) {
            if (registeredId) { setPartialVoiceId(registeredId); setError(`The voice profile was created (ID: ${registeredId}), but the upload or extraction did not complete: ${getError(err)}. Use Extract on the existing profile if its reference was uploaded.`) }
            else setError(getError(err))
        } finally { setSubmitting(false); setProgressStep('') }
    }
    return <div className="identity-page studio-page space-y-6">
        <header className="identity-hero"><div><div className="identity-kicker">VOICE INTELLIGENCE / PRIVATE VOICES</div><h1>Make a voice <em>your own.</em></h1><p>Transform an authorized recording into a reusable voice identity for your audio productions.</p><Link href="/voices" className="identity-link">Explore voice library <ArrowRight className="h-4 w-4" /></Link></div><div className="identity-art" aria-hidden="true"><div className="identity-orbit" /><div className="identity-signal"><Mic2 className="h-7 w-7" />
            <div className="identity-wave">
                {Array.from({ length: 40 }, (_, i) => {
                    const height = Number(
                        (12 + 80 * Math.abs(Math.sin(i * 0.32) * Math.cos(i * 0.13))).toFixed(4)
                    );

                    const animationDelay = Number((-i * 0.07).toFixed(2));

                    return (
                        <i
                            key={i}
                            style={{
                                height: `${height}%`,
                                animationDelay: `${animationDelay}s`,
                            }}
                        />
                    );
                })}
            </div>
            <span>VOICE IDENTITY / LOCAL INFERENCE</span></div></div></header>
        <div className="identity-steps">{[['01', 'Define identity', !!name.trim() && !!speakerName.trim()], ['02', 'Prepare reference', !!file && !!referenceText.trim()], ['03', 'Authorize & extract', !!created]].map(([n, t, done]) => <div key={String(n)}><span>{done ? '✓' : n}</span><strong>{t}</strong></div>)}</div>
        {!loading && capable.length === 0 && <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" /><div><h2 className="text-sm font-semibold text-fg">No cloning-capable model detected</h2><p className="mt-1 text-xs leading-relaxed text-fg-muted">Install a compatible cloning model before creating a voice.</p></div></div>}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]"><form onSubmit={onSubmit}><fieldset disabled={submitting} className="identity-fieldset"><Card className="identity-panel space-y-6"><div><div className="flex items-center gap-2"><Mic2 className="h-4 w-4 text-accent" /><h2 className="text-base font-semibold text-fg">Define your voice identity</h2></div><p className="mt-1 text-xs text-fg-muted">01 / Name your voice and select its speech engine.</p></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-xs font-medium text-fg-muted">Voice name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Narrator — Priya" className="studio-input" /></label><label className="block space-y-2 text-xs font-medium text-fg-muted">Language<select value={language} onChange={e => setLanguage(e.target.value)} className="studio-input">{LANGUAGES.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
                <label className="block space-y-2 text-xs font-medium text-fg-muted">Speaker name<input required value={speakerName} onChange={e => setSpeakerName(e.target.value)} placeholder="Name of the person speaking" className="studio-input" /></label><label className="block space-y-2 text-xs font-medium text-fg-muted">Compatible model<select value={modelId} onChange={e => setModelId(e.target.value)} className="studio-input"><option value="">Select a model</option>{capable.map(m => <option key={m.id} value={m.id}>{m.definition.display_name}</option>)}</select></label></div>
            <label className="block space-y-2 text-xs font-medium text-fg-muted">02 / Verbatim recording transcript<textarea required rows={4} value={referenceText} onChange={e => setReferenceText(e.target.value)} placeholder="Write exactly what the speaker says in the uploaded recording..." className="studio-input min-h-28 resize-y leading-relaxed" /><span className="block text-[11px] font-normal text-fg-subtle">The transcript must match the spoken recording for models that require reference text.</span></label>
            <div><div className="mb-2 text-xs font-medium text-fg-muted">Reference audio</div><label className="flex cursor-pointer flex-col items-center justify-center identity-upload rounded-xl border border-dashed border-border-strong px-5 py-8 text-center transition-colors hover:border-accent/60"><UploadCloud className="mb-3 h-7 w-7 text-accent" /><span className="text-sm font-medium text-fg">{file ? 'Change reference recording' : 'Choose a recording'}</span><span className="mt-1 text-xs text-fg-subtle">WAV, MP3, FLAC, OGG, M4A or WebM · 3–15 seconds</span><input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>{file && <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-bg p-3"><FileAudio2 className="h-5 w-5 shrink-0 text-accent" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-fg">{file.name}</div><div className="text-[11px] text-fg-subtle">{formatBytes(file.size)}</div></div><button type="button" aria-label="Remove selected audio" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = '' }} className="rounded-md p-1.5 text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button></div>}</div>
            {preview && file && <div className="identity-preview"><div className="identity-kicker">RECORDING PREVIEW</div><audio key={preview} controls preload="metadata" src={preview} onLoadedMetadata={e => { const d = e.currentTarget.duration; setDuration(Number.isFinite(d) ? d : null) }} /><p>{duration === null ? "Duration will be checked by the backend." : `${duration.toFixed(1)} seconds · ${duration >= 3 && duration <= 15 ? "Within reference duration range" : "Choose a recording between 3 and 15 seconds"}`}</p></div>}
            <label className="identity-consent flex items-start gap-3 rounded-xl border border-border bg-bg p-4"><input type="checkbox" checked={consentChecked} onChange={e => setConsentChecked(e.target.checked)} className="mt-1 h-4 w-4 accent-accent" /><span className="text-xs leading-relaxed text-fg-muted"><strong className="text-fg">I confirm explicit speaker permission.</strong> The speaker has authorized cloning and internal company use of this voice. I understand that my confirmation will be recorded with the profile.</span></label>
            {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs leading-relaxed text-danger">{error}{partialVoiceId && <div className="mt-2"><Link href="/voices" className="underline">View voice library</Link></div>}</div>}
            {created && <div role="status" className="flex gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success"><CheckCircle2 className="h-4 w-4 shrink-0" /><span><strong>{created.voice.name}</strong> registered; upload completed for <strong>{created.fileName}</strong>. Voice extracted and ready for synthesis.</span></div>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><span className="text-xs text-fg-subtle">{progressStep || 'Authorization and reference audio are required.'}</span><Button type="submit" disabled={!canSubmit}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{submitting ? 'Processing...' : 'Create & extract voice'}</Button></div>
        </Card></fieldset></form>
            <div className="space-y-5"><Card className="identity-guide space-y-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /><h2 className="text-sm font-semibold text-fg">A great voice starts here</h2></div><div className="space-y-4">{[{ n: '01', title: 'Authorized speaker', desc: 'Only upload recordings with explicit permission from the person speaking.' }, { n: '02', title: 'Clean recording', desc: 'Use one speaker, minimal background noise, and a clear voice.' }, { n: '03', title: 'Accurate transcript', desc: 'Enter the words spoken in the clip as closely as possible.' }, { n: '04', title: 'Compatible inference', desc: 'The worker serializes extraction, transcription and synthesis.' }].map(item => <div key={item.n} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-[11px] font-semibold text-accent">{item.n}</span><div><h3 className="text-xs font-medium text-fg">{item.title}</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">{item.desc}</p></div></div>)}</div></Card>
                <Card className="identity-panel"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-fg">Your private voices</h2><span className="text-xs text-fg-subtle">{voices.length}</span></div>{loading ? <div className="mt-4 flex items-center gap-2 text-xs text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div> : voices.length === 0 ? <p className="mt-4 text-xs text-fg-muted">No cloned voices registered yet.</p> : <div className="mt-3 space-y-3"><input className="studio-input" aria-label="Search private voices" placeholder="Search voices…" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} />{filtered.length === 0 && <p className="text-xs text-fg-muted">No matching voices.</p>}<div className="divide-y divide-border">{filtered.slice((current - 1) * 5, current * 5).map(v => <div key={v.id} className="flex items-center justify-between gap-2 py-3"><div className="min-w-0"><div className="truncate text-xs font-medium text-fg">{v.name}</div><div className="mt-1 text-[11px] text-fg-subtle">{v.synthesis_ready ? "Ready" : "Pending"} · {v.samples.length} sample{v.samples.length === 1 ? '' : 's'}</div></div><span className="text-[11px] uppercase text-fg-subtle">{v.language}</span>{!v.synthesis_ready && v.samples.length > 0 && <Button disabled={submitting} onClick={async () => { setSubmitting(true); setError(null); try { await extractAndWait(v.id); setVoices((await api.voices.list()).filter(x => x.source === "cloned")) } catch (e) { setError(getError(e)) } finally { setSubmitting(false); setProgressStep('') } }}>Extract</Button>}</div>)}</div><div className="identity-pagination"><button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><span>{current} / {pages}</span><button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></div></div>}</Card></div></div>
    </div>
}
