
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
    AlertCircle,
    ArrowRight,
    AudioLines,
    Check,
    ChevronDown,
    Heart,
    Loader2,
    Mic2,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Sparkles,
    Star,
    WandSparkles,
    X,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { VoiceOut } from '@/types/api'

type SourceFilter = 'all' | 'builtin' | 'cloned' | 'designed'

const filters: { id: SourceFilter; label: string }[] = [
    { id: 'all', label: 'All voices' },
    { id: 'builtin', label: 'Built-in' },
    { id: 'cloned', label: 'Cloned' },
    { id: 'designed', label: 'Designed' },
]

function getError(error: unknown): string {
    if (error instanceof ApiError || error instanceof Error) {
        return error.message
    }
    return 'Something went wrong while loading voices.'
}

function sourceLabel(source: string) {
    if (source === 'builtin') return 'Built-in'
    if (source === 'cloned') return 'Cloned'
    if (source === 'designed') return 'Designed'
    return source.replace(/_/g, ' ')
}

function VoiceIcon({ source }: { source: string }) {
    if (source === 'cloned') {
        return <Mic2 className="h-5 w-5" />
    }

    if (source === 'designed') {
        return <WandSparkles className="h-5 w-5" />
    }

    return <AudioLines className="h-5 w-5" />
}

function StatCard({
    label,
    value,
    icon: Icon,
}: {
    label: string
    value: number
    icon: typeof AudioLines
}) {
    return (
        <div className="rounded-xl border border-border bg-bg-muted p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-fg-muted">
                    {label}
                </span>
                <Icon className="h-4 w-4 text-accent" />
            </div>

            <div className="mt-3 text-2xl font-semibold tracking-tight text-fg">
                {value.toString().padStart(2, '0')}
            </div>
        </div>
    )
}

