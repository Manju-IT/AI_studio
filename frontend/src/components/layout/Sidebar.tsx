'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    AudioLines,
    BarChart3,
    Boxes,
    ChevronDown,
    FolderOpen,
    LayoutDashboard,
    ListChecks,
    LogOut,
    Menu,
    Mic,
    MicVocal,
    Scissors,
    Sparkles,
    UserRound,
    Users,
    Wand2,
    X,
    type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavItem = { href: string; label: string; icon: LucideIcon }
type SidebarProps = {
    userName?: string | null
    sessionLoading?: boolean
    onSignOut?: () => void
}

const primaryItems: NavItem[] = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/studio', label: 'Studio', icon: Sparkles },
    { href: '/voices', label: 'Voices', icon: Mic },
    { href: '/projects', label: 'Projects', icon: FolderOpen },
]

const menuGroups: { title: string; items: NavItem[] }[] = [
    {
        title: 'VOICE WORKSPACE',
        items: [
            { href: '/voice-cloning', label: 'Voice Cloning', icon: MicVocal },
            { href: '/voice-design', label: 'Voice Design', icon: Wand2 },
        ],
    },
    {
        title: 'TOOLS & MODELS',
        items: [
            { href: '/transcriptions', label: 'Speech to text', icon: Mic },
            { href: '/audio-tools', label: 'Audio Tools', icon: Scissors },
            { href: '/models', label: 'Models', icon: Boxes },
            { href: '/models/benchmarks', label: 'Benchmarks', icon: BarChart3 },
            { href: '/jobs', label: 'Generation history', icon: ListChecks },
            { href: '/queue', label: 'Job queue', icon: ListChecks },
            { href: '/audio-library', label: 'Audio library', icon: AudioLines },
        ],
    },
    {
        title: 'DEVELOPERS',
        items: [{ href: '/developer', label: 'API Keys', icon: ListChecks }],
    },
    {
        title: 'ADMINISTRATION',
        items: [{ href: '/admin/users', label: 'Users', icon: Users }, { href: '/admin/system', label: 'System Health', icon: BarChart3 }],
    },
]

function isActive(pathname: string, href: string) {
    if (href === '/') return pathname === '/'
    if (href === '/models') {
        return pathname === '/models' ||
            (pathname.startsWith('/models/') && !pathname.startsWith('/models/benchmarks'))
    }
    return pathname === href || pathname.startsWith(`${href}/`)
}

function Brand() {
    return (
        <Link href="/" aria-label="AI Voice Studio home" className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-accent">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent text-[#201a14]">
                <AudioLines size={21} strokeWidth={2.1} />
            </span>
            <span className="hidden min-w-0 leading-tight sm:block">
                <span className="block truncate text-[16px] font-semibold tracking-tight text-fg">AI Voice Studio</span>
                <span className="block text-[11px] text-fg-subtle">LOCAL WORKSPACE</span>
            </span>
        </Link>
    )
}

function NavigationLink({ item, pathname, onClick, mobile = false }: {
    item: NavItem
    pathname: string
    onClick?: () => void
    mobile?: boolean
}) {
    const Icon = item.icon
    const active = isActive(pathname, item.href)
    return (
        <Link
            href={item.href}
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'flex items-center gap-2.5 rounded-lg font-medium transition-colors',
                mobile ? 'min-h-12 px-3 text-[15px]' : 'h-10 px-3 text-[15px]',
                active ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:bg-bg-elevated/70 hover:text-fg'
            )}
        >
            <Icon size={mobile ? 20 : 18} className={active ? 'text-accent' : ''} />
            {item.label}
        </Link>
    )
}

