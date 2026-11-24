'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { api, ApiError } from '@/lib/api'
import { logout } from '@/lib/auth'
import type { UserPublic } from '@/types/api'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const [user, setUser] = useState<UserPublic | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false

        api.auth.me()
            .then((currentUser) => {
                if (!cancelled) setUser(currentUser)
            })
            .catch((error: unknown) => {
                if (cancelled) return
                if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
                    router.replace('/login')
                } else {
                    console.error('Unable to load workspace session:', error)
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => { cancelled = true }
    }, [router])

    return (
        <div className="min-h-screen min-w-0 bg-bg text-fg">
            <Sidebar
                userName={user?.display_name ?? null}
                sessionLoading={loading}
                onSignOut={logout}
            />
            <main className="mx-auto min-w-0 w-full max-w-[1500px] px-4 pb-10 pt-[104px] sm:px-6 sm:pt-[112px] lg:px-8">
                {children}
            </main>
        </div>
    )
}
