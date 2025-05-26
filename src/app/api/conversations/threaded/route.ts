import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { optimizedThreadingService } from '@/lib/services/optimized-message-threading'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function GET() {
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

    console.log(`🧵 Fetching optimized threaded conversations for user: ${userId}`)

    // Get threaded conversations using optimized service
    const threads = await optimizedThreadingService.getThreadedConversationsForUser(userId)

    console.log(`✅ Found ${threads.length} conversation threads`)

    return NextResponse.json({
      success: true,
      threads,
      count: threads.length,
      cached: threads.length > 0 // Simple indicator if results were likely cached
    })

  } catch (error) {
    console.error('❌ Error fetching threaded conversations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch conversations' },
      { status: 500 }
    )
  }
} 