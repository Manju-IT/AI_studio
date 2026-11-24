'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { GenerationJobOut } from '@/types/api'
export default function DashboardPage() {
    const [jobs, setJobs] = useState<GenerationJobOut[]>([])
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    useEffect(() => { let active = true; let busy = false; async function load() { if (busy) return; busy = true; try { const rows = await api.generations.list(5); if (active) { setJobs(rows); setError('') } } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Unable to load activity') } finally { busy = false; if (active) setLoading(false) } } void load(); const timer = setInterval(() => void load(), 5000); return () => { active = false; clearInterval(timer) } }, [])
    return <main className="studio-page space-y-8"><header className="border-b border-border pb-7"><p className="studio-eyebrow mb-3">Workspace / Overview</p><h1 className="studio-heading">Dashboard</h1><p className="mt-2 text-sm text-fg-muted">Create, manage and reuse your audio.</p></header>
        <section className="studio-panel p-6"><h2 className="text-lg font-semibold">Create audio</h2><p className="mt-2 text-sm text-fg-muted">Turn a script into speech or continue an audio project.</p><div className="mt-5 flex flex-wrap gap-3"><Link className="studio-button-secondary" href="/studio">Generate speech</Link><Link className="studio-button-secondary" href="/projects">Projects</Link><Link className="studio-button-secondary" href="/audio-library">Audio library</Link><Link className="studio-button-secondary" href="/voices">Explore voices</Link></div></section>
        <section className="studio-panel p-6 space-y-4"><div className="flex justify-between"><h2 className="font-semibold">Recent generations</h2><Link href="/jobs" className="text-sm text-accent">View history</Link></div>{error && <p role="alert" className="text-danger">{error}</p>}{loading ? <p>Loading…</p> : jobs.length === 0 ? <p className="text-fg-muted">No generations yet.</p> : jobs.map(j => <div key={j.id} className="border-t border-border pt-4 space-y-2"><p className="text-sm break-words">{j.text.slice(0, 160)}</p><p className="text-xs text-fg-muted">{j.status} · {formatRelativeTime(j.created_at)}</p><div className="flex gap-4 text-sm"><Link className="text-accent" href={`/studio?reuse=${j.id}`}>Reuse script</Link>{j.audio_asset_id && <Link className="text-accent" href={`/audio-library?asset=${j.audio_asset_id}`}>Play audio</Link>}</div></div>)}</section></main>
}
