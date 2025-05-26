import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { optimizedThreadingService } from '@/lib/services/optimized-message-threading'
import { optimizedSlackSync } from '@/lib/services/optimized-slack-sync'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function POST() {
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

    console.log(`🚀 Starting optimized Slack sync for user: ${userId}`)

    // Run optimized sync with threading refresh
    const result = await optimizedThreadingService.syncAndRefreshThreads(userId)

    console.log(`✅ Optimized sync complete:`, {
      newMessages: result.syncResult.newMessages,
      success: result.syncResult.success,
      threadsRefreshed: result.threadsRefreshed,
      errors: result.syncResult.errors.length
    })

    return NextResponse.json({
      success: result.syncResult.success,
      newMessages: result.syncResult.newMessages,
      threadsRefreshed: result.threadsRefreshed,
      errors: result.syncResult.errors,
      skippedReason: result.syncResult.skippedReason
    })

  } catch (error) {
    console.error('❌ Error in optimized Slack sync:', error)
    return NextResponse.json(
      { error: 'Failed to sync messages' },
      { status: 500 }
    )
  }
}

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

    // Get sync statistics
    const slackStats = optimizedSlackSync.getSyncStats(userId)
    const threadStats = optimizedThreadingService.getCacheStats()

    return NextResponse.json({
      success: true,
      syncStats: slackStats,
      threadStats: threadStats[userId] || null,
      allThreadStats: threadStats
    })

  } catch (error) {
    console.error('❌ Error getting sync stats:', error)
    return NextResponse.json(
      { error: 'Failed to get stats' },
      { status: 500 }
    )
  }
} 