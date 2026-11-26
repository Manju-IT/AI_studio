import type {
    AudioAssetOut,
    GenerationJobOut,
    GenerationSubmitRequest,
    LoginResponse,
    ModelInstallationOut,
    SystemStatusResponse,
    UserPublic,
    VoiceOut,
    VoiceSampleOut,
    ProjectOut,
    BenchmarkOut,
    BenchmarkSummary,

} from '@/types/api'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
    readonly code: string
    readonly status: number
    readonly details: Record<string, unknown>

    constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
        super(message)
        this.name = 'ApiError'
        this.code = code
        this.status = status
        this.details = details
    }
}

interface ErrorBody {
    error?: { code?: string; message?: string; details?: Record<string, unknown> }
    detail?: unknown
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json')
    }
    const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        credentials: 'include',
    })

    if (response.status === 204) {
        return undefined as T
    }

    const contentType = response.headers.get('content-type') ?? ''
    let parsed: unknown = null
    if (contentType.includes('application/json')) {
        try {
            parsed = await response.json()
        } catch {
            parsed = null
        }
    }

    if (!response.ok) {
        const body = (parsed as ErrorBody | null) ?? null
        if (body?.error) {
            throw new ApiError(
                body.error.code ?? 'HTTP_ERROR',
                body.error.message ?? `Request failed with status ${response.status}`,
                response.status,
                body.error.details ?? {},
            )
        }
        const detail = body?.detail
        const message =
            typeof detail === 'string'
                ? detail
                : Array.isArray(detail) && detail.length > 0
                    ? String((detail[0] as { msg?: string }).msg ?? 'Validation error')
                    : `Request failed with status ${response.status}`
        throw new ApiError('HTTP_ERROR', message, response.status)
    }

    return parsed as T
}

