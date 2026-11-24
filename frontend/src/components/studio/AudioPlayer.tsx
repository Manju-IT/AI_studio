'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Play, Pause } from 'lucide-react'
import { api, API_BASE_URL } from '@/lib/api'
import { formatDuration } from '@/lib/utils'
import type { AudioAssetOut } from '@/types/api'

const BAR_COUNT = 96

export function AudioPlayer({ asset }: { asset: AudioAssetOut }) {
    const [audioUrl, setAudioUrl] = useState<string | null>(null)
    const [peaks, setPeaks] = useState<number[]>([])
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(asset.duration_seconds)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        let cancelled = false
        let objectUrl: string | null = null

            ; (async () => {
                try {
                    objectUrl = await api.fetchAudioBlobUrl(asset.id)
                    if (cancelled) { URL.revokeObjectURL(objectUrl); return }
                    setAudioUrl(objectUrl)

                    const response = await fetch(objectUrl)
                    const buffer = await response.arrayBuffer()
                    const audioContext = new AudioContext()
                    const audioBuffer = await audioContext.decodeAudioData(buffer)
                    const channel = audioBuffer.getChannelData(0)
                    const blockSize = Math.max(1, Math.floor(channel.length / BAR_COUNT))
                    const result: number[] = []
                    for (let i = 0; i < BAR_COUNT; i++) {
                        let max = 0
                        const base = i * blockSize
                        for (let j = 0; j < blockSize; j++) {
                            const v = Math.abs(channel[base + j] ?? 0)
                            if (v > max) max = v
                        }
                        result.push(max)
                    }
                    const overall = Math.max(...result, 0.001)
                    if (!cancelled) setPeaks(result.map((v) => v / overall))
                    await audioContext.close()
                } catch {
                    /* leave player empty if decoding fails */
                }
            })()

        return () => {
            cancelled = true
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [asset.id])

    useEffect(() => {
        const el = audioRef.current
        if (!el) return
        const onTime = () => setCurrentTime(el.currentTime)
        const onMeta = () => setDuration(el.duration || asset.duration_seconds)
        const onEnd = () => setIsPlaying(false)
        el.addEventListener('timeupdate', onTime)
        el.addEventListener('loadedmetadata', onMeta)
        el.addEventListener('ended', onEnd)
        return () => {
            el.removeEventListener('timeupdate', onTime)
            el.removeEventListener('loadedmetadata', onMeta)
            el.removeEventListener('ended', onEnd)
        }
    }, [asset.duration_seconds, audioUrl])

    function toggle() {
        const el = audioRef.current
        if (!el) return
        if (el.paused) {
            void el.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
        } else {
            el.pause()
            setIsPlaying(false)
        }
    }

    function seek(event: React.MouseEvent<HTMLDivElement>) {
        const el = audioRef.current
        if (!el || !duration) return
        const rect = event.currentTarget.getBoundingClientRect()
        const pct = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
        el.currentTime = pct * duration
        setCurrentTime(el.currentTime)
    }

    const playedPct = duration ? (currentTime / duration) * 100 : 0

    return (
        <div className="space-y-3 rounded-lg border border-border bg-bg-muted p-4">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={toggle}
                    disabled={!audioUrl}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white disabled:opacity-50"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <div className="flex-1">
                    <div
                        onClick={seek}
                        role="presentation"
                        className="relative flex h-12 cursor-pointer items-center gap-[2px] rounded-md bg-bg-elevated px-2"
                    >
                        {peaks.length > 0
                            ? peaks.map((p, i) => {
                                const left = (i / BAR_COUNT) * 100
                                const played = left < playedPct
                                return (
                                    <span
                                        key={i}
                                        className={played ? 'bg-accent' : 'bg-fg-subtle'}
                                        style={{
                                            height: `${Math.max(6, p * 100)}%`,
                                            width: `calc(${100 / BAR_COUNT}% - 2px)`,
                                        }}
                                    />
                                )
                            })
                            : Array.from({ length: BAR_COUNT }).map((_, i) => (
                                <span
                                    key={i}
                                    className="bg-fg-subtle/30"
                                    style={{
                                        height: '30%',
                                        width: `calc(${100 / BAR_COUNT}% - 2px)`,
                                    }}
                                />
                            ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-fg-subtle">
                        <span>{formatDuration(currentTime)}</span>
                        <span>{formatDuration(duration)}</span>
                    </div>
                </div>
                <a
                    href={`${API_BASE_URL}/api/v1/audio/${asset.id}/download`}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
                    download
                >
                    <Download className="h-3.5 w-3.5" />
                    Download
                </a>
            </div>
            {audioUrl && (
                <audio ref={audioRef} src={audioUrl} preload="metadata" className="hidden" />
            )}
        </div>
    )
}