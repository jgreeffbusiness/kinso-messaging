import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

interface IntegrationsBody {
  token: string
  refreshToken: string
  integrations: {
    contacts: boolean
    gmail: boolean
    calendar: boolean
  }
}

export async function POST(request: Request) {
  try {
    // Get session cookie - await cookies() first
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Verify session
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    
    // Get data from request
    const body = await request.json() as IntegrationsBody
    const { token, refreshToken, integrations } = body
console.log(body)
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }
    
    // Calculate token expiry (typically 1 hour for Google)
    const tokenExpiry = new Date(Date.now() + 3600 * 1000)
    
    // Store token and enabled integrations in database
    await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        googleAccessToken: token,
        googleRefreshToken: refreshToken,
        googleTokenExpiry: tokenExpiry,
        googleIntegrations: integrations
      }
    })
    
    // Return token expiry so frontend can track it
    return NextResponse.json({
      success: true,
      tokenExpiry: tokenExpiry.toISOString()
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      { error: 'Failed to save integrations' }, 
      { status: 500 }
    )
  }
} 