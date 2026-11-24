'use client'

export function TextEditor({
    value,
    onChange,
    disabled,
    maxLength = 50000,
}: {
    value: string
    onChange: (value: string) => void
    disabled?: boolean
    maxLength?: number
}) {
    const words = value.trim() ? value.trim().split(/\s+/).length : 0

    return (
        <div className="flex flex-col gap-2">
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                maxLength={maxLength}
                placeholder="Enter the text you want to convert to speech…"
                className="min-h-[240px] w-full resize-y rounded-lg border border-border bg-bg p-4 text-sm leading-relaxed outline-none focus:border-accent disabled:opacity-60"
            />
            <div className="flex items-center justify-between text-xs text-fg-subtle">
                <span>{words} words</span>
                <span>
                    {value.length.toLocaleString()} / {maxLength.toLocaleString()} characters
                </span>
            </div>
        </div>
    )
}