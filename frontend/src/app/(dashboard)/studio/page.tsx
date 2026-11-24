'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, ChevronDown, ChevronUp, FileAudio2, Loader2, Settings2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { TextEditor } from '@/components/studio/TextEditor'
import { ModelVoiceSelector } from '@/components/studio/ModelVoiceSelector'
import { GenerationProgress } from '@/components/studio/GenerationProgress'
import { AudioPlayer } from '@/components/studio/AudioPlayer'
import { useJobProgress } from '@/hooks/useJobProgress'
import { api, ApiError } from '@/lib/api'
import type { AudioAssetOut, GenerationJobOut, ModelInstallationOut, VoiceOut } from '@/types/api'


const panel = 'rounded-xl border border-border bg-bg-muted'
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
    const [speed, setSpeed] = useState(1)
    const [cancelling, setCancelling] = useState(false)
    const [ready, setReady] = useState(false)
    const [draftKey, setDraftKey] = useState('')
    useEffect(() => { let active = true; (async () => { try { const user = await api.auth.me(); if (!active) return; const key = `voice-studio-draft:${user.id}`; setDraftKey(key); const id = new URLSearchParams(window.location.search).get('reuse'); if (id) { const j = await api.generations.get(id); if (!active) return; setText(j.text); setSelectedModelId(j.model_installation_id || ''); setSelectedVoiceId(j.voice_id || ''); setLanguage(j.language); setLongForm(j.is_long_form); setTemperature(Number(j.settings.temperature ?? 0.7)); setTopP(Number(j.settings.top_p ?? 0.9)); setTopK(Number(j.settings.top_k ?? 50)); setSeed(j.settings.seed == null ? '' : String(j.settings.seed)); setSpeed(Number(j.settings.speed ?? (1 / Number(j.settings.length_scale ?? 1)))) } else { setText(sessionStorage.getItem(key) || '') } } catch (e) { if (active) setError(message(e)) } finally { if (active) setReady(true) } })(); return () => { active = false } }, [])
    useEffect(() => { if (ready && draftKey) { try { sessionStorage.setItem(draftKey, text) } catch {/* storage unavailable */ } } }, [ready, draftKey, text])
    async function importScript(file: File) { try { if (file.size > 1000000) throw new Error('Text file is too large.'); const value = await file.text(); if (value.length > 50000) throw new Error('Script exceeds 50,000 characters.'); setText(value); setError(null) } catch (e) { setError(message(e)) } }
    async function cancel() { if (!jobId) return; setCancelling(true); try { setJob(await api.generations.cancel(jobId)) } catch (e) { setError(message(e)) } finally { setCancelling(false) } }
    const [longForm, setLongForm] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [temperature, setTemperature] = useState(0.7)
    const [topP, setTopP] = useState(0.9)
    const [topK, setTopK] = useState(50)
    const [seed, setSeed] = useState('')
    const [jobId, setJobId] = useState<string | null>(null)
    const [job, setJob] = useState<GenerationJobOut | null>(null)
    const [resultAsset, setResultAsset] = useState<AudioAssetOut | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const fetchedTerminalId = useRef<string | null>(null)
    const { progress } = useJobProgress(jobId)

    useEffect(() => {
        let active = true
        Promise.all([api.models.list(), api.voices.list()])
            .then(([m, v]) => {
                if (!active) return
                m = m.filter(item => item.installation_state !== 'invalid')
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
    }, [jobId, currentProgress?.status])

    async function generate() {
        if (!selectedModel || !canGenerate) return
        if (selectedModel.runtime === 'qwen_mnn' && seed.trim() && (!Number.isSafeInteger(Number(seed)) || Number(seed) < 0)) {
            setError('Seed must be a non-negative whole number.')
            return
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
                voice_id: selectedVoiceId || null,
                text: text.trim(),
                language: effectiveLanguage,
                long_form: longForm,
                settings: selectedModel.runtime === 'piper' ? { length_scale: 1 / speed } : selectedModel.runtime === 'kokoro' ? { speed } : selectedModel.runtime === 'qwen_mnn' ? { temperature, top_p: topP, top_k: topK, ...(seed.trim() ? { seed: Number(seed) } : {}) } : {},
                idempotency_key: key,
            })
            setJob(created)
            setJobId(created.id)
            if (created.audio_asset) setResultAsset(created.audio_asset)
        } catch (err) { setError(message(err)) }
        finally { setSubmitting(false) }
    }

    return (
        <main className="studio-page space-y-7">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-fg-subtle">Voice production</div><h1 className="text-3xl font-semibold tracking-tight text-fg">Studio</h1><p className="mt-2 text-sm leading-6 text-fg-muted">Turn written scripts into speech using your local voice models.</p></div>
                <Link href="/jobs" className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-elevated px-4 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg"><FileAudio2 className="h-4 w-4" /> Generation history</Link>
            </header>

            {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
                <section className={`${panel} min-w-0 p-5 sm:p-7`}>
                    <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-fg">Your script</h2><p className="mt-1 text-sm text-fg-muted">Write or paste the text you want to generate.</p></div><div className="rounded-xl border border-border bg-bg p-2.5"><AudioLines className="h-5 w-5 text-accent" /></div></div>
                    <div className="mb-3 flex flex-wrap gap-3"><label className="studio-button-secondary cursor-pointer">Import TXT<input type="file" accept=".txt,text/plain" className="sr-only" disabled={!ready || submitting || jobInProgress} onChange={e => { const f = e.target.files?.[0]; if (f) void importScript(f); e.target.value = '' }} /></label><button className="studio-button-secondary" disabled={!ready || submitting || jobInProgress} onClick={() => { if (window.confirm('Clear this script?')) setText('') }}>Clear script</button></div><TextEditor value={text} onChange={setText} disabled={!ready || submitting || jobInProgress} />
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-fg-muted"><span>{text.trim().length.toLocaleString()} characters</span><span>{text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString()} words` : 'Start typing to compose a script'}</span></div>
                    <div className="mt-6 border-t border-border pt-5">
                        <label className="flex cursor-pointer items-start gap-3">
                            <input type="checkbox" checked={longForm} onChange={e => setLongForm(e.target.checked)} disabled={submitting || jobInProgress} className="mt-1 h-4 w-4 accent-accent" />
                            <span><span className="block text-sm font-medium text-fg">Long-form generation</span><span className="mt-1 block text-xs leading-5 text-fg-muted">Split longer scripts into manageable sentence-aware chunks.</span></span>
                        </label>
                    </div>
                </section>

                <section className={`${panel} min-w-0 p-5 sm:p-6`}>
                    <div className="mb-5"><h2 className="text-lg font-semibold text-fg">Voice configuration</h2><p className="mt-1 text-sm text-fg-muted">Choose the engine, voice, and language.</p></div>
                    {loading ? <div className="flex items-center gap-2 py-8 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading models and voices…</div> : (
                        <ModelVoiceSelector
                            models={models} voices={voices} selectedModelId={selectedModelId} selectedVoiceId={selectedVoiceId} language={effectiveLanguage}
                            onModelChange={id => {
                                setSelectedModelId(id)
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
                        {settingsOpen && (selectedModel?.runtime === 'piper' || selectedModel?.runtime === 'kokoro') && <label className="mt-4 block text-sm">Speech speed<input className={field} type="number" min={0.5} max={2} step={0.1} value={speed} onChange={e => setSpeed(Math.max(0.5, Math.min(2, Number(e.target.value))))} /></label>}
                        {settingsOpen && selectedModel?.runtime === 'qwen_mnn' && <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                            <label className="space-y-2 text-xs font-medium text-fg-muted">Temperature<input type="number" min={0} max={2} step={0.05} value={temperature} disabled={submitting || jobInProgress} onChange={e => setTemperature(Number(e.target.value))} className={field} /></label>
                            <label className="space-y-2 text-xs font-medium text-fg-muted">Top-p<input type="number" min={0} max={1} step={0.05} value={topP} disabled={submitting || jobInProgress} onChange={e => setTopP(Number(e.target.value))} className={field} /></label>
                            <label className="space-y-2 text-xs font-medium text-fg-muted">Top-k<input type="number" min={1} step={1} value={topK} disabled={submitting || jobInProgress} onChange={e => setTopK(Number(e.target.value))} className={field} /></label>
                            <label className="space-y-2 text-xs font-medium text-fg-muted">Seed (optional)<input type="number" min={0} step={1} value={seed} disabled={submitting || jobInProgress} onChange={e => setSeed(e.target.value)} placeholder="Random" className={field} /></label>
                            <p className="text-xs leading-5 text-fg-subtle sm:col-span-2 xl:col-span-1">Sampling controls for Qwen MNN.</p>
                        </div>}
                    </div>
                    <div className="mt-6 border-t border-border pt-5">
                        <div className="mb-4 text-xs leading-5 text-fg-muted">{selectedModel ? `${selectedModel.definition.display_name} · ${selectedModel.runtime}` : 'Select a model to begin'}</div>
                        <Button onClick={() => void generate()} disabled={!canGenerate} className="w-full justify-center">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{submitting ? 'Submitting…' : jobInProgress ? 'Generation in progress' : 'Generate speech'}</Button>
                        {jobInProgress && <button className="studio-button-secondary mt-3 w-full" disabled={cancelling || job?.cancellation_requested} onClick={() => void cancel()}>{cancelling || job?.cancellation_requested ? 'Cancellation requested' : 'Cancel generation'}</button>}
                        {jobInProgress && <p className="mt-3 text-center text-xs text-fg-muted">Your generation is being processed. Progress appears below.</p>}
                    </div>
                </section>
            </div>

            {jobId && currentProgress && <section className={`${panel} p-5 sm:p-6`} aria-live="polite"><h2 className="text-lg font-semibold text-fg">Generation progress</h2><p className="mt-1 text-sm text-fg-muted">Updates from the inference worker</p><div className="mt-5"><GenerationProgress progress={currentProgress} /></div></section>}
            {resultAsset && <section className={`${panel} p-5 sm:p-6`}><div className="mb-5"><h2 className="text-lg font-semibold text-fg">Generated audio</h2><p className="mt-1 text-sm text-fg-muted">{resultAsset.title || 'Your recording is ready'}</p></div><AudioPlayer asset={resultAsset} /></section>}
            {job?.status === 'failed' && job.error_message && <section className={`${panel} p-5 sm:p-6`} role="alert"><h2 className="font-semibold text-danger">Generation failed</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg-muted">{job.error_message}</p></section>}
        </main>
    )
}