export const api = {
    auth: {
        login: (email: string, password: string) =>
            request<LoginResponse>('/api/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password }),
            }),
        logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }),
        me: () => request<UserPublic>('/api/v1/auth/me'),
        listUsers: () => request<UserPublic[]>('/api/v1/auth/users'),
        createUser: (payload: {
            email: string
            display_name: string
            password: string
            role: 'admin' | 'member'
        }) =>
            request<UserPublic>('/api/v1/auth/users', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
        updateUser: (
            userId: string,
            payload: { display_name?: string; role?: 'admin' | 'member'; is_active?: boolean },
        ) =>
            request<UserPublic>(`/api/v1/auth/users/${userId}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            }),
        deactivateUser: (userId: string) =>
            request<void>(`/api/v1/auth/users/${userId}`, { method: 'DELETE' }),
    },
    models: {
        list: () => request<ModelInstallationOut[]>('/api/v1/models'),
        validate: (manifestId: string) =>
            request<{ manifest_id: string; valid: boolean; errors: string[] }>(
                `/api/v1/models/${encodeURIComponent(manifestId)}/validate`,
                { method: 'POST' },
            ),
        load: (manifestId: string) =>
            request<{ manifest_id: string; state: string }>(
                `/api/v1/models/${encodeURIComponent(manifestId)}/load`,
                { method: 'POST' },
            ),
        unload: (manifestId: string) =>
            request<{ manifest_id: string; state: string }>(
                `/api/v1/models/${encodeURIComponent(manifestId)}/unload`,
                { method: 'POST' },
            ),
        benchmarks: (manifestId: string) =>
            request<BenchmarkOut[]>(`/api/v1/models/${encodeURIComponent(manifestId)}/benchmarks`),
        benchmarkSummary: () => request<BenchmarkSummary[]>('/api/v1/models/benchmarks/summary'),
        runBenchmark: (payload: {
            manifest_id: string
            samples?: string[]
            include_cold_start?: boolean
        }) =>
            request<BenchmarkOut[]>('/api/v1/models/benchmark', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
    },
    audio: {
        process: (payload: {audio_asset_id: string; operation: string; value: number}) => request<AudioAssetOut>('/api/v1/audio/process', {method: 'POST', body: JSON.stringify(payload)}),
        list: (limit = 50, projectId?: string, offset = 0) => {
            const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
            if (projectId) params.set('project_id', projectId)
            return request<AudioAssetOut[]>(`/api/v1/audio?${params.toString()}`)
        },
        get: (assetId: string) => request<AudioAssetOut>(`/api/v1/audio/${assetId}`),
        trim: (payload: {
            audio_asset_id: string
            start_seconds: number
            end_seconds: number
            title?: string
        }) =>
            request<AudioAssetOut>('/api/v1/audio/trim', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
        merge: (payload: {
            audio_asset_ids: string[]
            pause_ms?: number
            title?: string
        }) =>
            request<AudioAssetOut>('/api/v1/audio/merge', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
        export: (payload: { audio_asset_id: string; format: 'wav' | 'mp3' }) =>
            request<AudioAssetOut>('/api/v1/audio/export', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
    },
    projects: {
        importDubbing: (transcription_id: string, name: string, language: string) => request<ProjectOut>(`/api/v1/projects/dubbing/import`, {method: "POST", body: JSON.stringify({transcription_id,name,language})}),
        script: (id: string) => request<import('@/types/project-editor').Script>(`/api/v1/projects/${id}/script`),
        saveScript: (id: string, payload: import('@/types/project-editor').Script) => request<import('@/types/project-editor').Script>(`/api/v1/projects/${id}/script`, {method:'PUT', body:JSON.stringify(payload)}),
        generateBatch: (id: string, revision: number, retryOnly = false) => request<import('@/types/project-editor').Script>(`/api/v1/projects/${id}/script/batch?revision=${revision}&retry_only=${retryOnly}`, {method:'POST'}),
        generateSegment: (id: string, segment: string, revision: number) => request<import('@/types/project-editor').Script>(`/api/v1/projects/${id}/script/${segment}/generate?revision=${revision}`, {method:'POST'}),
        exportScript: (id: string, revision: number, aligned = false) => request<AudioAssetOut>(`/api/v1/projects/${id}/script/export?revision=${revision}&aligned=${aligned}`, {method:'POST'}),
        list: () => request<ProjectOut[]>('/api/v1/projects'),
        get: (projectId: string) => request<ProjectOut>(`/api/v1/projects/${projectId}`),
        create: (payload: { name: string; description?: string }) =>
            request<ProjectOut>('/api/v1/projects', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
        update: (projectId: string, payload: { name?: string; description?: string; is_archived?: boolean }) =>
            request<ProjectOut>(`/api/v1/projects/${projectId}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            }),
        delete: (projectId: string) =>
            request<void>(`/api/v1/projects/${projectId}`, { method: 'DELETE' }),
        createFolder: (projectId: string, payload: { name: string; parent_id?: string | null }) =>
            request<ProjectOut>(`/api/v1/projects/${projectId}/folders`, {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
    },

    voices: {
        extractionStatus: (id: string) => request<{status: string; error: string | null}>(`/api/v1/voices/${id}/extract`),
        extract: (id: string) => request<{status: string; error: string | null}>(`/api/v1/voices/${id}/extract`, { method: "POST" }),
        list: (language?: string) => {
            const qs = language ? `?language=${encodeURIComponent(language)}` : ''
            return request<VoiceOut[]>(`/api/v1/voices${qs}`)
        },
        favorite: (voiceId: string, isFavorite: boolean) =>
            request<VoiceOut>(`/api/v1/voices/${voiceId}/favorite`, {
                method: 'POST',
                body: JSON.stringify({ is_favorite: isFavorite }),
            }),
        delete: (voiceId: string) =>
            request<void>(`/api/v1/voices/${voiceId}`, { method: 'DELETE' }),
        clone: (payload: {
            name: string
            language: string
            speaker_name: string
            consent_statement: string
            reference_text: string
            model_installation_id?: string | null
        }) =>
            request<VoiceOut>('/api/v1/voices/clone', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
        design: (payload: {
            name: string
            language: string
            description: string
            preview_text: string
        }) =>
            request<VoiceOut>('/api/v1/voices/design', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
        uploadReference: async (voiceId: string, file: File): Promise<VoiceSampleOut> => {
            const form = new FormData()
            form.append('file', file)
            const response = await fetch(
                `${API_BASE}/api/v1/voices/${voiceId}/reference`,
                { method: 'POST', body: form, credentials: 'include' },
            )
            if (!response.ok) {
                let message = `Upload failed (${response.status})`
                try {
                    const body = (await response.json()) as { error?: { message?: string } }
                    message = body.error?.message ?? message
                } catch {
                    /* ignore */
                }
                throw new ApiError('UPLOAD_FAILED', message, response.status)
            }
            return (await response.json()) as VoiceSampleOut
        },
    },
    generations: {
        submit: (payload: GenerationSubmitRequest) =>
            request<GenerationJobOut>('/api/v1/generations', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
        list: (limit = 50, offset = 0) =>
            request<GenerationJobOut[]>(`/api/v1/generations?limit=${limit}&offset=${offset}`),
        get: (jobId: string) => request<GenerationJobOut>(`/api/v1/generations/${jobId}`),
        cancel: (jobId: string) =>
            request<GenerationJobOut>(`/api/v1/generations/${jobId}/cancel`, { method: 'POST' }),
    },
    jobs: {
        get: (jobId: string) => request<GenerationJobOut>(`/api/v1/jobs/${jobId}`),
    },
    system: {
        status: () => request<SystemStatusResponse>('/api/v1/system/status'),
    },
    /** Downloads an audio file as a Blob URL. Caller is responsible for URL.revokeObjectURL. */
    async fetchAudioBlobUrl(assetId: string): Promise<string> {
        const response = await fetch(`${API_BASE}/api/v1/audio/${assetId}/download`, {
            credentials: 'include',
        })
        if (!response.ok) {
            throw new ApiError('AUDIO_FETCH_FAILED', `Could not load audio (${response.status}).`, response.status)
        }
        const blob = await response.blob()
        return URL.createObjectURL(blob)
    },
}

export const API_BASE_URL = API_BASE