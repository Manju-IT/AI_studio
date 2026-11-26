export interface UserPublic {
    id: string
    email: string
    display_name: string
    role: 'admin' | 'member' | string
    is_active: boolean
    last_login_at: string | null
    created_at: string
}

export interface LoginResponse {
    user: UserPublic
}

export interface ModelDefinitionOut {
    id: string
    slug: string
    display_name: string
    architecture: string
    model_type: string
    parameters_billions: number
    license: string
    source_repository: string
    languages: string[]
    capabilities: Record<string, unknown>
}

export interface GenerationParameter {
    key: string; label: string; default: number | null; minimum: number; maximum: number; step: number; integer: boolean
}
export interface ModelInstallationOut {
    generation_contract?: { available: boolean; parameters: GenerationParameter[] }
    id: string
    definition_id: string
    manifest_id: string
    runtime: string
    quantization: string | null
    device: string
    model_path: string
    memory_estimate_mb: number | null
    installation_state: string
    loading_state: string
    last_error: string | null
    last_loaded_at: string | null
    is_active_model: boolean
    definition: ModelDefinitionOut
}

export interface VoiceSampleOut {
    id: string
    original_filename: string
    duration_seconds: number
    sample_rate: number
    format: string
    file_size_bytes: number
    is_reference: boolean
}

export interface VoiceOut {
    synthesis_ready?: boolean
    model_installation_id?: string | null
    id: string
    name: string
    language: string
    source: string
    description: string | null
    is_favorite: boolean
    is_active: boolean
    design_prompt: string | null
    created_at: string
    samples: VoiceSampleOut[]
}

export interface AudioAssetOut {
    id: string
    original_filename: string
    mime_type: string
    format: string
    duration_seconds: number
    sample_rate: number
    channels: number
    file_size_bytes: number
    checksum_sha256: string
    title: string | null
    project_id: string | null
    generation_job_id: string | null
    created_at: string
}

export type JobStatus =
    | 'queued'
    | 'loading_model'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'

export interface GenerationChunkOut {
    id: string
    index: number
    text: string
    status: string
    duration_seconds: number | null
    error_message: string | null
    attempts: number
}

export interface GenerationJobOut {
    id: string
    model_installation_id: string | null
    voice_id: string | null
    project_id: string | null
    status: JobStatus
    text: string
    language: string
    settings: Record<string, unknown>
    is_long_form: boolean
    progress_current: number
    progress_total: number
    error_code: string | null
    error_message: string | null
    started_at: string | null
    finished_at: string | null
    cancellation_requested: boolean
    duration_seconds: number | null
    audio_asset_id: string | null
    created_at: string
    audio_asset: AudioAssetOut | null
    chunks: GenerationChunkOut[]
}

export interface GenerationSubmitRequest {
    model_installation_id: string
    voice_id?: string | null
    project_id?: string | null
    text: string
    language: string
    settings?: Record<string, unknown>
    long_form?: boolean
    idempotency_key?: string | null
}

export interface JobProgressEvent {
    id: string
    status: JobStatus
    progress_current: number
    progress_total: number
    error_message: string | null
}

export interface ResourceSnapshot {
    cpu_percent: number
    ram_total_mb: number
    ram_used_mb: number
    ram_available_mb: number
    disk_total_mb: number
    disk_free_mb: number
}

export interface WorkerStatus {
    alive: boolean
    pid: number | null
    loaded_model: string | null
    last_heartbeat_seconds: number | null
}

export interface SystemStatusResponse {
    resources: ResourceSnapshot
    worker: WorkerStatus
    active_model_manifest_id: string | null
}

export interface ProjectFolderOut {
    id: string
    name: string
    parent_id: string | null
}

export interface ProjectOut {
    id: string
    name: string
    description: string | null
    is_archived: boolean
    created_at: string
    folders: ProjectFolderOut[]
}

export interface BenchmarkOut {
    id: string
    installation_id: string
    manifest_id: string
    display_name: string
    sample_name: string
    text_length_chars: number
    generation_time_seconds: number
    audio_duration_seconds: number
    real_time_factor: number
    time_to_first_audio_seconds: number | null
    peak_ram_mb: number | null
    cpu_percent: number | null
    sample_rate: number | null
    output_size_bytes: number | null
    cold_start: boolean
    success: boolean
    error_message: string | null
    created_at: string
}

export interface BenchmarkSummary {
    manifest_id: string
    display_name: string
    runs: number
    best_rtf: number | null
    worst_rtf: number | null
    peak_ram_mb: number | null
    last_run_at: string | null
}