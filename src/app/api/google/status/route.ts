import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@/server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function GET() {
  try {
    // Get Google integration status for user
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    
    // Check Google connection status
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { 
        googleAccessToken: true,
        googleTokenExpiry: true,
        googleIntegrations: true
      }
    })

    const isConnected = !!user?.googleAccessToken
    
    // Check if token is expired
    const tokenExpiry = user?.googleTokenExpiry 
      ? new Date(user.googleTokenExpiry) 
      : null
    
    const isTokenValid = tokenExpiry ? tokenExpiry > new Date() : false
    
    const integrations = user?.googleIntegrations as { contacts?: boolean; gmail?: boolean; calendar?: boolean } | null
    
    const enabledServices = []
    if (integrations?.contacts) enabledServices.push('Contacts')
    if (integrations?.gmail) enabledServices.push('Gmail')
    if (integrations?.calendar) enabledServices.push('Calendar')
    
    // Get recent messages count (Gmail)
    const recentMessages = await prisma.message.findMany({
      where: {
        userId: decoded.userId,
        platform: 'email',
        timestamp: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      },
      select: { id: true }
    })

    // Get contacts count
    const contacts = await prisma.contact.findMany({
      where: { userId: decoded.userId },
      select: { id: true }
    })

    return NextResponse.json({
      isConnected: isConnected && isTokenValid,
      enabledServices,
      recentMessagesCount: recentMessages.length,
      contactsCount: contacts.length
    })

  } catch (error) {
    console.error('Google status error:', error)
    return NextResponse.json(
      { error: 'Failed to get Google status' },
      { status: 500 }
    )
  }
} 