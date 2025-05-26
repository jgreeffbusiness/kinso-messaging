import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@/server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify session token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    const userId = decoded.userId

    const { messageIds, markAsRead } = await request.json()

    if (!Array.isArray(messageIds)) {
      return NextResponse.json({ error: 'messageIds must be an array' }, { status: 400 })
    }

    // Update read status for messages
    await prisma.message.updateMany({
      where: {
        id: { in: messageIds },
        userId // Ensure user owns these messages
      },
      data: {
        readAt: markAsRead ? new Date() : null
      }
    })

    return NextResponse.json({ 
      success: true, 
      message: `${messageIds.length} messages marked as ${markAsRead ? 'read' : 'unread'}` 
    })

  } catch (error) {
    console.error('Mark messages read error:', error)
    return NextResponse.json(
      { error: 'Failed to update message read status' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Verify user is authenticated
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify session token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    const userId = decoded.userId

    const { action } = await request.json()

    if (action === 'mark_all_read') {
      // Mark all unread messages as read
      const result = await prisma.message.updateMany({
        where: {
          userId,
          readAt: null
        },
        data: {
          readAt: new Date()
        }
      })

      return NextResponse.json({ 
        success: true, 
        message: `${result.count} messages marked as read` 
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  } catch (error) {
    console.error('Bulk mark read error:', error)
    return NextResponse.json(
      { error: 'Failed to mark all messages as read' },
      { status: 500 }
    )
  }
} 