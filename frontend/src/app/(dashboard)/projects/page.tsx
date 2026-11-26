'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState, useRef } from 'react'
import { FolderOpen, Plus, Search, Archive, ArrowUpRight, LayoutGrid, List, ChevronLeft, ChevronRight, Trash2, RotateCcw, X, Pencil, RefreshCw, AudioLines } from 'lucide-react'
import { api } from '@/lib/api'
import type { ProjectOut } from '@/types/api'
import './projects-workspace.css'

export default function ProjectsPage() {
    const [rows, setRows] = useState<ProjectOut[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
    const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [sort, setSort] = useState('new'), [view, setView] = useState('grid'), [page, setPage] = useState(1), [size, setSize] = useState(6)
    const [form, setForm] = useState<'create' | 'edit' | null>(null), [editing, setEditing] = useState<string | null>(null), [name, setName] = useState(''), [description, setDescription] = useState(''), [formError, setFormError] = useState('')
    const dialog = useRef<HTMLDialogElement>(null)
    useEffect(() => { let alive = true; api.projects.list().then(r => { if (alive) setRows(r) }).catch(e => { if (alive) setError(String(e.message || e)) }).finally(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [])
    useEffect(() => { if (form && !dialog.current?.open) dialog.current?.showModal(); else if (!form && dialog.current?.open) dialog.current.close() }, [form])
    const active = rows.filter(p => !p.is_archived).length
    const filtered = useMemo(() => rows.filter(p => (filter === 'all' || (filter === 'archived' ? p.is_archived : !p.is_archived)) && `${p.name} ${p.description || ''}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'old' ? Date.parse(a.created_at) - Date.parse(b.created_at) : Date.parse(b.created_at) - Date.parse(a.created_at)), [rows, filter, query, sort])
    const pages = Math.max(1, Math.ceil(filtered.length / size)), current = Math.min(page, pages), visible = filtered.slice((current - 1) * size, current * size)
    useEffect(() => { setPage(p => Math.min(p, pages)) }, [pages])
    async function action(fn: () => Promise<void>, inForm = false) { if (busy) return; setBusy(true); setError(''); setFormError(''); try { await fn() } catch (e) { (inForm ? setFormError : setError)(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
    function open(p?: ProjectOut) { setEditing(p?.id || null); setName(p?.name || ''); setDescription(p?.description || ''); setFormError(''); setForm(p ? 'edit' : 'create') }
    function close() { if (!busy) setForm(null) }
    function refresh() { void action(async () => { setRows(await api.projects.list()) }) }
    return <main className="project-workspace">
        <section className="pw-hero"><div><span className="pw-kicker">WORKSPACE / AUDIO PRODUCTION</span><h1>Ideas into <em>productions.</em></h1><p>Organize scripts, dialogue and dubbing in one dedicated workspace.</p><button className="pw-primary" disabled={busy || loading} onClick={() => open()}><Plus size={18} /> New project</button></div><div className="pw-art" aria-hidden="true"><div className="pw-orbit" /><div className="pw-art-card"><AudioLines size={28} /><span>PRODUCTION WORKSPACE</span><div className="pw-bars">
            <div>
                {Array.from({ length: 32 }, (_, i) => {
                    const height = (
                        12 + Math.abs(
                            Math.sin(i * 0.61) * Math.cos(i * 0.19)
                        ) * 70
                    ).toFixed(4);

                    const delay = i * 45;

                    return (
                        <i
                            key={i}
                            style={{
                                height: `${height}%`,
                                animationDelay: `${delay}ms`,
                            }}

                        />
                    );
                })}
            </div>
        </div></div></div></section>
        <section className="pw-stats" aria-label="Project summary">{[['Total projects', rows.length], ['Active productions', active], ['Archived projects', rows.length - active]].map(([label, n]) => <div key={label}><span>{label}</span><strong>{loading ? '—' : n}</strong></div>)}</section>
        <section className="pw-library"><div className="pw-heading"><div><span className="pw-kicker">YOUR LIBRARY</span><h2>Projects</h2></div><button className="pw-button" disabled={busy || loading} onClick={refresh}><RefreshCw size={15} /> Refresh</button></div>
            {error && <p className="pw-error" role="alert">{error}</p>}
            <div className="pw-toolbar"><div className="pw-tabs" aria-label="Filter projects">{['all', 'active', 'archived'].map(f => <button key={f} aria-pressed={filter === f} onClick={() => { setFilter(f); setPage(1) }}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div><label className="pw-search"><Search size={17} /><input aria-label="Search projects" placeholder="Search projects…" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} /></label><select aria-label="Sort projects" value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}><option value="new">Newest first</option><option value="old">Oldest first</option><option value="name">Name A–Z</option></select><div className="pw-view"><button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={17} /></button><button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} /></button></div></div>
            {loading ? <div className="pw-empty" role="status">Loading projects…</div> : !visible.length ? <div className="pw-empty"><FolderOpen size={36} /><h3>{rows.length ? 'No matching projects' : 'Your next production starts here'}</h3><p>{rows.length ? 'Try another search or filter.' : 'Create a project to organize your audio.'}</p><button className="pw-button" onClick={() => { if (rows.length) { setQuery(''); setFilter('all'); setPage(1) } else open() }}>{rows.length ? 'Reset filters' : 'Create project'}</button></div> : <div className={`pw-items ${view === 'list' ? 'pw-list' : ''}`}>{visible.map(p => <article key={p.id} className="pw-card"><div className="pw-card-top"><span className="pw-folder"><FolderOpen size={22} /></span><span className={`pw-status ${p.is_archived ? 'archived' : ''}`}>{p.is_archived ? 'Archived' : 'Active'}</span></div><div className="pw-card-copy"><h3 title={p.name}>{p.name}</h3><p title={p.description || ''}>{p.description || 'No description'}</p><small>{p.folders.length} folders · {new Date(p.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div><div className="pw-actions"><Link className="pw-open" href={`/projects/${p.id}`}>Open editor <ArrowUpRight size={15} /></Link><button className="pw-icon" title="Edit details" aria-label={`Edit ${p.name}`} disabled={busy} onClick={() => open(p)}><Pencil size={16} /></button><button className="pw-icon" title={p.is_archived ? 'Restore' : 'Archive'} aria-label={`${p.is_archived ? 'Restore' : 'Archive'} ${p.name}`} disabled={busy} onClick={() => void action(async () => { const updated = await api.projects.update(p.id, { is_archived: !p.is_archived }); setRows(old => old.map(x => x.id === p.id ? updated : x)) })}>{p.is_archived ? <RotateCcw size={16} /> : <Archive size={16} />}</button><button className="pw-icon pw-delete" title="Delete project" aria-label={`Delete ${p.name}`} disabled={busy} onClick={() => { if (window.confirm(`Delete ${p.name} and its script? Existing audio may remain in the library.`)) void action(async () => { await api.projects.delete(p.id); setRows(old => old.filter(x => x.id !== p.id)) }) }}><Trash2 size={16} /></button></div></article>)}</div>}
            <footer className="pw-pagination"><span>{filtered.length ? `${(current - 1) * size + 1}–${Math.min(current * size, filtered.length)} of ${filtered.length} projects` : '0 projects'}</span><div><label>Per page <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1) }}>{[6, 12, 24].map(n => <option key={n}>{n}</option>)}</select></label><button className="pw-icon" aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft size={18} /></button><span>{current} / {pages}</span><button className="pw-icon" aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)}><ChevronRight size={18} /></button></div></footer></section>
        <dialog ref={dialog} className="pw-dialog" onCancel={e => { e.preventDefault(); close() }}><form onSubmit={e => { e.preventDefault(); if (!name.trim()) return; void action(async () => { if (editing) { const p = await api.projects.update(editing, { name: name.trim(), description }); setRows(old => old.map(x => x.id === p.id ? p : x)) } else { const p = await api.projects.create({ name: name.trim(), description }); setRows(old => [p, ...old]); setFilter('all'); setQuery(''); setSort('new'); setPage(1) } setForm(null) }, true) }}><div className="pw-heading"><h2>{editing ? 'Edit project' : 'New project'}</h2><button type="button" className="pw-icon" aria-label="Close" disabled={busy} onClick={close}><X size={20} /></button></div><label>Project name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoFocus /></label><label>Description (optional)<textarea maxLength={5000} rows={4} value={description} onChange={e => setDescription(e.target.value)} /></label>{formError && <p role="alert" className="pw-error">{formError}</p>}<div className="pw-actions"><button type="button" className="pw-button" disabled={busy} onClick={close}>Cancel</button><button className="pw-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create project'}</button></div></form></dialog>
    </main>
}
