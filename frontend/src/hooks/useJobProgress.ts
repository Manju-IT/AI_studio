'use client'

import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL, api } from '@/lib/api'
import type { JobProgressEvent } from '@/types/api'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export function useJobProgress(jobId: string | null) {
    const [progress, setProgress] = useState<JobProgressEvent | null>(null)
    const [error, setError] = useState<string | null>(null)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        if (!jobId) {
            // setProgress(null)
            // setError(null)
            return
        }

        let cancelled = false
        let es: EventSource | null = null

        const stopPolling = () => {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
        }

        const startPolling = () => {
            if (pollRef.current || cancelled) return
            pollRef.current = setInterval(async () => {
                try {
                    const job = await api.jobs.get(jobId)
                    if (cancelled) return
                    setError(null)
                    setProgress({
                        id: job.id,
                        status: job.status,
                        progress_current: job.progress_current,
                        progress_total: job.progress_total,
                        error_message: job.error_message,
                    })
                    if (TERMINAL.has(job.status)) stopPolling()
                } catch (err) {
                    if (!cancelled) setError(err instanceof Error ? err.message : String(err))
                }
            }, 1500)
        }

        try {
            es = new EventSource(`${API_BASE_URL}/api/v1/jobs/${jobId}/events`, {
                withCredentials: true,
            })
            es.addEventListener('progress', (event) => {
                try {
                    const data = JSON.parse((event as MessageEvent).data) as JobProgressEvent
                    if (cancelled || data.id !== jobId) return
                    setError(null)
                    setProgress(data)
                    if (TERMINAL.has(data.status)) {
                        es?.close()
                        stopPolling()
                    }
                } catch {
                    /* ignore malformed event */
                }
            })
            es.onerror = () => {
                es?.close()
                startPolling()
            }
        } catch {
            startPolling()
        }

        return () => {
            cancelled = true
            es?.close()
            stopPolling()
        }
    }, [jobId])

    return { progress, error }
}