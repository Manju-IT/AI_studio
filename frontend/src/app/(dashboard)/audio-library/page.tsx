'use client'

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import Link from 'next/link'

import {
    AlertCircle,
    ArrowDownUp,
    ArrowUpRight,
    AudioLines,
    Check,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Copy,
    Database,
    FileAudio2,
    FolderOpen,
    Grid2X2,
    HardDrive,
    Headphones,
    LayoutList,
    Loader2,
    Music2,
    Play,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    X,
} from 'lucide-react'

import { api } from '@/lib/api'
import { AudioPlayer } from '@/components/studio/AudioPlayer'
import type { AudioAssetOut } from '@/types/api'

const PAGE_SIZE = 50

type ViewMode = 'list' | 'grid'

type SortOrder =
    | 'newest'
    | 'oldest'
    | 'name'
    | 'duration'
    | 'size'

const panel =
    'rounded-xl border border-border bg-bg-muted'

const secondary =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated px-3.5 py-2.5 text-xs font-medium transition hover:border-fg-subtle disabled:cursor-not-allowed disabled:opacity-40'

const primary =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-[#29221a] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40'

function assetName(asset: AudioAssetOut) {
    return (
        asset.title?.trim() ||
        asset.original_filename ||
        'Untitled recording'
    )
}

function getError(error: unknown) {
    return error instanceof Error
        ? error.message
        : 'Unable to load audio recordings.'
}

function duration(seconds: number | null | undefined) {
    if (
        seconds == null ||
        !Number.isFinite(seconds) ||
        seconds < 0
    ) {
        return '—'
    }

    const total = Math.floor(seconds)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const remaining = total % 60

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    }

    return `${minutes}:${String(remaining).padStart(2, '0')}`
}

function fileSize(bytes: number | null | undefined) {
    if (
        bytes == null ||
        !Number.isFinite(bytes) ||
        bytes < 0
    ) {
        return '—'
    }

    if (bytes === 0) return '0 B'

    const units = ['B', 'KB', 'MB', 'GB', 'TB']

    const index = Math.min(
        units.length - 1,
        Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024))
    )

    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function dateLabel(value: string | null | undefined) {
    if (!value) return 'Not available'

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
        return 'Not available'
    }

    return date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })
}

function channelLabel(channels: number | null | undefined) {
    if (channels === 1) return 'Mono'
    if (channels === 2) return 'Stereo'

    return channels != null
        ? `${channels} channels`
        : '—'
}

function sampleRateLabel(rate: number | null | undefined) {
    return rate != null && Number.isFinite(rate)
        ? `${rate / 1000} kHz`
        : '—'
}

function FormatBadge({ format }: { format: string }) {
    return (
        <span className="inline-flex rounded-md border border-border bg-bg-elevated px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
            {format || 'Audio'}
        </span>
    )
}

function StatCard({
    label,
    value,
    description,
    icon: Icon,
}: {
    label: string
    value: string | number
    description: string
    icon: typeof Music2
}) {
    return (
        <div className={`${panel} min-w-0 p-4 sm:p-5`}>
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-fg-muted">
                    {label}
                </p>

                <Icon className="h-4 w-4 text-fg-subtle" />
            </div>

            <p className="mt-3 text-[27px] font-semibold leading-none tracking-tight tabular-nums">
                {value}
            </p>

            <p className="mt-2 text-[11px] text-fg-subtle">
                {description}
            </p>
        </div>
    )
}

