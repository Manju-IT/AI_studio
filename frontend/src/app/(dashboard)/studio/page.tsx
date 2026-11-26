'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, ChevronDown, ChevronUp, FileAudio2, Loader2, Settings2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import './studio-workspace.css'
import { ModelVoiceSelector } from '@/components/studio/ModelVoiceSelector'
import { GenerationProgress } from '@/components/studio/GenerationProgress'
import { AudioPlayer } from '@/components/studio/AudioPlayer'
import { useJobProgress } from '@/hooks/useJobProgress'
import { api, ApiError } from '@/lib/api'
import type { AudioAssetOut, GenerationJobOut, ModelInstallationOut, VoiceOut } from '@/types/api'


const panel = 'production-panel'
const field = 'studio-input'
const message = (err: unknown) => err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'The request failed.'
const terminal = (status?: string) => status === 'completed' || status === 'failed' || status === 'cancelled'

export default function StudioPage() {
    const [models, setModels] = useState<ModelInstallationOut[]>([])
    const [voices, setVoices] = useState<VoiceOut[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedModelId, setSelectedModelId] = useState('')
    const [selectedVoiceId, setSelectedVoiceId] = useState('')
    const [language, setLanguage] = useState('en')
    const [text, setText] = useState('')
    const [parameterValues, setParameterValues] = useState<Record<string, string>>({})
    const [cancelling, setCancelling] = useState(false)
    const [ready, setReady] = useState(false)
    const [draftKey, setDraftKey] = useState('')
    const [longForm, setLongForm] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [jobId, setJobId] = useState<string | null>(null)
    const [job, setJob] = useState<GenerationJobOut | null>(null)
    const [resultAsset, setResultAsset] = useState<AudioAssetOut | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const fetchedTerminalId = useRef<string | null>(null)
    const { progress } = useJobProgress(jobId)

    useEffect(() => { let active = true; (async () => { try { const user = await api.auth.me(); if (!active) return; const key = `voice-studio-draft:${user.id}`; setDraftKey(key); const id = new URLSearchParams(window.location.search).get('reuse'); if (id) { const j = await api.generations.get(id); if (!active) return; setText(j.text); setSelectedModelId(j.model_installation_id || ''); setSelectedVoiceId(j.voice_id || ''); setLanguage(j.language); setLongForm(j.is_long_form); setParameterValues(Object.fromEntries(Object.entries(j.settings).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, String(v)]))) } else { setText(sessionStorage.getItem(key) || '') } } catch (e) { if (active) setError(message(e)) } finally { if (active) setReady(true) } })(); return () => { active = false } }, [])
    useEffect(() => { if (ready && draftKey) { try { sessionStorage.setItem(draftKey, text) } catch {/* storage unavailable */ } } }, [ready, draftKey, text])
    async function importScript(file: File) { try { if (file.size > 1000000) throw new Error('Text file is too large.'); const value = await file.text(); if (value.length > 50000) throw new Error('Script exceeds 50,000 characters.'); setText(value); setError(null) } catch (e) { setError(message(e)) } }
    async function cancel() { if (!jobId) return; setCancelling(true); try { setJob(await api.generations.cancel(jobId)) } catch (e) { setError(message(e)) } finally { setCancelling(false) } }

    useEffect(() => {
        let active = true
        Promise.all([api.models.list(), api.voices.list()])
            .then(([m, v]) => {
                if (!active) return
                m = m.filter(item => item.installation_state !== 'invalid' && item.generation_contract?.available === true)
                setModels(m)
                setVoices(v)
                if (m.length) {
                    setSelectedModelId(prev => prev || m[0].id)
                    setLanguage(prev => prev || m[0].definition.languages[0] || 'en')
                }
            })
            .catch(err => { if (active) setError(message(err)) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [])

    const selectedModel = useMemo(() => models.find(m => m.id === selectedModelId), [models, selectedModelId])
    const parameters = selectedModel?.generation_contract?.parameters ?? []
    const allowedLanguages = selectedModel?.definition.languages ?? []
    const effectiveLanguage = allowedLanguages.includes(language) ? language : allowedLanguages[0] || 'en'
    const currentProgress = progress && progress.id === jobId ? progress : null
    const jobInProgress = Boolean(jobId && !terminal(job?.status) && !terminal(currentProgress?.status))
    const canGenerate = Boolean(selectedModel && ready && text.trim() && text.length <= 50000 && !loading && !submitting && !jobInProgress)

    useEffect(() => {
        if (!jobId || !currentProgress || !terminal(currentProgress.status) || fetchedTerminalId.current === jobId) return
        fetchedTerminalId.current = jobId
        let active = true
        api.jobs.get(jobId)
            .then(async finalJob => {
                if (!active) return
                setJob(finalJob)
                if (finalJob.audio_asset) { setResultAsset(finalJob.audio_asset); return }
                if (finalJob.audio_asset_id) {
                    try {
                        const asset = await api.audio.get(finalJob.audio_asset_id)
                        if (active) setResultAsset(asset)
                    } catch { /* Job remains visible even when the audio asset is unavailable. */ }
                }
            })
            .catch(err => { if (active) setError(message(err)) })
        return () => { active = false }
    }, [jobId, currentProgress])

    async function generate() {
        if (!selectedModel || !canGenerate) return
        const settings: Record<string, number> = {}
        for (const p of parameters) {
            const raw = parameterValues[p.key] ?? (p.default === null ? '' : String(p.default))
            if (!raw.trim() && p.default === null) continue
            const n = Number(raw)
            if (!raw.trim() || !Number.isFinite(n) || n < p.minimum || n > p.maximum || (p.integer && !Number.isInteger(n))) {
                setError(`Invalid ${p.label}: expected ${p.minimum} to ${p.maximum}.`); return
            }
            settings[p.key] = n
        }
        setSubmitting(true)
        setError(null)
        setJob(null)
        setJobId(null)
        setResultAsset(null)
        fetchedTerminalId.current = null
        try {
            // A unique key per click prevents accidental duplicate submissions from this page,
            // without incorrectly reusing a job when text or settings are changed later.
            const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`
            const created = await api.generations.submit({
                model_installation_id: selectedModel.id,
                voice_id: voices.some(v => v.id === selectedVoiceId && v.model_installation_id === selectedModel.id && v.language.toLowerCase() === effectiveLanguage.toLowerCase() && v.is_active && selectedModel.runtime !== "piper") ? selectedVoiceId : null,
                text: text.trim(),
                language: effectiveLanguage,
                long_form: longForm,
                settings,
                idempotency_key: key,
            })
            setJob(created)
            setJobId(created.id)
            if (created.audio_asset) setResultAsset(created.audio_asset)
        } catch (err) { setError(message(err)) }
        finally { setSubmitting(false) }
    }

    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0
    const busy = submitting || jobInProgress
    return (
        <div className="production-workspace">
            <section className="production-hero">
                <div><div className="production-kicker"><AudioLines size={15} /> AUDIO WORKSPACE / TEXT TO SPEECH</div><h1>Make every word <em>heard.</em></h1><p>Compose your script, choose your voice and bring it to life.</p></div>
                <div className="production-wave" aria-hidden="true">
                    {Array.from({ length: 44 }, (_, i) => {
                        const height = 12 + 82 * Math.abs(
                            Math.sin(i * 0.31) * Math.cos(i * 0.13)
                        )

                        const delay = -i * 0.07

                        return (
                            <i
                                key={i}
                                style={{
                                    height: `${height.toFixed(4)}%`,
                                    animationDelay: `${delay.toFixed(4)}s`,
                                }}
                            />
                        )
                    })}
                </div>
            </section>
            <div className="production-steps"><span><b>01</b> Compose</span><span><b>02</b> Configure voice</span><span><b>03</b> Generate &amp; listen</span></div>
            {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

            <div className="production-grid">
                <section className={`${panel} production-compose`}>
                    <div className="production-panel-head"><div><span className="production-kicker">01 / SCRIPT</span><h2>Script editor</h2></div><div className="production-tools"><label className="production-tool">Import TXT<input type="file" accept=".txt,text/plain" className="sr-only" disabled={!ready || busy} onChange={e => { const f = e.target.files?.[0]; if (f) void importScript(f); e.target.value = '' }} /></label><button className="production-tool" disabled={!ready || busy || !text} onClick={() => { if (window.confirm('Clear this script?')) setText('') }}>Clear</button></div></div>
                    <div className="production-editor"><textarea aria-label="Script to generate" value={text} maxLength={50000} disabled={!ready || busy} onChange={e => setText(e.target.value)} placeholder="Every great voice starts with a story. Write yours here…" /><div className="production-editor-footer"><span>{wordCount.toLocaleString()} words · {text.length.toLocaleString()} / 50,000 characters</span><span>{ready && draftKey ? 'Session draft' : 'Loading draft…'}</span></div></div>
                    <div className="mt-6 border-t border-border pt-5">
                        <label className="flex cursor-pointer items-start gap-3">
                            <input type="checkbox" checked={longForm} onChange={e => setLongForm(e.target.checked)} disabled={submitting || jobInProgress} className="mt-1 h-4 w-4 accent-accent" />
                            <span><span className="block text-sm font-medium text-fg">Long-form generation</span><span className="mt-1 block text-xs leading-5 text-fg-muted">Split longer scripts into manageable sentence-aware chunks.</span></span>
                        </label>
                    </div>
                </section>

                <section className={`${panel} production-config`}>
                    <div className="production-panel-head"><div><span className="production-kicker">02 / VOICE</span><h2>Shape your sound</h2><p>Choose an engine, language and voice.</p></div><Settings2 size={22} /></div>
                    {loading ? <div className="flex items-center gap-2 py-8 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading models and voices…</div> : (
                        <ModelVoiceSelector
                            models={models} voices={voices} selectedModelId={selectedModelId} selectedVoiceId={selectedVoiceId} language={effectiveLanguage}
                            onModelChange={id => {
                                setSelectedModelId(id)
                                setParameterValues({})
                                setSelectedVoiceId('')
                                const model = models.find(item => item.id === id)
                                setLanguage(model?.definition.languages[0] || 'en')
                            }}
                            onVoiceChange={setSelectedVoiceId} onLanguageChange={value => { setLanguage(value); setSelectedVoiceId('') }} disabled={submitting || jobInProgress}
                        />
                    )}
                    {!loading && models.length === 0 && <p className="mt-4 text-sm text-fg-muted">No models registered. Add or validate a model in the <Link href="/models" className="text-accent hover:underline">Model Registry</Link>.</p>}
                    <div className="mt-6 border-t border-border pt-5">
                        <button type="button" onClick={() => setSettingsOpen(v => !v)} aria-expanded={settingsOpen} className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-fg hover:text-accent"><span className="flex items-center gap-2"><Settings2 className="h-4 w-4" /> Advanced generation settings</span>{settingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
                        {settingsOpen && <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                            {parameters.map(p => <label key={p.key} className="space-y-2 text-xs font-medium text-fg-muted">{p.label}<input type="number" min={p.minimum} max={p.maximum} step={p.step} value={parameterValues[p.key] ?? (p.default === null ? '' : String(p.default))} disabled={submitting || jobInProgress} onChange={e => setParameterValues(old => ({ ...old, [p.key]: e.target.value }))} className={field} /></label>)}
                            <button type="button" className="studio-button-secondary" onClick={() => setParameterValues({})}>Reset settings</button>
                        </div>}
                    </div>
                    <div className="mt-6 border-t border-border pt-5">
                        <div className="mb-4 text-xs leading-5 text-fg-muted">{selectedModel ? `${selectedModel.definition.display_name} · ${selectedModel.runtime}` : 'Select a model to begin'}</div>
                        <Button onClick={() => void generate()} disabled={!canGenerate} className="production-generate w-full justify-center">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{submitting ? 'Submitting…' : jobInProgress ? 'Generation in progress' : 'Generate speech'}</Button>
                        {jobInProgress && <button className="studio-button-secondary mt-3 w-full" disabled={cancelling || job?.cancellation_requested} onClick={() => void cancel()}>{cancelling || job?.cancellation_requested ? 'Cancellation requested' : 'Cancel generation'}</button>}
                        {jobInProgress && <p className="mt-3 text-center text-xs text-fg-muted">Your generation is being processed. Progress appears below.</p>}
                    </div>
                </section>
            </div>

            {!jobId && !resultAsset && <section className="production-output"><div className="production-output-icon"><AudioLines size={25} /></div><div><span className="production-kicker">03 / OUTPUT</span><h2>Your audio, ready to listen.</h2><p>Generated recordings and progress will appear here.</p></div><Link href="/audio-library" className="production-history">Audio library ↗</Link></section>}
            {jobId && currentProgress && <section className={`${panel} p-5 sm:p-6`} aria-live="polite"><h2 className="text-lg font-semibold text-fg">Generation progress</h2><p className="mt-1 text-sm text-fg-muted">Updates from the inference worker</p><div className="mt-5"><GenerationProgress progress={currentProgress} /></div></section>}
            {resultAsset && <section className={`${panel} p-5 sm:p-6`}><div className="mb-5"><h2 className="text-lg font-semibold text-fg">Generated audio</h2><p className="mt-1 text-sm text-fg-muted">{resultAsset.title || 'Your recording is ready'}</p></div><AudioPlayer asset={resultAsset} /></section>}
            {job?.status === 'failed' && job.error_message && <section className={`${panel} p-5 sm:p-6`} role="alert"><h2 className="font-semibold text-danger">Generation failed</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg-muted">{job.error_message}</p></section>}
        </div>
    )
}