export default function VoicesPage() {
    const [voices, setVoices] = useState<VoiceOut[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [query, setQuery] = useState('')
    const [sourceFilter, setSourceFilter] =
        useState<SourceFilter>('all')
    const [favoritesOnly, setFavoritesOnly] = useState(false)
    const [favoriteBusy, setFavoriteBusy] = useState<string | null>(null)

    const loadVoices = useCallback(async (initial = false) => {
        if (initial) setLoading(true)
        else setRefreshing(true)

        setError(null)

        try {
            const result = await api.voices.list()
            setVoices(result)
        } catch (err) {
            setError(getError(err))
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [])

    useEffect(() => {
        void loadVoices(true)
    }, [loadVoices])

    const stats = useMemo(() => ({
        total: voices.length,
        builtin: voices.filter(v => v.source === 'builtin').length,
        cloned: voices.filter(v => v.source === 'cloned').length,
        designed: voices.filter(v => v.source === 'designed').length,
        favorites: voices.filter(v => v.is_favorite).length,
    }), [voices])

    const filteredVoices = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase()

        return voices
            .filter(voice => {
                if (
                    sourceFilter !== 'all' &&
                    voice.source !== sourceFilter
                ) {
                    return false
                }

                if (favoritesOnly && !voice.is_favorite) {
                    return false
                }

                if (!normalizedQuery) return true

                const searchable = [
                    voice.name,
                    voice.description ?? '',
                    voice.language,
                    voice.source,
                ].join(' ').toLowerCase()

                return searchable.includes(normalizedQuery)
            })
            .sort((a, b) => {
                if (a.is_favorite !== b.is_favorite) {
                    return a.is_favorite ? -1 : 1
                }
                return a.name.localeCompare(b.name)
            })
    }, [voices, query, sourceFilter, favoritesOnly])

    const hasFilters =
        query.trim().length > 0 ||
        sourceFilter !== 'all' ||
        favoritesOnly

    async function toggleFavorite(voice: VoiceOut) {
        if (favoriteBusy) return

        setFavoriteBusy(voice.id)
        setError(null)

        const nextFavorite = !voice.is_favorite

        // Optimistic update for a responsive interface.
        setVoices(prev =>
            prev.map(item =>
                item.id === voice.id
                    ? { ...item, is_favorite: nextFavorite }
                    : item
            )
        )

        try {
            await api.voices.favorite(voice.id, nextFavorite)
        } catch (err) {
            // Restore the original value if the request fails.
            setVoices(prev =>
                prev.map(item =>
                    item.id === voice.id
                        ? { ...item, is_favorite: voice.is_favorite }
                        : item
                )
            )
            setError(getError(err))
        } finally {
            setFavoriteBusy(null)
        }
    }

    function clearFilters() {
        setQuery('')
        setSourceFilter('all')
        setFavoritesOnly(false)
    }

    return (
        <div className="studio-page space-y-7">
            {/* Page heading */}
            <header className="flex flex-wrap items-start justify-between gap-5">
                <div>
                    <p className="studio-eyebrow mb-3">
                        Workspace / Voice library
                    </p>

                    <h1 className="studio-heading">
                        Voice Library
                    </h1>

                    <p className="mt-2 max-w-xl text-sm text-fg-muted">
                        Discover, organize, and manage your built-in,
                        cloned, and designed voices.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Link
                        href="/voice-cloning"
                        className="studio-button-secondary"
                    >
                        <Mic2 className="h-4 w-4" />
                        Clone voice
                    </Link>

                    <Link
                        href="/voice-design"
                        className="studio-button-primary"
                    >
                        <Plus className="h-4 w-4" />
                        Design voice
                    </Link>
                </div>
            </header>

            {/* Statistics */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                    label="Total voices"
                    value={stats.total}
                    icon={AudioLines}
                />
                <StatCard
                    label="Built-in voices"
                    value={stats.builtin}
                    icon={AudioLines}
                />
                <StatCard
                    label="Cloned voices"
                    value={stats.cloned}
                    icon={Mic2}
                />
                <StatCard
                    label="Designed voices"
                    value={stats.designed}
                    icon={Sparkles}
                />
            </div>

            {/* Errors */}
            {error && (
                <div
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />

                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-danger">
                            Unable to complete the request
                        </p>
                        <p className="mt-1 text-xs text-fg-muted">
                            {error}
                        </p>
                    </div>

                    <button
                        type="button"
                        aria-label="Dismiss error"
                        onClick={() => setError(null)}
                        className="rounded-md p-1 text-fg-muted hover:text-fg"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Library container */}
            <section className="overflow-hidden rounded-xl border border-border bg-bg-muted">
                <div className="border-b border-border p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-semibold text-fg">
                                Your collection
                            </h2>
                            <p className="mt-1 text-xs text-fg-muted">
                                {loading
                                    ? 'Loading your voices...'
                                    : `${filteredVoices.length} of ${voices.length} voices`}
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => void loadVoices()}
                            disabled={loading || refreshing}
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

                    {/* Search and filters */}
                    <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />

                            <input
                                type="search"
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder="Search by voice name, language, or description..."
                                aria-label="Search voices"
                                className="studio-input pl-10"
                            />
                        </div>

                        <div className="relative min-w-[150px]">
                            <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />

                            <select
                                value={sourceFilter}
                                onChange={event =>
                                    setSourceFilter(event.target.value as SourceFilter)
                                }
                                aria-label="Filter by voice source"
                                className="studio-input appearance-none pl-10 pr-9"
                            >
                                {filters.map(filter => (
                                    <option key={filter.id} value={filter.id}>
                                        {filter.label}
                                    </option>
                                ))}
                            </select>

                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                        </div>

                        <button
                            type="button"
                            aria-pressed={favoritesOnly}
                            onClick={() => setFavoritesOnly(value => !value)}
                            className={cn(
                                'studio-button-secondary',
                                favoritesOnly &&
                                'border-accent bg-accent/10 text-fg'
                            )}
                        >
                            <Star
                                className={cn(
                                    'h-4 w-4',
                                    favoritesOnly && 'fill-accent text-accent'
                                )}
                            />
                            Favorites
                            <span className="text-xs text-fg-subtle">
                                {stats.favorites}
                            </span>
                        </button>
                    </div>
                </div>

                {/* Loading */}
                {loading && (
                    <div
                        role="status"
                        className="flex min-h-[280px] flex-col items-center justify-center gap-3 p-8"
                    >
                        <Loader2 className="h-6 w-6 animate-spin text-accent" />
                        <p className="text-sm text-fg-muted">
                            Loading your voice collection...
                        </p>
                    </div>
                )}

                {/* Empty library */}
                {!loading && voices.length === 0 && (
                    <div className="flex min-h-[360px] flex-col items-center justify-center px-5 py-12 text-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-bg-elevated">
                            <AudioLines className="h-7 w-7 text-accent" />
                        </div>

                        <h3 className="mt-5 text-lg font-semibold text-fg">
                            Your voice collection starts here
                        </h3>

                        <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">
                            Create a voice profile from an authorized recording,
                            or describe a new voice and save it for future
                            synthesis.
                        </p>

                        <div className="mt-6 flex flex-wrap justify-center gap-3">
                            <Link
                                href="/voice-cloning"
                                className="studio-button-primary"
                            >
                                <Mic2 className="h-4 w-4" />
                                Clone your first voice
                                <ArrowRight className="h-4 w-4" />
                            </Link>

                            <Link
                                href="/voice-design"
                                className="studio-button-secondary"
                            >
                                <WandSparkles className="h-4 w-4" />
                                Design a voice
                            </Link>
                        </div>

                        <p className="mt-6 max-w-md text-xs leading-5 text-fg-subtle">
                            Voice profiles are stored locally. Actual voice
                            cloning and voice-design synthesis require a
                            compatible installed model.
                        </p>
                    </div>
                )}

                {/* No search results */}
                {!loading && voices.length > 0 && filteredVoices.length === 0 && (
                    <div className="flex min-h-[260px] flex-col items-center justify-center p-8 text-center">
                        <Search className="h-7 w-7 text-fg-subtle" />

                        <h3 className="mt-4 text-sm font-semibold text-fg">
                            No matching voices
                        </h3>

                        <p className="mt-2 text-xs text-fg-muted">
                            Try a different search or change your filters.
                        </p>

                        {hasFilters && (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="studio-button-secondary mt-5"
                            >
                                <X className="h-4 w-4" />
                                Clear filters
                            </button>
                        )}
                    </div>
                )}

                {/* Voice cards */}
                {!loading && filteredVoices.length > 0 && (
                    <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">
                        {filteredVoices.map(voice => (
                            <article
                                key={voice.id}
                                className="group flex min-w-0 flex-col rounded-xl border border-border bg-bg p-4 transition-colors hover:border-border-strong sm:p-5"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
                                        <VoiceIcon source={voice.source} />
                                    </div>

                                    <button
                                        type="button"
                                        disabled={favoriteBusy !== null}
                                        aria-label={
                                            voice.is_favorite
                                                ? `Remove ${voice.name} from favorites`
                                                : `Add ${voice.name} to favorites`
                                        }
                                        aria-pressed={voice.is_favorite}
                                        onClick={() => void toggleFavorite(voice)}
                                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-fg-subtle hover:border-accent/50 hover:text-accent disabled:opacity-50"
                                    >
                                        {favoriteBusy === voice.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Star
                                                className={cn(
                                                    'h-4 w-4',
                                                    voice.is_favorite &&
                                                    'fill-accent text-accent'
                                                )}
                                            />
                                        )}
                                    </button>
                                </div>

                                <div className="mt-4 min-w-0">
                                    <h3
                                        className="truncate text-base font-semibold text-fg"
                                        title={voice.name}
                                    >
                                        {voice.name}
                                    </h3>

                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <span className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] font-medium text-fg-muted">
                                            {voice.language.toUpperCase()}
                                        </span>

                                        <span className="rounded-md border border-accent/20 bg-accent/10 px-2 py-1 text-[11px] font-medium text-fg-muted">
                                            {sourceLabel(voice.source)}
                                        </span>
                                    </div>
                                </div>

                                <p className="mt-4 line-clamp-3 min-h-[42px] text-xs leading-5 text-fg-muted">
                                    {voice.description ||
                                        voice.design_prompt ||
                                        'No description provided for this voice.'}
                                </p>

                                <div className="mt-auto pt-5">
                                    <div className="studio-divider mb-4" />

                                    <div className="flex items-center justify-between gap-3">
                                        <span className="flex items-center gap-2 text-xs text-fg-muted">
                                            <AudioLines className="h-3.5 w-3.5" />
                                            {voice.samples.length}{' '}
                                            {voice.samples.length === 1
                                                ? 'sample'
                                                : 'samples'}
                                        </span>

                                        {voice.is_favorite && (
                                            <span className="flex items-center gap-1 text-[11px] font-medium text-accent">
                                                <Star className="h-3 w-3 fill-current" />
                                                Favorite
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            {/* Footer information */}
            {!loading && (
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-subtle">
                    <p>
                        Voice profiles are available to compatible local models.
                    </p>

                    <Link
                        href="/studio"
                        className="inline-flex items-center gap-2 font-medium text-accent hover:underline"
                    >
                        Open Studio
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                </div>
            )}
        </div>
    )
}
