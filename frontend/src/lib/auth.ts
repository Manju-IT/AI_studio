import { api } from '@/lib/api'
import type { UserPublic } from '@/types/api'

export async function logout(): Promise<void> {
    try {
        await api.auth.logout()
    } finally {
        if (typeof window !== 'undefined') {
            window.location.replace('/login')
        }
    }
}

export async function requireSession(): Promise<UserPublic | null> {
    try {
        return await api.auth.me()
    } catch {
        return null
    }
}