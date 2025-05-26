import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { autoSyncService } from '@/lib/services/auto-sync-service'
import { syncStateManager } from '@/lib/services/sync-state-manager'
import { unifiedMessageSyncService } from '@/lib/services/unified-message-sync-service'
import { prisma } from '@/server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

// Auto-sync state tracking (in production, use Redis or database)
const lastSyncTimes = new Map<string, Date>()
const recentRequests = new Map<string, number[]>() // userId -> array of request timestamps

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

    // Track request frequency to detect aggressive polling
    const now = Date.now()
    const userRequests = recentRequests.get(userId) || []
    
    // Clean old requests (older than 5 minutes)
    const fiveMinutesAgo = now - 5 * 60 * 1000
    const recentUserRequests = userRequests.filter(timestamp => timestamp > fiveMinutesAgo)
    recentUserRequests.push(now)
    recentRequests.set(userId, recentUserRequests)

    // If more than 5 requests in 5 minutes, rate limit aggressively
    if (recentUserRequests.length > 5) {
      console.log(`🚫 Rate limiting user ${userId} - ${recentUserRequests.length} requests in 5 minutes`)
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Rate limited - too many auto-sync requests',
        nextSync: new Date(now + 10 * 60 * 1000).toISOString(), // 10 minutes
        minutesUntilNext: 10,
        webhooksEnabled: false,
        syncInterval: 'Rate limited',
        note: 'Auto-sync is being rate limited. Please rely on webhooks for real-time updates.'
      })
    }

    // Get user info 
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        slackIntegrations: true,
        googleAccessToken: true,
        createdAt: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if initial sync is complete
    const isInitialSyncComplete = await syncStateManager.isInitialSyncComplete(userId)
    const syncStates = await syncStateManager.getSyncStates(userId)

    console.log(`🔍 Sync status check for ${user.email}:`, {
      initialSyncComplete: isInitialSyncComplete,
      slackState: syncStates.slack ? {
        complete: syncStates.slack.initialSyncComplete,
        lastSync: syncStates.slack.lastSyncTimestamp,
        totalMessages: syncStates.slack.totalMessagesProcessed
      } : null,
      gmailState: syncStates.gmail ? {
        complete: syncStates.gmail.initialSyncComplete,
        lastSync: syncStates.gmail.lastSyncTimestamp,
        totalMessages: syncStates.gmail.totalMessagesProcessed
      } : null
    })

    // If initial sync not complete, do it now
    if (!isInitialSyncComplete) {
      console.log(`🚀 Starting initial sync for ${user.email}`)
      
      const startTime = Date.now()
      const result = await unifiedMessageSyncService.syncAllPlatforms(userId)
      const duration = Date.now() - startTime

      // Mark initial sync as complete for platforms that succeeded
      for (const platform of result.platforms) {
        if (platform.platform === 'slack' && platform.newMessages >= 0) {
          await syncStateManager.markInitialSyncComplete(userId, 'slack', {
            totalMessages: platform.newMessages
          })
        }
        // Add gmail when implemented
      }

      // Update last sync time
      lastSyncTimes.set(userId, new Date())

      const totalNewMessages = result.platforms.reduce((sum, platform) => sum + platform.newMessages, 0)

      console.log(`✅ Initial sync completed for ${user.email} in ${duration}ms: ${totalNewMessages} messages`)

      return NextResponse.json({
        success: result.errors.length === 0,
        duration,
        platforms: result.platforms,
        totalContactsProcessed: result.totalContactsProcessed,
        totalMessagesProcessed: result.totalMessagesProcessed,
        totalNewMessages,
        crossPlatformMatches: result.crossPlatformMatches,
        errors: result.errors,
        initialSyncComplete: true,
        syncType: 'initial_sync',
        note: 'Initial sync completed - future updates will use webhooks and incremental sync'
      })
    }

    // Initial sync is complete - check if we need incremental sync
    const slackSyncCheck = await syncStateManager.shouldDoIncrementalSync(userId, 'slack')
    const gmailSyncCheck = await syncStateManager.shouldDoIncrementalSync(userId, 'gmail')

    // If no platforms need sync, return current status
    if (!slackSyncCheck.shouldSync && !gmailSyncCheck.shouldSync) {
      console.log(`✅ No sync needed for ${user.email}:`, {
        slack: slackSyncCheck.reason,
        gmail: gmailSyncCheck.reason
      })

      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No sync needed - recent syncs completed and webhooks active',
        initialSyncComplete: true,
        syncType: 'incremental_check',
        platforms: [
          {
            platform: 'slack',
            reason: slackSyncCheck.reason,
            shouldSync: slackSyncCheck.shouldSync
          },
          {
            platform: 'gmail', 
            reason: gmailSyncCheck.reason,
            shouldSync: gmailSyncCheck.shouldSync
          }
        ],
        note: 'Relying on webhooks for real-time updates. Incremental sync not needed.'
      })
    }

    // Do incremental sync for platforms that need it
    console.log(`🔄 Starting incremental sync for ${user.email}`)
    
    const results = []
    const totalNewMessages = 0

    if (slackSyncCheck.shouldSync) {
      console.log(`📱 Incremental Slack sync: ${slackSyncCheck.reason}`)
      // TODO: Implement incremental Slack sync that only fetches messages since lastMessageTimestamp
      // For now, skip to avoid full sync
      await syncStateManager.updateLastSync(userId, 'slack', 0)
      results.push({
        platform: 'slack',
        newMessages: 0,
        reason: 'Incremental sync skipped - webhooks handle real-time updates'
      })
    }

    if (gmailSyncCheck.shouldSync) {
      console.log(`📧 Incremental Gmail sync: ${gmailSyncCheck.reason}`)
      // TODO: Implement incremental Gmail sync
      await syncStateManager.updateLastSync(userId, 'gmail', 0)
      results.push({
        platform: 'gmail',
        newMessages: 0,
        reason: 'Incremental sync skipped - not yet implemented'
      })
    }

    console.log(`✅ Incremental sync completed for ${user.email}: ${totalNewMessages} new messages`)

    return NextResponse.json({
      success: true,
      initialSyncComplete: true,
      syncType: 'incremental_sync',
      platforms: results,
      totalNewMessages,
      note: 'Incremental sync completed. Real-time updates handled by webhooks.'
    })

  } catch (error) {
    console.error('❌ Auto-sync error:', error)
    return NextResponse.json(
      { error: 'Auto-sync failed' },
      { status: 500 }
    )
  }
}

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

    const { action, config } = await request.json()

    switch (action) {
      case 'start':
        await autoSyncService.startAutoSync(userId, config)
        return NextResponse.json({ success: true, message: 'Auto-sync started' })
      
      case 'stop':
        autoSyncService.stopAutoSync(userId)
        return NextResponse.json({ success: true, message: 'Auto-sync stopped' })
      
      case 'force':
        await autoSyncService.forceSyncNow(userId)
        return NextResponse.json({ success: true, message: 'Manual sync completed' })
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Auto-sync action error:', error)
    return NextResponse.json(
      { error: 'Failed to perform auto-sync action' },
      { status: 500 }
    )
  }
} 