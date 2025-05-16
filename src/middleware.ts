import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import * as jose from 'jose' // Install: npm install jose

// Using jose instead of jsonwebtoken for Edge compatibility
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key'
)

// Define protected routes
const protectedRoutes = [
  '/dashboard',
  '/profile',
  '/contacts',
  '/messages'
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Only check protected routes
  if (!protectedRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }
  
  // Get session cookie (log for debugging)
  const sessionCookie = request.cookies.get('session')?.value
  console.log('Middleware checking session cookie:', sessionCookie ? 'Found' : 'Not found')
  
  if (!sessionCookie) {
    // Redirect to login if no session
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  try {
    // Verify the token using jose
    await jose.jwtVerify(sessionCookie, JWT_SECRET)
    console.log('Middleware: Valid session token')
    return NextResponse.next()
  } catch (error) {
    // Invalid or expired token
    console.error('Middleware: Invalid session token', error)
    const response = NextResponse.redirect(new URL('/login', request.url))
    
    // Clear invalid cookie
    response.cookies.delete('session')
    
    return response
  }
}

export const config = {
  matcher: [
    // Protect these routes
    '/dashboard/:path*',
    '/profile/:path*',
    '/contacts/:path*',
    '/messages/:path*',
    // Skip static files
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
} 