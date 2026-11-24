'use client'

import { useMemo } from 'react'
import type { ModelInstallationOut, VoiceOut } from '@/types/api'

export function ModelVoiceSelector({
    models,
    voices,
    selectedModelId,
    selectedVoiceId,
    language,
    onModelChange,
    onVoiceChange,
    onLanguageChange,
    disabled,
}: {
    models: ModelInstallationOut[]
    voices: VoiceOut[]
    selectedModelId: string
    selectedVoiceId: string
    language: string
    onModelChange: (id: string) => void
    onVoiceChange: (id: string) => void
    onLanguageChange: (language: string) => void
    disabled?: boolean
}) {
    const selectedModel = useMemo(
        () => models.find((m) => m.id === selectedModelId),
        [models, selectedModelId],
    )

    const modelLanguages = selectedModel?.definition.languages ?? []

    const compatibleVoices = useMemo(() => {
        if (!selectedModel) return []
        const allowed = new Set(selectedModel.definition.languages.map((l) => l.toLowerCase()))
        return voices.filter((v) => allowed.has(v.language.toLowerCase()))
    }, [voices, selectedModel])

    const speechModels = useMemo(
        () =>
            models.filter((m) => {
                const caps = m.definition.capabilities as Record<string, unknown> | undefined
                return m.loading_state !== 'error' && (caps?.text_to_speech !== false)
            }),
        [models],
    )

    return (
        <div className="grid gap-4 md:grid-cols-3">
            <label className="block space-y-1.5">
                <span className="text-xs font-medium text-fg-muted">Model</span>
                <select
                    disabled={disabled}
                    value={selectedModelId}
                    onChange={(e) => onModelChange(e.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
                >
                    <option value="">Select a model…</option>
                    {speechModels.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.definition.display_name}
                        </option>
                    ))}
                </select>
            </label>

            <label className="block space-y-1.5">
                <span className="text-xs font-medium text-fg-muted">Language</span>
                <select
                    disabled={disabled || !selectedModel}
                    value={language}
                    onChange={(e) => onLanguageChange(e.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
                >
                    {modelLanguages.length === 0 && <option value="">Select a model first</option>}
                    {modelLanguages.map((lang) => (
                        <option key={lang} value={lang}>
                            {lang.toUpperCase()}
                        </option>
                    ))}
                </select>
            </label>

            <label className="block space-y-1.5">
                <span className="text-xs font-medium text-fg-muted">Voice</span>
                <select
                    disabled={disabled || !selectedModel}
                    value={selectedVoiceId}
                    onChange={(e) => onVoiceChange(e.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
                >
                    <option value="">Model default</option>
                    {compatibleVoices.map((v) => (
                        <option key={v.id} value={v.id}>
                            {v.name} ({v.language.toUpperCase()})
                        </option>
                    ))}
                </select>
            </label>
        </div>
    )
}