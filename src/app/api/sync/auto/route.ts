import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { autoSyncService } from '@/lib/services/auto-sync-service'

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

    console.log(`📊 Sync status requested for user ${userId}`)

    // Get comprehensive status (cached-first)
    const syncStatus = await autoSyncService.getSyncStatus(userId)
    
    // Return cached data immediately - no external API calls unless needed
    if (syncStatus.recommendedAction === 'use-cache') {
      console.log(`📚 Returning cached data: ${syncStatus.reason}`)
      
      return NextResponse.json({
        success: true,
        syncType: 'cached',
        currentlySyncing: syncStatus.currentlySyncing,
        lastSync: syncStatus.lastSync,
        webhooksEnabled: true,
        syncStrategy: 'cached-first + webhooks',
        reason: syncStatus.reason,
        cachedData: syncStatus.cachedData,
        platforms: syncStatus.cachedData.platforms.map(p => ({
          platform: p.platform,
          contactsProcessed: p.contactCount,
          messagesProcessed: p.messageCount,
          newMessages: 0, // New messages come via webhooks
          errors: []
        })),
        totalContactsProcessed: syncStatus.cachedData.totalContacts,
        totalMessagesProcessed: syncStatus.cachedData.totalMessages,
        totalNewMessages: 0,
        crossPlatformMatches: 0,
        errors: [],
        note: 'Using cached data - external sync not needed. Real-time updates via webhooks.'
      })
    }

    // Only hit external APIs if recommended (new user, stale data, etc.)
    console.log(`📡 External sync recommended: ${syncStatus.reason}`)
    
    const syncResult = await autoSyncService.performInitialSync(userId)
    
    if (syncResult) {
      console.log(`✅ External sync completed for user ${userId}`)
      
      return NextResponse.json({
        success: true,
        syncType: 'external_sync',
        platforms: syncResult.platforms,
        totalContactsProcessed: syncResult.totalContactsProcessed,
        totalMessagesProcessed: syncResult.totalMessagesProcessed,
        totalNewMessages: syncResult.platforms.reduce((sum, p) => sum + p.newMessages, 0),
        crossPlatformMatches: syncResult.crossPlatformMatches,
        errors: syncResult.errors,
        currentlySyncing: false,
        lastSync: new Date(),
        webhooksEnabled: true,
        syncStrategy: 'cached-first + webhooks',
        reason: syncStatus.reason,
        note: 'External sync completed - future updates via webhooks'
      })
    } else {
      // Sync was recommended but blocked (e.g., already syncing)
      const updatedStatus = await autoSyncService.getSyncStatus(userId)
      
      return NextResponse.json({
        success: true,
        syncType: 'blocked',
        currentlySyncing: updatedStatus.currentlySyncing,
        lastSync: updatedStatus.lastSync,
        webhooksEnabled: true,
        syncStrategy: 'cached-first + webhooks',
        reason: 'Sync blocked - may be in progress or rate limited',
        cachedData: updatedStatus.cachedData,
        note: 'Using cached data - sync was blocked'
      })
    }

  } catch (error) {
    console.error('❌ Sync error:', error)
    return NextResponse.json(
      { error: 'Failed to get sync status' },
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

    const { action } = await request.json()

    switch (action) {
      case 'force':
        console.log(`🔄 Manual sync requested for user ${userId}`)
        const result = await autoSyncService.forceSyncNow(userId)
        
        if (result) {
          return NextResponse.json({ 
            success: true, 
            message: 'Manual sync completed',
            syncType: 'manual_sync',
            totalMessages: result.totalMessagesProcessed,
            newMessages: result.platforms.reduce((sum, p) => sum + p.newMessages, 0),
            platforms: result.platforms
          })
        } else {
          return NextResponse.json({
            success: true,
            message: 'Manual sync skipped - recent sync exists or rate limited',
            syncType: 'skipped'
          })
        }
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Sync action error:', error)
    return NextResponse.json(
      { error: 'Failed to perform sync action' },
      { status: 500 }
    )
  }
} 