export function Sidebar({ userName, sessionLoading = false, onSignOut }: SidebarProps) {
    const pathname = usePathname()
    const [toolsOpen, setToolsOpen] = useState(false)
    const [accountOpen, setAccountOpen] = useState(false)
    const [mobileOpen, setMobileOpen] = useState(false)
    const toolsRef = useRef<HTMLDivElement>(null)
    const accountRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setToolsOpen(false)
        setAccountOpen(false)
        setMobileOpen(false)
    }, [pathname])

    useEffect(() => {
        if (!toolsOpen && !accountOpen) return
        function onPointerDown(event: PointerEvent) {
            const target = event.target as Node
            if (toolsOpen && !toolsRef.current?.contains(target)) setToolsOpen(false)
            if (accountOpen && !accountRef.current?.contains(target)) setAccountOpen(false)
        }
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setToolsOpen(false)
                setAccountOpen(false)
            }
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [toolsOpen, accountOpen])

    useEffect(() => {
        if (!mobileOpen) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') setMobileOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.body.style.overflow = previousOverflow
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [mobileOpen])

    const toolsActive = menuGroups.some(group => group.items.some(item => isActive(pathname, item.href)))
    const displayName = sessionLoading ? 'Loading session...' : userName || 'Workspace account'

    return (
        <>
            <header className="fixed inset-x-0 top-0 z-40 w-full px-3 pt-3 sm:px-5 sm:pt-4">
                <div className="mx-auto flex h-[72px] w-full max-w-none items-center justify-between gap-2 rounded-[15px] border border-border bg-bg-muted/95 px-3 shadow-[0_10px_28px_rgba(45,35,20,0.10)] backdrop-blur-xl sm:px-4">
                    <Brand />

                    <nav aria-label="Primary navigation" className="hidden items-center gap-1 xl:flex">
                        {primaryItems.map(item => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
                    </nav>

                    <div className="ml-auto hidden items-center gap-2 xl:flex">
                        <span className="mx-1 h-6 w-px bg-border" />
                        <div ref={toolsRef} className="relative">
                            <button
                                type="button"
                                aria-haspopup="menu"
                                aria-expanded={toolsOpen}
                                aria-controls="studio-tools-menu"
                                onClick={() => { setToolsOpen(value => !value); setAccountOpen(false) }}
                                className={cn('inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[15px] font-medium', toolsOpen || toolsActive ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:bg-bg-elevated hover:text-fg')}
                            >
                                <Boxes size={18} /> Tools <ChevronDown size={16} className={cn('transition-transform', toolsOpen && 'rotate-180')} />
                            </button>
                            {toolsOpen && (
                                <div id="studio-tools-menu" role="menu" className="absolute right-0 top-[calc(100%+12px)] z-50 max-h-[calc(100vh-110px)] w-[300px] overflow-y-auto rounded-xl border border-border bg-bg-muted p-2 shadow-[0_18px_48px_rgba(45,35,20,0.18)]">
                                    {menuGroups.map((group, index) => (
                                        <div key={group.title} className={cn('py-2', index > 0 && 'border-t border-border')}>
                                            <p className="px-3 pb-2 pt-1 text-[11px] font-semibold tracking-wider text-fg-subtle">{group.title}</p>
                                            {group.items.map(item => (
                                                <div role="none" key={item.href}>
                                                    <NavigationLink item={item} pathname={pathname} onClick={() => setToolsOpen(false)} mobile />
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div title="Local CPU inference mode" className="flex h-10 items-center gap-2 rounded-lg border border-border px-3">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            <span className="text-[13px] font-medium text-fg-muted">Local CPU</span>
                        </div>
                    </div>

                    <div ref={accountRef} className="relative ml-2 hidden shrink-0 xl:block">
                        <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={accountOpen}
                            aria-controls="studio-account-menu"
                            onClick={() => { setAccountOpen(value => !value); setToolsOpen(false) }}
                            className={cn('flex h-10 max-w-[210px] items-center gap-2 rounded-lg border border-border px-3 text-[14px] text-fg-muted hover:bg-bg-elevated hover:text-fg', accountOpen && 'bg-bg-elevated')}
                        >
                            <UserRound size={18} className="shrink-0 text-accent" />
                            <span className="truncate">{displayName}</span>
                            <ChevronDown size={13} className="shrink-0" />
                        </button>
                        {accountOpen && (
                            <div id="studio-account-menu" role="menu" className="absolute right-0 top-[calc(100%+12px)] z-50 w-[240px] rounded-xl border border-border bg-bg-muted p-2 shadow-[0_18px_48px_rgba(45,35,20,0.18)]">
                                <div className="border-b border-border px-3 py-2">
                                    <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Signed in as</p>
                                    <p className="mt-1 break-words text-sm font-semibold text-fg">{displayName}</p>
                                </div>
                                <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onSignOut?.() }} disabled={!onSignOut} className="mt-1 flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-50">
                                    <LogOut size={16} /> Sign out
                                </button>
                            </div>
                        )}
                    </div>

                    <button type="button" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="studio-mobile-navigation" onClick={() => setMobileOpen(true)} className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-fg xl:hidden">
                        <Menu size={19} />
                    </button>
                </div>
            </header>

            {mobileOpen && (
                <div id="studio-mobile-navigation" className="fixed inset-0 z-50 xl:hidden">
                    <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/40" />
                    <aside role="dialog" aria-modal="true" aria-label="Mobile navigation" className="absolute inset-y-0 right-0 flex w-[330px] max-w-[90vw] flex-col border-l border-border bg-bg-muted shadow-2xl">
                        <div className="flex h-[72px] items-center justify-between border-b border-border px-5">
                            <Brand />
                            <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-fg-muted hover:bg-bg-elevated hover:text-fg"><X size={19} /></button>
                        </div>
                        <nav aria-label="Mobile primary navigation" className="min-h-0 flex-1 overflow-y-auto p-4">
                            <p className="px-3 pb-3 text-[10px] font-semibold tracking-widest text-fg-subtle">WORKSPACE</p>
                            {primaryItems.map(item => <NavigationLink key={item.href} item={item} pathname={pathname} mobile onClick={() => setMobileOpen(false)} />)}
                            {menuGroups.map(group => (
                                <div key={group.title} className="mt-6">
                                    <p className="px-3 pb-3 text-[10px] font-semibold tracking-widest text-fg-subtle">{group.title}</p>
                                    {group.items.map(item => <NavigationLink key={item.href} item={item} pathname={pathname} mobile onClick={() => setMobileOpen(false)} />)}
                                </div>
                            ))}
                        </nav>
                        <div className="space-y-3 border-t border-border p-5">
                            <div className="flex items-center gap-2 text-xs text-fg-muted"><span className="h-2 w-2 rounded-full bg-success" /> Local CPU mode</div>
                            <div className="flex items-center gap-2 text-xs text-fg-muted"><UserRound size={16} className="text-accent" /><span className="min-w-0 truncate">{displayName}</span></div>
                            <button type="button" disabled={!onSignOut} onClick={() => { setMobileOpen(false); onSignOut?.() }} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated text-sm font-medium text-fg hover:border-border-strong disabled:opacity-50"><LogOut size={16} /> Sign out</button>
                        </div>
                    </aside>
                </div>
            )}
        </>
    )
}
