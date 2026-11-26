export interface Segment {
    id: string
    speaker?: string
    text: string
    model_installation_id: string | null
    voice_id: string | null
    language: string
    pause_ms: number
    source_text?: string | null
    source_start?: number | null
    source_end?: number | null
    job_id: string | null
}
export interface Script { revision: number; segments: Segment[] }
