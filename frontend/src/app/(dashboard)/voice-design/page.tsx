
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
    AlertCircle,
    ArrowRight,
    AudioLines,
    CheckCircle2,
    ChevronDown,
    CircleHelp,
    FileText,
    Globe2,
    Info,
    Loader2,
    Mic2,
    Plus,
    RefreshCw,
    Sparkles,
    WandSparkles,
    X,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ModelInstallationOut, VoiceOut } from '@/types/api'

const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'de', name: 'German' },
    { code: 'fr', name: 'French' },
    { code: 'es', name: 'Spanish' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
]

const PRESETS = [
    {
        label: 'Warm narrator',
        description:
            'A warm, clear, and professional narrator with a calm delivery, natural intonation, and a moderate speaking pace.',
    },
    {
        label: 'Friendly assistant',
        description:
            'A friendly, approachable, and conversational voice with clear pronunciation, a positive tone, and a natural speaking rhythm.',
    },
    {
        label: 'Documentary',
        description:
            'A confident and articulate documentary narrator with a measured pace, expressive emphasis, and a composed, authoritative tone.',
    },
    {
        label: 'Soft storyteller',
        description:
            'A gentle, expressive storytelling voice with a soft tone, smooth pacing, and engaging natural variation in intonation.',
    },
]

const DEFAULT_PREVIEW =
    'This is a preview of the voice you are designing.'

function getError(error: unknown): string {
    if (error instanceof ApiError || error instanceof Error) {
        return error.message
    }

    return 'An unexpected error occurred.'
}

function SectionHeading({
    number,
    title,
    description,
}: {
    number: string
    title: string
    description: string
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-xs font-semibold text-accent">
                {number}
            </div>

            <div>
                <h2 className="text-sm font-semibold text-fg">
                    {title}
                </h2>
                <p className="mt-1 text-xs leading-5 text-fg-muted">
                    {description}
                </p>
            </div>
        </div>
    )
}