function AudioArtwork({
    large = false,
}: {
    large?: boolean
}) {
    return (
        <div
            className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-accent/20 bg-accent/10 ${large ? 'h-32 w-full' : 'h-11 w-11'
                }`}
        >
            {large ? (
                <>
                    <div className="absolute h-40 w-40 rounded-full border border-accent/15" />
                    <div className="absolute h-28 w-28 rounded-full border border-accent/20" />

                    <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/30 bg-bg-muted shadow-sm">
                        <AudioLines
                            className="h-8 w-8 text-[#a37336]"
                            strokeWidth={1.5}
                        />
                    </div>
                </>
            ) : (
                <FileAudio2
                    className="h-5 w-5 text-[#a37336]"
                    strokeWidth={1.7}
                />
            )}
        </div>
    )
}

function CopyButton({
    value,
    label,
}: {
    value: string
    label: string
}) {
    const [copied, setCopied] = useState(false)
    const [failed, setFailed] = useState(false)

    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        return () => {
            if (timer.current) clearTimeout(timer.current)
        }
    }, [])

    async function copy() {
        try {
            await navigator.clipboard.writeText(value)

            setCopied(true)
            setFailed(false)

            if (timer.current) clearTimeout(timer.current)

            timer.current = setTimeout(() => {
                setCopied(false)
            }, 1800)
        } catch {
            setFailed(true)
        }
    }

    return (
        <button
            type="button"
            onClick={() => void copy()}
            aria-label={`Copy ${label}`}
            title={
                failed
                    ? 'Clipboard unavailable'
                    : copied
                        ? 'Copied'
                        : `Copy ${label}`
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-fg-muted transition hover:bg-bg-elevated"
        >
            {failed ? (
                <AlertCircle className="h-3.5 w-3.5 text-danger" />
            ) : copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
            ) : (
                <Copy className="h-3.5 w-3.5" />
            )}
        </button>
    )
}

function Metadata({
    label,
    value,
}: {
    label: string
    value: string
}) {
    return (
        <div className="min-w-0">
            <p className="text-xs text-fg-muted">
                {label}
            </p>

            <p className="mt-1 break-words text-sm font-medium">
                {value}
            </p>
        </div>
    )
}

function AudioPreview({
    asset,
    onClose,
}: {
    asset: AudioAssetOut
    onClose: () => void
}) {
    const [detailsOpen, setDetailsOpen] = useState(false)

    return (
        <section className={`${panel} overflow-hidden`}>

            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                    <h2 className="text-sm font-semibold">
                        Recording preview
                    </h2>

                    <p className="mt-1 text-xs text-fg-muted">
                        Listen and inspect audio
                    </p>
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close audio preview"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-fg-muted hover:bg-bg-elevated"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="space-y-5 p-5">

                <AudioArtwork large />

                <div>
                    <h3 className="break-words text-base font-semibold leading-6">
                        {assetName(asset)}
                    </h3>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <FormatBadge format={asset.format} />

                        <span className="text-xs text-fg-muted">
                            {duration(asset.duration_seconds)}
                        </span>

                        <span className="text-xs text-fg-subtle">·</span>

                        <span className="text-xs text-fg-muted">
                            {fileSize(asset.file_size_bytes)}
                        </span>
                    </div>
                </div>

                {/* Existing authenticated player and download */}
                <div className="min-w-0">
                    <AudioPlayer
                        key={asset.id}
                        asset={asset}
                    />
                </div>

                <div className="border-t border-border pt-4">
                    <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                        Audio properties
                    </h4>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                        <Metadata
                            label="Duration"
                            value={duration(asset.duration_seconds)}
                        />

                        <Metadata
                            label="File size"
                            value={fileSize(asset.file_size_bytes)}
                        />

                        <Metadata
                            label="Sample rate"
                            value={sampleRateLabel(asset.sample_rate)}
                        />

                        <Metadata
                            label="Channels"
                            value={channelLabel(asset.channels)}
                        />

                        <Metadata
                            label="Format"
                            value={asset.format.toUpperCase()}
                        />

                        <Metadata
                            label="Created"
                            value={dateLabel(asset.created_at)}
                        />
                    </div>
                </div>

                <div className="grid gap-2 border-t border-border pt-4">
                    <Link
                        href="/audio-tools"
                        className={`${primary} w-full`}
                    >
                        <SlidersHorizontal className="h-4 w-4" />
                        Open audio tools
                        <ArrowUpRight className="ml-auto h-3.5 w-3.5" />
                    </Link>

                    <Link
                        href="/transcriptions"
                        className={`${secondary} w-full`}
                    >
                        <AudioLines className="h-4 w-4" />
                        Open transcription workspace
                    </Link>
                </div>

                {/* Advanced metadata */}
                <div className="overflow-hidden rounded-lg border border-border">
                    <button
                        type="button"
                        aria-expanded={detailsOpen}
                        onClick={() => setDetailsOpen(value => !value)}
                        className="flex w-full items-center justify-between gap-3 bg-bg-elevated/50 px-3.5 py-3 text-left text-xs font-medium"
                    >
                        File information

                        <ChevronRight
                            className={`h-4 w-4 text-fg-muted transition-transform ${detailsOpen ? 'rotate-90' : ''
                                }`}
                        />
                    </button>

                    {detailsOpen && (
                        <div className="space-y-4 border-t border-border p-3.5">

                            <div>
                                <p className="mb-1 text-xs text-fg-muted">
                                    Original filename
                                </p>

                                <div className="flex items-center gap-2">
                                    <p className="min-w-0 flex-1 break-all text-xs">
                                        {asset.original_filename}
                                    </p>

                                    <CopyButton
                                        value={asset.original_filename}
                                        label="filename"
                                    />
                                </div>
                            </div>

                            <div>
                                <p className="mb-1 text-xs text-fg-muted">
                                    Asset ID
                                </p>

                                <div className="flex items-center gap-2">
                                    <p className="min-w-0 flex-1 break-all font-mono text-[11px]">
                                        {asset.id}
                                    </p>

                                    <CopyButton
                                        value={asset.id}
                                        label="asset ID"
                                    />
                                </div>
                            </div>

                            <Metadata
                                label="MIME type"
                                value={asset.mime_type || 'Not available'}
                            />

                            {asset.checksum_sha256 && (
                                <div>
                                    <p className="mb-1 text-xs text-fg-muted">
                                        SHA-256 checksum
                                    </p>

                                    <div className="flex items-center gap-2">
                                        <p className="min-w-0 flex-1 break-all font-mono text-[10px]">
                                            {asset.checksum_sha256}
                                        </p>

                                        <CopyButton
                                            value={asset.checksum_sha256}
                                            label="checksum"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}

export default function AudioLibrary() {
    const [rows, setRows] = useState<AudioAssetOut[]>([])
    const [selected, setSelected] =
        useState<AudioAssetOut | null>(null)

    const [search, setSearch] = useState('')
    const [format, setFormat] = useState('all')
    const [sort, setSort] = useState<SortOrder>('newest')
    const [view, setView] = useState<ViewMode>('list')

    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState('')

    const [offset, setOffset] = useState(0)

    const mounted = useRef(false)
    const listRequest = useRef(0)
    const selectionRequest = useRef(0)

    const load = useCallback(
        async (pageOffset: number, manual = false) => {
            const token = ++listRequest.current

            if (manual) {
                setRefreshing(true)
            } else {
                setLoading(true)
            }

            setError('')

            try {
                const result = await api.audio.list(
                    PAGE_SIZE,
                    undefined,
                    pageOffset
                )

                if (
                    !mounted.current ||
                    token !== listRequest.current
                ) {
                    return
                }

                setRows(result)

                // Keep the selected asset updated if it appears
                // in the refreshed page.
                setSelected(previous => {
                    if (!previous) return null

                    return result.find(
                        asset => asset.id === previous.id
                    ) ?? previous
                })
            } catch (err) {
                if (
                    mounted.current &&
                    token === listRequest.current
                ) {
                    setError(getError(err))

                    if (!manual) {
                        setRows([])
                    }
                }
            } finally {
                if (
                    mounted.current &&
                    token === listRequest.current
                ) {
                    setLoading(false)
                    setRefreshing(false)
                }
            }
        },
        []
    )

    useEffect(() => {
        mounted.current = true

        return () => {
            mounted.current = false
            listRequest.current += 1
            selectionRequest.current += 1
        }
    }, [])

    useEffect(() => {
        void load(offset)
    }, [offset, load])

    // Support opening a recording from another workspace.
    useEffect(() => {
        const id = new URLSearchParams(
            window.location.search
        ).get('asset')

        if (!id) return

        const token = ++selectionRequest.current

        void api.audio.get(id)
            .then(asset => {
                if (
                    mounted.current &&
                    token === selectionRequest.current
                ) {
                    setSelected(asset)
                }
            })
            .catch(err => {
                if (
                    mounted.current &&
                    token === selectionRequest.current
                ) {
                    setError(getError(err))
                }
            })
    }, [])

    function selectAsset(asset: AudioAssetOut) {
        selectionRequest.current += 1
        setSelected(asset)

        const url = new URL(window.location.href)
        url.searchParams.set('asset', asset.id)

        window.history.replaceState(
            window.history.state,
            '',
            url.toString()
        )
    }

    function closePreview() {
        selectionRequest.current += 1
        setSelected(null)

        const url = new URL(window.location.href)
        url.searchParams.delete('asset')

        window.history.replaceState(
            window.history.state,
            '',
            url.toString()
        )
    }

    const formats = useMemo(() => {
        return Array.from(
            new Set(
                rows.map(asset =>
                    asset.format.toLowerCase()
                )
            )
        ).sort()
    }, [rows])

    const statistics = useMemo(() => ({
        count: rows.length,

        duration: rows.reduce(
            (total, asset) =>
                total + (
                    Number.isFinite(asset.duration_seconds)
                        ? Math.max(0, asset.duration_seconds)
                        : 0
                ),
            0
        ),

        size: rows.reduce(
            (total, asset) =>
                total + (
                    Number.isFinite(asset.file_size_bytes)
                        ? Math.max(0, asset.file_size_bytes)
                        : 0
                ),
            0
        ),

        formats: formats.length,
    }), [rows, formats])

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase()

        const filtered = rows.filter(asset => {
            if (
                format !== 'all' &&
                asset.format.toLowerCase() !== format
            ) {
                return false
            }

            return [
                assetName(asset),
                asset.original_filename,
                asset.id,
                asset.format,
            ]
                .join(' ')
                .toLowerCase()
                .includes(query)
        })

        return filtered.sort((a, b) => {
            switch (sort) {
                case 'name':
                    return assetName(a).localeCompare(assetName(b))

                case 'duration':
                    return (
                        (b.duration_seconds || 0) -
                        (a.duration_seconds || 0)
                    )

                case 'size':
                    return (
                        (b.file_size_bytes || 0) -
                        (a.file_size_bytes || 0)
                    )

                case 'oldest':
                    return (
                        new Date(a.created_at).getTime() -
                        new Date(b.created_at).getTime()
                    )

                default:
                    return (
                        new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime()
                    )
            }
        })
    }, [rows, search, format, sort])

    function changePage(next: number) {
        setFormat('all')
        setOffset(Math.max(0, next))
    }

    function clearFilters() {
        setSearch('')
        setFormat('all')
        setSort('newest')
    }

    return (
        <main className="w-full min-w-0 max-w-none space-y-6 px-4 py-5 sm:px-5 lg:px-6">

            {/* Header */}
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-subtle">
                        <FolderOpen className="h-3.5 w-3.5" />
                        Workspace / Media
                    </p>

                    <h1 className="text-3xl font-semibold tracking-tight sm:text-[32px]">
                        Audio library
                    </h1>

                    <p className="mt-2 text-sm text-fg-muted">
                        Browse, preview and manage your generated recordings.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">

                    <button
                        type="button"
                        disabled={loading || refreshing}
                        onClick={() => void load(offset, true)}
                        className={secondary}
                    >
                        <RefreshCw
                            className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''
                                }`}
                        />
                        Refresh
                    </button>

                    <Link href="/audio-tools" className={secondary}>
                        <SlidersHorizontal className="h-4 w-4" />
                        Audio tools
                    </Link>

                    <Link href="/studio" className={primary}>
                        <Plus className="h-4 w-4" />
                        Generate audio
                    </Link>
                </div>
            </header>

            {/* Error notification */}
            {error && (
                <div
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

                    <span className="min-w-0 flex-1 break-words">
                        {error}
                    </span>

                    <button
                        type="button"
                        aria-label="Dismiss error"
                        onClick={() => setError('')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Library statistics */}
            <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">

                <StatCard
                    label="Recordings"
                    value={loading ? '—' : statistics.count}
                    description="Files on this page"
                    icon={FileAudio2}
                />

                <StatCard
                    label="Total duration"
                    value={
                        loading
                            ? '—'
                            : duration(statistics.duration)
                    }
                    description="Combined audio length"
                    icon={Clock3}
                />

                <StatCard
                    label="Audio storage"
                    value={
                        loading
                            ? '—'
                            : fileSize(statistics.size)
                    }
                    description="Size of displayed recordings"
                    icon={HardDrive}
                />

                <StatCard
                    label="File formats"
                    value={loading ? '—' : statistics.formats}
                    description="Distinct formats on this page"
                    icon={Database}
                />
            </section>

            {/* Main media workspace */}
            <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]">

                {/* Audio collection */}
                <section className={`${panel} min-w-0 overflow-hidden`}>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
                        <div>
                            <h2 className="text-base font-semibold">
                                Your recordings
                            </h2>

                            <p className="mt-1 text-xs text-fg-muted">
                                Select a recording to preview and inspect it.
                            </p>
                        </div>

                        <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated p-1">

                            <button
                                type="button"
                                aria-label="List view"
                                aria-pressed={view === 'list'}
                                onClick={() => setView('list')}
                                className={`flex h-8 w-9 items-center justify-center rounded-md transition ${view === 'list'
                                        ? 'bg-accent/15 text-fg'
                                        : 'text-fg-muted hover:text-fg'
                                    }`}
                            >
                                <LayoutList className="h-4 w-4" />
                            </button>

                            <button
                                type="button"
                                aria-label="Grid view"
                                aria-pressed={view === 'grid'}
                                onClick={() => setView('grid')}
                                className={`flex h-8 w-9 items-center justify-center rounded-md transition ${view === 'grid'
                                        ? 'bg-accent/15 text-fg'
                                        : 'text-fg-muted hover:text-fg'
                                    }`}
                            >
                                <Grid2X2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Library toolbar */}
                    <div className="space-y-3 border-b border-border p-4">

                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />

                            <input
                                type="search"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search title, filename or asset ID..."
                                aria-label="Search recordings"
                                className="h-11 w-full rounded-lg border border-border bg-bg-elevated pl-10 pr-3 text-sm outline-none focus:border-accent"
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3">

                            <div className="flex flex-wrap items-center gap-2">

                                <select
                                    value={format}
                                    onChange={e => setFormat(e.target.value)}
                                    aria-label="Filter audio format"
                                    className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-xs outline-none focus:border-accent"
                                >
                                    <option value="all">
                                        All formats
                                    </option>

                                    {formats.map(value => (
                                        <option key={value} value={value}>
                                            {value.toUpperCase()}
                                        </option>
                                    ))}
                                </select>

                                <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3">
                                    <ArrowDownUp className="h-3.5 w-3.5 text-fg-muted" />

                                    <select
                                        value={sort}
                                        onChange={e =>
                                            setSort(e.target.value as SortOrder)
                                        }
                                        aria-label="Sort recordings"
                                        className="h-9 bg-transparent text-xs outline-none"
                                    >
                                        <option value="newest">Newest first</option>
                                        <option value="oldest">Oldest first</option>
                                        <option value="name">Name A–Z</option>
                                        <option value="duration">Longest duration</option>
                                        <option value="size">Largest file</option>
                                    </select>
                                </div>
                            </div>

                            <p className="text-xs text-fg-muted">
                                {visible.length} recordings
                            </p>
                        </div>
                    </div>

                    {/* Library contents */}
                    {loading ? (
                        <div className="flex min-h-80 items-center justify-center gap-3 text-sm text-fg-muted">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Loading recordings...
                        </div>
                    ) : visible.length === 0 ? (
                        <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">

                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated">
                                <Headphones className="h-8 w-8 text-fg-subtle" />
                            </div>

                            <h3 className="mt-4 text-sm font-semibold">
                                {rows.length
                                    ? 'No matching recordings'
                                    : error
                                        ? 'Unable to load recordings'
                                        : 'No recordings on this page'}
                            </h3>

                            <p className="mt-2 max-w-sm text-xs leading-5 text-fg-muted">
                                {rows.length
                                    ? 'Try changing your search or audio format filter.'
                                    : error
                                        ? 'Refresh the library to try again.'
                                        : 'Generated and processed audio files will appear in your library.'}
                            </p>

                            {rows.length > 0 ? (
                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    className={`${secondary} mt-4`}
                                >
                                    Clear filters
                                </button>
                            ) : (
                                !error && (
                                    <Link
                                        href="/studio"
                                        className={`${primary} mt-4`}
                                    >
                                        <Plus className="h-4 w-4" />
                                        Generate audio
                                    </Link>
                                )
                            )}
                        </div>
                    ) : view === 'list' ? (

                        /* Compact table view */
                        <div className="max-h-[650px] overflow-auto">
                            <table className="w-full min-w-[590px] text-left">

                                <thead className="sticky top-0 z-10 border-b border-border bg-bg-elevated">
                                    <tr className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                                        <th className="px-4 py-3">
                                            Recording
                                        </th>
                                        <th className="px-3 py-3">
                                            Duration
                                        </th>
                                        <th className="px-3 py-3">
                                            Size
                                        </th>
                                        <th className="px-4 py-3 text-right">
                                            Preview
                                        </th>
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-border">
                                    {visible.map(asset => {
                                        const active =
                                            selected?.id === asset.id

                                        return (
                                            <tr
                                                key={asset.id}
                                                className={`transition ${active
                                                        ? 'bg-accent/10'
                                                        : 'hover:bg-bg-elevated/50'
                                                    }`}
                                            >
                                                <td className="px-4 py-3.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => selectAsset(asset)}
                                                        className="flex w-full min-w-0 items-center gap-3 text-left"
                                                    >
                                                        <AudioArtwork />

                                                        <div className="min-w-0 flex-1">
                                                            <p
                                                                className="max-w-[340px] truncate text-sm font-medium"
                                                                title={assetName(asset)}
                                                            >
                                                                {assetName(asset)}
                                                            </p>

                                                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                                                <FormatBadge
                                                                    format={asset.format}
                                                                />

                                                                <span className="text-[11px] text-fg-subtle">
                                                                    {dateLabel(asset.created_at)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </button>
                                                </td>

                                                <td className="whitespace-nowrap px-3 py-3.5 text-xs tabular-nums text-fg-muted">
                                                    {duration(asset.duration_seconds)}
                                                </td>

                                                <td className="whitespace-nowrap px-3 py-3.5 text-xs tabular-nums text-fg-muted">
                                                    {fileSize(asset.file_size_bytes)}
                                                </td>

                                                <td className="px-4 py-3.5">
                                                    <div className="flex justify-end">
                                                        <button
                                                            type="button"
                                                            aria-label={`Preview ${assetName(asset)}`}
                                                            aria-pressed={active}
                                                            onClick={() => selectAsset(asset)}
                                                            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${active
                                                                    ? 'border-accent/30 bg-accent text-[#29221a]'
                                                                    : 'border-border bg-bg-elevated text-fg-muted hover:border-accent'
                                                                }`}
                                                        >
                                                            {active ? (
                                                                <Check className="h-4 w-4" />
                                                            ) : (
                                                                <Play className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (

                        /* Grid view */
                        <div className="grid max-h-[650px] gap-3 overflow-y-auto p-4 sm:grid-cols-2 2xl:grid-cols-3">

                            {visible.map(asset => {
                                const active =
                                    selected?.id === asset.id

                                return (
                                    <button
                                        key={asset.id}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => selectAsset(asset)}
                                        className={`group min-w-0 rounded-xl border p-3 text-left transition ${active
                                                ? 'border-accent bg-accent/5'
                                                : 'border-border bg-bg-elevated/30 hover:border-accent/50'
                                            }`}
                                    >
                                        <div className="relative flex h-24 items-center justify-center rounded-lg bg-accent/10">
                                            <AudioLines
                                                className="h-8 w-8 text-[#a37336]"
                                                strokeWidth={1.5}
                                            />

                                            <div className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg-muted shadow-sm">
                                                {active ? (
                                                    <Check className="h-4 w-4 text-success" />
                                                ) : (
                                                    <Play className="h-3.5 w-3.5" />
                                                )}
                                            </div>
                                        </div>

                                        <h3
                                            title={assetName(asset)}
                                            className="mt-3 truncate text-sm font-medium"
                                        >
                                            {assetName(asset)}
                                        </h3>

                                        <div className="mt-2 flex items-center justify-between gap-2">
                                            <FormatBadge
                                                format={asset.format}
                                            />

                                            <span className="text-xs text-fg-muted">
                                                {duration(asset.duration_seconds)}
                                            </span>
                                        </div>

                                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-fg-subtle">
                                            <span>
                                                {fileSize(asset.file_size_bytes)}
                                            </span>

                                            <span>
                                                {dateLabel(asset.created_at)}
                                            </span>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}

                    {/* Pagination */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4">

                        <div>
                            <p className="text-xs font-medium">
                                Page {Math.floor(offset / PAGE_SIZE) + 1}
                            </p>

                            <p className="mt-1 text-[11px] text-fg-subtle">
                                {rows.length
                                    ? `Records ${offset + 1}–${offset + rows.length}`
                                    : 'No records'}
                            </p>
                        </div>

                        <div className="flex items-center gap-2">

                            <button
                                type="button"
                                disabled={offset === 0 || loading || refreshing}
                                onClick={() =>
                                    changePage(offset - PAGE_SIZE)
                                }
                                className={secondary}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Previous
                            </button>

                            <button
                                type="button"
                                disabled={
                                    rows.length < PAGE_SIZE ||
                                    loading ||
                                    refreshing
                                }
                                onClick={() =>
                                    changePage(offset + PAGE_SIZE)
                                }
                                className={secondary}
                            >
                                Next
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </section>

                {/* Selected recording workspace */}
                <aside className="min-w-0 space-y-4">

                    {selected ? (
                        <AudioPreview
                            key={selected.id}
                            asset={selected}
                            onClose={closePreview}
                        />
                    ) : (
                        <section className={`${panel} overflow-hidden`}>

                            <div className="border-b border-border px-5 py-4">
                                <h2 className="text-sm font-semibold">
                                    Recording preview
                                </h2>

                                <p className="mt-1 text-xs text-fg-muted">
                                    Audio playback and properties
                                </p>
                            </div>

                            <div className="flex min-h-80 flex-col items-center justify-center px-6 py-10 text-center">

                                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10">
                                    <Headphones
                                        className="h-9 w-9 text-[#a37336]"
                                        strokeWidth={1.5}
                                    />
                                </div>

                                <h3 className="mt-5 text-sm font-semibold">
                                    Select a recording
                                </h3>

                                <p className="mt-2 max-w-[250px] text-xs leading-6 text-fg-muted">
                                    Choose any audio file from your library
                                    to listen, download and view its properties.
                                </p>

                                {visible.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => selectAsset(visible[0])}
                                        className={`${secondary} mt-5`}
                                    >
                                        <Play className="h-3.5 w-3.5" />
                                        Preview first recording
                                    </button>
                                )}
                            </div>
                        </section>
                    )}

                    {/* Quick actions */}
                    <section className={`${panel} p-4`}>
                        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                            Quick actions
                        </h2>

                        <div className="space-y-1">

                            {[
                                {
                                    href: '/studio',
                                    title: 'Generate new audio',
                                    description: 'Create speech from text',
                                    icon: AudioLines,
                                },
                                {
                                    href: '/audio-tools',
                                    title: 'Edit audio',
                                    description: 'Trim, merge and enhance',
                                    icon: SlidersHorizontal,
                                },
                                {
                                    href: '/projects',
                                    title: 'Open projects',
                                    description: 'Create longer recordings',
                                    icon: FolderOpen,
                                },
                            ].map(item => {
                                const Icon = item.icon

                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className="group flex items-center gap-3 rounded-lg p-2.5 transition hover:bg-bg-elevated"
                                    >
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated">
                                            <Icon className="h-4 w-4 text-fg-muted" />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-medium">
                                                {item.title}
                                            </p>

                                            <p className="mt-1 text-[11px] text-fg-subtle">
                                                {item.description}
                                            </p>
                                        </div>

                                        <ArrowUpRight className="h-3.5 w-3.5 text-fg-subtle group-hover:text-fg" />
                                    </Link>
                                )
                            })}
                        </div>
                    </section>
                </aside>
            </div>

            <p className="text-xs leading-5 text-fg-subtle">
                Search, sorting, format filters and storage statistics
                apply to the current page of recordings.
                Audio files are accessed through your existing
                authenticated local backend.
            </p>
        </main>
    )
}