
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
    title: {
        default: 'AI Voice Studio',
        template: '%s | AI Voice Studio',
    },
    description:
        'A local AI voice workspace for speech generation, voice cloning, and multi-model inference.',
    applicationName: 'AI Voice Studio',
}


export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: '#141516',
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en" className="dark">
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    )
}