export default function VoiceDesignPage() {
    const [models, setModels] = useState<ModelInstallationOut[]>([])
    const [designedVoices, setDesignedVoices] = useState<VoiceOut[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [modelsLoaded, setModelsLoaded] = useState(false)

    const [name, setName] = useState('')
    const [language, setLanguage] = useState('en')
    const [description, setDescription] = useState('')
    const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW)

    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [created, setCreated] = useState<VoiceOut | null>(null)

    const designModels = useMemo(
        () =>
            models.filter(model => {
                const capabilities = model.definition.capabilities as
                    | Record<string, unknown>
                    | undefined

                return capabilities?.voice_design === true
            }),
        [models]
    )

    useEffect(() => {
        let cancelled = false

        async function load() {
            const results = await Promise.allSettled([
                api.models.list(),
                api.voices.list(),
            ])

            if (cancelled) return

            const failures: string[] = []

            if (results[0].status === 'fulfilled') {
                setModels(results[0].value)
                setModelsLoaded(true)
            } else {
                failures.push(`Models: ${getError(results[0].reason)}`)
            }

            if (results[1].status === 'fulfilled') {
                setDesignedVoices(
                    results[1].value.filter(voice => voice.source === 'designed')
                )
            } else {
                failures.push(`Voices: ${getError(results[1].reason)}`)
            }

            if (failures.length > 0) {
                setError(failures.join(' | '))
            }

            setLoading(false)
        }

        void load()

        return () => {
            cancelled = true
        }
    }, [])

    const canSubmit =
        !submitting &&
        name.trim().length > 0 &&
        description.trim().length >= 10 &&
        previewText.trim().length > 0

    async function refreshVoices() {
        setRefreshing(true)
        setError(null)

        try {
            const voices = await api.voices.list()
            setDesignedVoices(
                voices.filter(voice => voice.source === 'designed')
            )
        } catch (err) {
            setError(getError(err))
        } finally {
            setRefreshing(false)
        }
    }

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()

        if (!canSubmit) return

        setSubmitting(true)
        setError(null)
        setCreated(null)

        try {
            const voice = await api.voices.design({
                name: name.trim(),
                language,
                description: description.trim(),
                preview_text: previewText.trim(),
            })

            setCreated(voice)

            setDesignedVoices(previous => [
                voice,
                ...previous.filter(item => item.id !== voice.id),
            ])

            setName('')
            setDescription('')
            setPreviewText(DEFAULT_PREVIEW)
        } catch (err) {
            setError(getError(err))
        } finally {
            setSubmitting(false)
        }
    }

    function applyPreset(prompt: string) {
        setDescription(prompt)
        setCreated(null)
    }

    return (
        <div className="studio-page space-y-7">
            {/* Header */}
            <header className="flex flex-wrap items-start justify-between gap-5">
                <div>
                    <p className="studio-eyebrow mb-3">
                        Voice workspace / Creation
                    </p>

                    <h1 className="studio-heading">
                        Voice Design
                    </h1>

                    <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">
                        Describe the personality, tone, and delivery of a voice.
                        Save your design as a reusable profile for compatible
                        local speech models.
                    </p>
                </div>

                <Link
                    href="/voices"
                    className="studio-button-secondary"
                >
                    <AudioLines className="h-4 w-4" />
                    Voice Library
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </header>

            {/* Model availability */}
            {!loading && modelsLoaded && designModels.length === 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 sm:p-5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
                        <Info className="h-4 w-4 text-warning" />
                    </div>

                    <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-semibold text-fg">
                            Voice design synthesis is not available yet
                        </h2>

                        <p className="mt-1 text-xs leading-5 text-fg-muted">
                            You can create and save voice descriptions now.
                            Generating audio from these descriptions requires
                            a compatible voice-design model to be installed
                            and configured.
                        </p>

                        <Link
                            href="/models"
                            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
                        >
                            Explore models
                            <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>
                </div>
            )}

            {!loading && modelsLoaded && designModels.length > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />

                    <div>
                        <p className="text-sm font-semibold text-fg">
                            Voice-design-capable model registered
                        </p>
                        <p className="mt-1 text-xs text-fg-muted">
                            {designModels.length} model
                            {designModels.length === 1 ? '' : 's'} advertise
                            voice-design capability. Actual synthesis
                            availability depends on installation and runtime
                            readiness.
                        </p>
                    </div>
                </div>
            )}

            {/* Errors */}
            {error && (
                <div
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />

                    <p className="min-w-0 flex-1 text-xs leading-5 text-fg">
                        {error}
                    </p>

                    <button
                        type="button"
                        onClick={() => setError(null)}
                        aria-label="Dismiss error"
                        className="text-fg-muted hover:text-fg"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Main workspace */}
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <form onSubmit={onSubmit} className="min-w-0">
                    <div className="overflow-hidden rounded-xl border border-border bg-bg-muted">
                        <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                            <div className="flex items-center gap-2.5">
                                <WandSparkles className="h-4 w-4 text-accent" />
                                <h2 className="text-sm font-semibold text-fg">
                                    Create a voice profile
                                </h2>
                            </div>

                            <span className="rounded-md border border-border bg-bg-elevated px-2.5 py-1 text-[10px] font-medium text-fg-muted">
                                Design workspace
                            </span>
                        </div>

                        <div className="space-y-8 p-5 sm:p-6">
                            {/* Identity */}
                            <section className="space-y-5">
                                <SectionHeading
                                    number="01"
                                    title="Voice identity"
                                    description="Give your voice a recognizable name and select its language."
                                />

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="block space-y-2">
                                        <span className="text-xs font-medium text-fg">
                                            Voice name
                                            <span className="ml-1 text-danger">*</span>
                                        </span>

                                        <input
                                            type="text"
                                            required
                                            maxLength={100}
                                            value={name}
                                            onChange={event => setName(event.target.value)}
                                            placeholder="e.g. Warm Narrator"
                                            className="studio-input"
                                        />
                                    </label>

                                    <label className="block space-y-2">
                                        <span className="text-xs font-medium text-fg">
                                            Language
                                        </span>

                                        <div className="relative">
                                            <Globe2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />

                                            <select
                                                value={language}
                                                onChange={event => setLanguage(event.target.value)}
                                                className="studio-input appearance-none pl-10 pr-9"
                                            >
                                                {LANGUAGES.map(item => (
                                                    <option
                                                        key={item.code}
                                                        value={item.code}
                                                    >
                                                        {item.name}
                                                    </option>
                                                ))}
                                            </select>

                                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                                        </div>
                                    </label>
                                </div>
                            </section>

                            <div className="studio-divider" />

                            {/* Voice description */}
                            <section className="space-y-5">
                                <SectionHeading
                                    number="02"
                                    title="Describe your voice"
                                    description="Define how the voice should sound, speak, and express itself."
                                />

                                <div>
                                    <p className="mb-3 text-xs font-medium text-fg">
                                        Start with a style
                                        <span className="ml-2 font-normal text-fg-subtle">
                                            Optional
                                        </span>
                                    </p>

                                    <div className="flex flex-wrap gap-2">
                                        {PRESETS.map(preset => (
                                            <button
                                                key={preset.label}
                                                type="button"
                                                onClick={() => applyPreset(preset.description)}
                                                className={cn(
                                                    'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                                                    description === preset.description
                                                        ? 'border-accent bg-accent/10 text-fg'
                                                        : 'border-border bg-bg text-fg-muted hover:border-border-strong hover:text-fg'
                                                )}
                                            >
                                                <Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-accent" />
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <label className="block space-y-2">
                                    <span className="flex items-center justify-between gap-3 text-xs font-medium text-fg">
                                        <span>
                                            Voice description
                                            <span className="ml-1 text-danger">*</span>
                                        </span>

                                        <span className="font-normal text-fg-subtle">
                                            {description.length} characters
                                        </span>
                                    </span>

                                    <textarea
                                        required
                                        minLength={10}
                                        value={description}
                                        onChange={event => setDescription(event.target.value)}
                                        rows={6}
                                        placeholder="Describe the voice's tone, accent, speaking pace, emotional expression, and personality..."
                                        className="studio-input min-h-[160px] resize-y leading-6"
                                    />

                                    <span className="block text-[11px] leading-5 text-fg-subtle">
                                        Minimum 10 characters. Be specific about
                                        accent, tone, pacing, and vocal characteristics.
                                        The description is stored as your design prompt.
                                    </span>
                                </label>
                            </section>

                            <div className="studio-divider" />

                            {/* Preview script */}
                            <section className="space-y-5">
                                <SectionHeading
                                    number="03"
                                    title="Preview script"
                                    description="Provide a sample sentence to associate with this voice design."
                                />

                                <label className="block space-y-2">
                                    <span className="text-xs font-medium text-fg">
                                        Sample text
                                    </span>

                                    <textarea
                                        required
                                        value={previewText}
                                        onChange={event => setPreviewText(event.target.value)}
                                        rows={3}
                                        className="studio-input min-h-[96px] resize-y leading-6"
                                    />
                                </label>

                                <div className="flex items-start gap-2 rounded-lg border border-border bg-bg-elevated/50 p-3">
                                    <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />

                                    <p className="text-[11px] leading-5 text-fg-muted">
                                        This is a text-only design step.
                                        Saving a profile does not generate or
                                        preview audio. Audio generation requires
                                        a compatible voice-design runtime.
                                    </p>
                                </div>
                            </section>
                        </div>

                        {/* Form footer */}
                        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-bg-elevated/30 px-5 py-4 sm:px-6">
                            <div className="flex items-center gap-2 text-xs text-fg-muted">
                                <FileText className="h-4 w-4 text-fg-subtle" />
                                Reusable voice profile
                            </div>

                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="studio-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Saving design...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="h-4 w-4" />
                                        Save voice design
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>

                {/* Right sidebar */}
                <aside className="space-y-5">
                    {/* Information */}
                    <div className="rounded-xl border border-border bg-bg-muted p-5">
                        <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-accent" />
                            <h2 className="text-sm font-semibold text-fg">
                                Design guidelines
                            </h2>
                        </div>

                        <p className="mt-3 text-xs leading-6 text-fg-muted">
                            A clear description helps a compatible model
                            understand the voice characteristics you want
                            to produce.
                        </p>

                        <div className="mt-5 space-y-4">
                            {[
                                {
                                    title: 'Tone & personality',
                                    text: 'Warm, confident, friendly, calm, or energetic.',
                                },
                                {
                                    title: 'Accent & pronunciation',
                                    text: 'Describe the accent and preferred pronunciation style.',
                                },
                                {
                                    title: 'Pace & delivery',
                                    text: 'Slow and deliberate, conversational, or expressive.',
                                },
                                {
                                    title: 'Emotional expression',
                                    text: 'Subtle, reassuring, enthusiastic, or neutral.',
                                },
                            ].map((item, index) => (
                                <div key={item.title} className="flex gap-3">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-elevated text-[10px] font-semibold text-fg-muted">
                                        {index + 1}
                                    </span>

                                    <div>
                                        <p className="text-xs font-semibold text-fg">
                                            {item.title}
                                        </p>
                                        <p className="mt-1 text-xs leading-5 text-fg-muted">
                                            {item.text}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Model status */}
                    <div className="rounded-xl border border-border bg-bg-muted p-5">
                        <div className="flex items-center gap-2">
                            <AudioLines className="h-4 w-4 text-accent" />
                            <h2 className="text-sm font-semibold text-fg">
                                Model compatibility
                            </h2>
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                            <span
                                className={cn(
                                    'h-2 w-2 rounded-full',
                                    loading || !modelsLoaded
                                        ? 'bg-fg-subtle'
                                        : designModels.length > 0
                                            ? 'bg-success'
                                            : 'bg-warning'
                                )}
                            />

                            <span className="text-xs font-medium text-fg">
                                {loading
                                    ? 'Checking models...'
                                    : !modelsLoaded
                                        ? 'Model status unavailable'
                                        : designModels.length > 0
                                            ? `${designModels.length} compatible model(s) registered`
                                            : 'No compatible model registered'}
                            </span>
                        </div>

                        <p className="mt-3 text-xs leading-5 text-fg-muted">
                            {designModels.length > 0
                                ? 'Registered capabilities do not guarantee that model weights are installed or inference is ready.'
                                : 'You can save voice designs without a compatible model. Audio synthesis is a separate step.'}
                        </p>

                        <Link
                            href="/models"
                            className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-accent hover:underline"
                        >
                            Manage models
                            <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>

                    {/* Collection count */}
                    <div className="rounded-xl border border-border bg-bg-muted p-5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-fg-muted">
                                Saved voice designs
                            </span>

                            <WandSparkles className="h-4 w-4 text-accent" />
                        </div>

                        <p className="mt-3 text-3xl font-semibold tracking-tight text-fg">
                            {designedVoices.length.toString().padStart(2, '0')}
                        </p>

                        <p className="mt-1 text-xs text-fg-muted">
                            Reusable voice profiles
                        </p>
                    </div>
                </aside>
            </div>

            {/* Success message */}
            {created && (
                <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-success/30 bg-success/10 p-5"
                >
                    <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />

                        <div>
                            <p className="text-sm font-semibold text-fg">
                                Voice design saved successfully
                            </p>

                            <p className="mt-1 text-xs leading-5 text-fg-muted">
                                <strong>{created.name}</strong> has been added
                                to your voice collection. This confirms the
                                profile was saved, not that audio was generated.
                            </p>
                        </div>
                    </div>

                    <Link
                        href="/voices"
                        className="studio-button-secondary"
                    >
                        View library
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            )}

            {/* Saved voices */}
            <section className="overflow-hidden rounded-xl border border-border bg-bg-muted">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6">
                    <div>
                        <h2 className="text-base font-semibold text-fg">
                            Your designed voices
                        </h2>

                        <p className="mt-1 text-xs text-fg-muted">
                            Voice descriptions you have saved for future use.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => void refreshVoices()}
                        disabled={refreshing || loading}
                        className="studio-button-secondary"
                    >
                        <RefreshCw
                            className={cn(
                                'h-4 w-4',
                                refreshing && 'animate-spin'
                            )}
                        />
                        Refresh
                    </button>
                </div>

                {loading ? (
                    <div className="flex min-h-[160px] items-center justify-center gap-2 text-xs text-fg-muted">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Loading saved voices...
                    </div>
                ) : designedVoices.length === 0 ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center px-5 py-10 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-elevated">
                            <WandSparkles className="h-5 w-5 text-accent" />
                        </div>

                        <h3 className="mt-4 text-sm font-semibold text-fg">
                            No voice designs saved yet
                        </h3>

                        <p className="mt-2 max-w-sm text-xs leading-5 text-fg-muted">
                            Describe a voice using the form above.
                            Your saved profiles will appear here.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">
                        {designedVoices.map(voice => (
                            <article
                                key={voice.id}
                                className="flex min-w-0 flex-col rounded-xl border border-border bg-bg p-4"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                                        <WandSparkles className="h-4 w-4 text-accent" />
                                    </div>

                                    <span className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[10px] font-medium text-fg-muted">
                                        {voice.language.toUpperCase()}
                                    </span>
                                </div>

                                <h3 className="mt-4 truncate text-sm font-semibold text-fg">
                                    {voice.name}
                                </h3>

                                <p className="mt-2 line-clamp-4 text-xs leading-5 text-fg-muted">
                                    {voice.design_prompt ||
                                        voice.description ||
                                        'No design description available.'}
                                </p>

                                <div className="mt-auto pt-5">
                                    <div className="studio-divider mb-3" />

                                    <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
                                        <FileText className="h-3.5 w-3.5" />
                                        Saved voice profile
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}
