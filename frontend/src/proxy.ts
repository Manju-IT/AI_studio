import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const COOKIE_NAME = 'voice_studio_session'

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl
    const hasSession = Boolean(request.cookies.get(COOKIE_NAME)?.value)

    const isPublic = pathname === '/login'

    if (isPublic) {
        if (hasSession) {
            return NextResponse.redirect(new URL('/', request.url))
        }
        return NextResponse.next()
    }

    if (!hasSession) {
        const login = new URL('/login', request.url)
        login.searchParams.set('redirect', pathname + (request.nextUrl.search || ''))
        return NextResponse.redirect(login)
    }

    return NextResponse.next()
}

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}