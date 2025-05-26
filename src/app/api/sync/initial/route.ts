import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { unifiedMessageSyncService } from '@/lib/services/unified-message-sync-service'
import { syncStateManager } from '@/lib/services/sync-state-manager'
import { prisma } from '@/server/db'

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

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        slackIntegrations: true,
        googleAccessToken: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if initial sync is already complete
    const isInitialSyncComplete = await syncStateManager.isInitialSyncComplete(userId)
    
    if (isInitialSyncComplete) {
      console.log(`⏭️ Initial sync already complete for ${user.email}`)
      return NextResponse.json({
        success: true,
        alreadyComplete: true,
        message: 'Initial sync already completed',
        note: 'Use webhooks for real-time updates or auto-sync for incremental updates'
      })
    }

    console.log(`🚀 Manual initial sync triggered for ${user.email}`)

    // Set sync in progress for connected platforms
    if (user.slackIntegrations) {
      await syncStateManager.setSyncInProgress(userId, 'slack', true)
    }
    if (user.googleAccessToken) {
      await syncStateManager.setSyncInProgress(userId, 'gmail', true)
    }

    try {
      // Run full initial sync
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

      const totalNewMessages = result.platforms.reduce((sum, platform) => sum + platform.newMessages, 0)

      console.log(`✅ Manual initial sync completed for ${user.email} in ${duration}ms: ${totalNewMessages} messages`)

      return NextResponse.json({
        success: result.errors.length === 0,
        duration,
        platforms: result.platforms,
        totalContactsProcessed: result.totalContactsProcessed,
        totalMessagesProcessed: result.totalMessagesProcessed,
        totalNewMessages,
        crossPlatformMatches: result.crossPlatformMatches,
        errors: result.errors,
        message: 'Initial sync completed successfully',
        note: 'Future updates will use webhooks for real-time sync'
      })

    } catch (error) {
      // Reset sync in progress status on error
      if (user.slackIntegrations) {
        await syncStateManager.setSyncInProgress(userId, 'slack', false)
      }
      if (user.googleAccessToken) {
        await syncStateManager.setSyncInProgress(userId, 'gmail', false)
      }
      throw error
    }

  } catch (error) {
    console.error('❌ Manual initial sync error:', error)
    return NextResponse.json(
      { error: 'Initial sync failed' },
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

    // Get sync status
    const isInitialSyncComplete = await syncStateManager.isInitialSyncComplete(userId)
    const syncStates = await syncStateManager.getSyncStates(userId)

    return NextResponse.json({
      initialSyncComplete: isInitialSyncComplete,
      syncStates: {
        slack: syncStates.slack ? {
          initialSyncComplete: syncStates.slack.initialSyncComplete,
          lastSyncTimestamp: syncStates.slack.lastSyncTimestamp,
          totalMessagesProcessed: syncStates.slack.totalMessagesProcessed,
          isCurrentlySyncing: syncStates.slack.isCurrentlySyncing
        } : null,
        gmail: syncStates.gmail ? {
          initialSyncComplete: syncStates.gmail.initialSyncComplete,
          lastSyncTimestamp: syncStates.gmail.lastSyncTimestamp,
          totalMessagesProcessed: syncStates.gmail.totalMessagesProcessed,
          isCurrentlySyncing: syncStates.gmail.isCurrentlySyncing
        } : null
      }
    })

  } catch (error) {
    console.error('❌ Error getting sync status:', error)
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    )
  }
} 