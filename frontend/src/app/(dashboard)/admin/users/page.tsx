'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Plus, RefreshCw, Search, Shield, UserRound, Users, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { UserPublic } from '@/types/api'

type Role = 'admin' | 'member'
type Filter = 'all' | 'active' | 'inactive' | 'admins'
type Action = { id: string; kind: 'role' | 'active' } | null

const field = 'h-10 w-full rounded-xl border border-[#e4e1db] bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#e5e2dc] bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40'
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'
const panel = 'rounded-2xl border border-[#e9e5df] bg-white shadow-[0_4px_20px_rgba(35,35,35,0.035)]'
const readableError = (err: unknown) => err instanceof ApiError || err instanceof Error ? err.message : 'The request failed.'

function SummaryCard({ label, value, icon: Icon, loading }: { label: string; value: number; icon: typeof Users; loading: boolean }) {
    return (
        <div className={`${panel} p-5`}>
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-500">{label}</span>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4f2ee] text-slate-500"><Icon className="h-[18px] w-[18px]" /></span>
            </div>
            <div className="mt-3 text-[30px] font-semibold leading-none tracking-tight text-slate-900">{loading ? '—' : String(value).padStart(2, '0')}</div>
        </div>
    )
}

export default function AdminUsersPage() {
    const [users, setUsers] = useState<UserPublic[]>([])
    const [me, setMe] = useState<UserPublic | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<Filter>('all')
    const [showForm, setShowForm] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState<Role>('member')
    const [confirm, setConfirm] = useState<Action>(null)
    const mounted = useRef(false)
    const requestId = useRef(0)
    const operationLock = useRef(false)

    const refresh = useCallback(async (initial = false) => {
        const id = ++requestId.current
        if (initial) setLoading(true)
        else setRefreshing(true)
        try {
            const [accounts, current] = await Promise.all([api.auth.listUsers(), api.auth.me()])
            if (!mounted.current || id !== requestId.current) return
            setUsers(accounts)
            setMe(current)
            setError('')
        } catch (err) {
            if (mounted.current && id === requestId.current) setError(readableError(err))
        } finally {
            if (mounted.current && id === requestId.current) {
                setLoading(false)
                setRefreshing(false)
            }
        }
    }, [])

    useEffect(() => {
        mounted.current = true
        void refresh(true)
        return () => { mounted.current = false; requestId.current += 1 }
    }, [refresh])

    useEffect(() => {
        if (!confirm) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !operationLock.current) setConfirm(null)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [confirm])

    const visible = useMemo(() => users.filter(user => {
        const matches = `${user.display_name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase())
        return matches && (filter === 'all' || (filter === 'active' && user.is_active) || (filter === 'inactive' && !user.is_active) || (filter === 'admins' && user.role === 'admin'))
    }), [users, query, filter])

    const activeCount = users.filter(user => user.is_active).length
    const adminCount = users.filter(user => user.role === 'admin').length

    async function createUser(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (operationLock.current || !name.trim() || !email.trim() || password.length < 10) return
        operationLock.current = true
        setBusy('create'); setError(''); setNotice('')
        try {
            await api.auth.createUser({ email: email.trim(), display_name: name.trim(), password, role })
            if (!mounted.current) return
            setEmail(''); setName(''); setPassword(''); setRole('member'); setShowPassword(false); setShowForm(false)
            setNotice('Account created successfully.')
            await refresh()
        } catch (err) { if (mounted.current) setError(readableError(err)) }
        finally { operationLock.current = false; if (mounted.current) setBusy(null) }
    }

    async function applyChange() {
        if (!confirm || operationLock.current) return
        const user = users.find(item => item.id === confirm.id)
        if (!user || user.id === me?.id) { setConfirm(null); return }
        const action = confirm
        operationLock.current = true
        setBusy(user.id); setError(''); setNotice('')
        try {
            if (action.kind === 'role') {
                await api.auth.updateUser(user.id, { role: user.role === 'admin' ? 'member' : 'admin' })
                if (mounted.current) setNotice(`Updated permissions for ${user.display_name}.`)
            } else if (user.is_active) {
                await api.auth.deactivateUser(user.id)
                if (mounted.current) setNotice(`${user.display_name} has been deactivated.`)
            } else {
                await api.auth.updateUser(user.id, { is_active: true })
                if (mounted.current) setNotice(`${user.display_name} has been reactivated.`)
            }
            if (mounted.current) { setConfirm(null); await refresh() }
        } catch (err) { if (mounted.current) setError(readableError(err)) }
        finally { operationLock.current = false; if (mounted.current) setBusy(null) }
    }

    const target = confirm ? users.find(user => user.id === confirm.id) : null
    const isCreating = busy === 'create'

    return (
        <main className="studio-light-tools w-full min-h-screen space-y-6 px-0 py-6 text-slate-900">

            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500"><Shield className="h-3.5 w-3.5" /> Administration <span className="text-slate-300">/</span> Access control</p>
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px]">Workspace users</h1>
                    <p className="mt-2 text-sm text-slate-500">Manage local workspace accounts, permissions, and access.</p>
                </div>
                <button type="button" disabled={busy !== null} onClick={() => setShowForm(value => !value)} className={primary}>
                    {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{showForm ? 'Close form' : 'Add user'}
                </button>
            </header>

            {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 break-words">{error}</span><button type="button" className="text-rose-600 hover:text-rose-900" aria-label="Dismiss error" onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}
            {notice && <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{notice}</span><button type="button" className="text-emerald-700 hover:text-emerald-900" aria-label="Dismiss notice" onClick={() => setNotice('')}><X className="h-4 w-4" /></button></div>}

            <section aria-label="Account summary" className="grid gap-3 sm:grid-cols-3">
                <SummaryCard label="Total accounts" value={users.length} icon={Users} loading={loading} />
                <SummaryCard label="Active accounts" value={activeCount} icon={UserRound} loading={loading} />
                <SummaryCard label="Administrators" value={adminCount} icon={Shield} loading={loading} />
            </section>

            {
                showForm && <section className={`${panel} p-5 sm:p-6`}>
                    <div className="mb-5"><h2 className="text-base font-semibold text-slate-900">Create an account</h2><p className="mt-1 text-xs leading-5 text-slate-500">The account is created immediately with an initial password. No email invitation is sent.</p></div>
                    <form onSubmit={createUser} className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-1.5 text-xs font-semibold text-slate-700">Display name<input required maxLength={200} autoComplete="off" disabled={busy !== null} className={field} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alex Morgan" /></label>
                        <label className="space-y-1.5 text-xs font-semibold text-slate-700">Email address<input required type="email" autoComplete="off" disabled={busy !== null} className={field} value={email} onChange={e => setEmail(e.target.value)} placeholder="alex@company.com" /></label>
                        <label className="space-y-1.5 text-xs font-semibold text-slate-700">Initial password<div className="relative"><input required minLength={10} autoComplete="new-password" disabled={busy !== null} type={showPassword ? 'text' : 'password'} className={`${field} pr-11`} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 10 characters" /><button type="button" disabled={busy !== null} aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
                        <label className="space-y-1.5 text-xs font-semibold text-slate-700">Workspace role<select className={field} disabled={busy !== null} value={role} onChange={e => setRole(e.target.value as Role)}><option value="member">Member — standard access</option><option value="admin">Administrator — account management</option></select></label>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0ede8] pt-4 sm:col-span-2"><p className="max-w-md text-xs leading-5 text-slate-500">Use a unique password and share it securely with the account owner.</p><button type="submit" disabled={busy !== null || password.length < 10 || !name.trim() || !email.trim()} className={primary}>{isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{isCreating ? 'Creating account…' : 'Create account'}</button></div>
                    </form>
                </section>
            }

            <section className={`${panel} overflow-hidden`}>
                <div className="flex flex-col gap-4 border-b border-[#eeeae5] p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div><h2 className="text-base font-semibold text-slate-900">Account directory</h2><p className="mt-1 text-xs text-slate-500">Showing {visible.length} of {users.length} accounts</p></div>
                    <div className="flex flex-wrap gap-2">
                        <div className="relative min-w-44 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or email" aria-label="Search accounts" className={`${field} pl-9`} /></div>
                        <select aria-label="Filter accounts" className={`${field} w-auto min-w-32`} value={filter} onChange={e => setFilter(e.target.value as Filter)}><option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="admins">Administrators</option></select>
                        <button type="button" className={`${secondary} min-h-10`} disabled={loading || refreshing || busy !== null} onClick={() => void refresh()}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /><span>Refresh</span></button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[780px] text-left text-sm">
                        <thead className="bg-[#faf9f7] text-xs text-slate-500"><tr><th scope="col" className="px-5 py-3 font-semibold">Account</th><th scope="col" className="px-5 py-3 font-semibold">Role</th><th scope="col" className="px-5 py-3 font-semibold">Status</th><th scope="col" className="px-5 py-3 font-semibold">Created</th><th scope="col" className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead>
                        <tbody className="divide-y divide-[#f0ede8]">
                            {loading && <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-indigo-500" />Loading accounts...</td></tr>}
                            {!loading && visible.length === 0 && <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500"><Users className="mx-auto mb-3 h-7 w-7 text-slate-300" />{users.length === 0 ? 'No accounts found.' : 'No accounts match the current filters.'}{users.length > 0 && <button type="button" onClick={() => { setQuery(''); setFilter('all') }} className="mx-auto mt-3 block text-xs font-semibold text-indigo-600 hover:text-indigo-500">Clear filters</button>}</td></tr>}
                            {!loading && visible.map(user => {
                                const self = me?.id === user.id
                                return <tr key={user.id} className="transition-colors hover:bg-[#faf9f7]">
                                    <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-indigo-100 bg-indigo-50 text-xs font-bold text-indigo-700">{user.display_name.trim().slice(0, 2).toUpperCase() || 'U'}</div><div className="min-w-0"><div className="font-semibold text-slate-900">{user.display_name} {self && <span className="ml-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">You</span>}</div><div className="mt-0.5 break-all text-xs text-slate-500">{user.email}</div></div></div></td>
                                    <td className="px-5 py-4"><span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${user.role === 'admin' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{user.role === 'admin' ? 'Administrator' : 'Member'}</span></td>
                                    <td className="px-5 py-4"><span className={`inline-flex items-center gap-2 text-xs font-medium ${user.is_active ? 'text-emerald-700' : 'text-slate-500'}`}><span className={`h-2 w-2 rounded-full ${user.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />{user.is_active ? 'Active' : 'Inactive'}</span></td>
                                    <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500">{formatRelativeTime(user.created_at)}</td>
                                    <td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" disabled={self || busy !== null} onClick={() => setConfirm({ id: user.id, kind: 'role' })} className={secondary} title={self ? 'You cannot change your own role' : 'Change role'}>{user.role === 'admin' ? 'Make member' : 'Make admin'}</button><button type="button" disabled={self || busy !== null} onClick={() => setConfirm({ id: user.id, kind: 'active' })} className={`${secondary} ${user.is_active ? 'hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700' : 'hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'}`} title={self ? 'You cannot change your own access' : undefined}>{user.is_active ? 'Deactivate' : 'Reactivate'}</button></div></td>
                                </tr>
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            {
                target && confirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget && !operationLock.current) setConfirm(null) }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" className="w-full max-w-md rounded-2xl border border-[#e9e5df] bg-white p-6 shadow-2xl">
                        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50"><Shield className="h-5 w-5 text-amber-700" /></div>
                        <h2 id="confirm-title" className="text-lg font-semibold text-slate-900">Confirm account change</h2>
                        <p id="confirm-description" className="mt-2 text-sm leading-6 text-slate-600">{confirm.kind === 'role' ? `Change ${target.display_name}'s role to ${target.role === 'admin' ? 'Member' : 'Administrator'}? This changes their workspace permissions.` : `${target.is_active ? 'Deactivate' : 'Reactivate'} ${target.display_name}'s account? ${target.is_active ? 'They will lose access to the workspace.' : 'They will regain access based on their role.'}`}</p>
                        <div className="mt-6 flex justify-end gap-2"><button type="button" className={secondary} disabled={busy !== null} onClick={() => setConfirm(null)}>Cancel</button><button type="button" onClick={() => void applyChange()} disabled={busy !== null} className={primary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Confirm change</button></div>
                    </div>
                </div>
            }
        </main >
    )
}
