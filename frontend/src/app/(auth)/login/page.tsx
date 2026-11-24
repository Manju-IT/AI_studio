'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AudioLines } from 'lucide-react'
import { api, ApiError } from '@/lib/api'

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const redirect = searchParams.get('redirect') || '/'

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setSubmitting(true)
        setError(null)
        try {
            await api.auth.login(email, password)
            router.replace(redirect)
            router.refresh()
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message)
            } else {
                setError('Could not sign in. Please try again.')
            }
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center px-4">
            <form
                onSubmit={onSubmit}
                className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-bg-muted p-8"
            >
                <div className="flex items-center gap-2">
                    <AudioLines className="h-5 w-5 text-accent" />
                    <h1 className="text-base font-semibold">AI Voice Studio</h1>
                </div>
                <p className="text-sm text-fg-muted">Sign in with your company account.</p>

                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-fg-muted">Email</span>
                    <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                </label>

                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-fg-muted">Password</span>
                    <input
                        type="password"
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                </label>

                {error && (
                    <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                >
                    {submitting ? 'Signing in…' : 'Sign in'}
                </button>
            </form>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen" />}>
            <LoginForm />
        </Suspense>
    )
}