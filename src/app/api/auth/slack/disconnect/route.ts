import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@/server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function POST() {
  try {
    // Verify user is authenticated
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify session token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    
    // Clear Slack credentials from database
    await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        slackAccessToken: null,
        slackRefreshToken: null,
        slackTokenExpiry: null,
        slackTeamId: null,
        slackUserId: null,
        slackIntegrations: {}
      }
    })

    console.log(`Slack disconnected for user ${decoded.userId}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Slack disconnect error:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect Slack' },
      { status: 500 }
    )
  }
} 