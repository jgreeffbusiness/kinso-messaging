import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { SlackAdapter } from '@/lib/platforms/adapters/slack'
import { unifiedMessageSyncService } from '@/lib/services/unified-message-sync-service'
import { prisma } from '@/server/db'

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

    const slackAdapter = new SlackAdapter()
    const isAuthenticated = await slackAdapter.isAuthenticated(userId)
    
    if (!isAuthenticated) {
      return NextResponse.json({ 
        isConnected: false,
        isEnabled: false,
        recentMessagesCount: 0
      })
    }

    // Get user data to extract team info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        slackIntegrations: true,
        slackTeamId: true
      }
    })

    const integrations = user?.slackIntegrations as { enabled?: boolean; team?: { name?: string } } | null
    const teamName = integrations?.team?.name || 'Unknown Team'
    const isEnabled = integrations?.enabled === true

    // Get sync status from unified sync service
    try {
      const syncStatus = await unifiedMessageSyncService.getSyncStatus(userId)
      const slackStatus = syncStatus.platforms.slack || {}
      
      return NextResponse.json({ 
        isConnected: true,
        isEnabled,
        teamName,
        recentMessagesCount: slackStatus.messages || 0,
        lastSync: slackStatus.lastSync,
        contacts: slackStatus.contacts || 0,
        messages: slackStatus.messages || 0
      })
    } catch (syncError) {
      // If sync status fails, still return basic connection info
      console.error('Failed to get sync status:', syncError)
      
      return NextResponse.json({ 
        isConnected: true,
        isEnabled,
        teamName,
        recentMessagesCount: 0,
        lastSync: null,
        contacts: 0,
        messages: 0
      })
    }

  } catch (error) {
    console.error('Slack sync status error:', error)
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    )
  }
}

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

    console.log(`Starting unified sync for user ${userId}`)
    
    // Use the unified sync service which handles contact matching
    const syncResult = await unifiedMessageSyncService.syncAllPlatforms(userId)
    
    // Extract Slack-specific results
    const slackResult = syncResult.platforms.find(p => p.platform === 'slack')
    
    if (!slackResult) {
      return NextResponse.json({
        success: false,
        error: 'Slack sync not performed - platform not connected'
      }, { status: 400 })
    }

    if (slackResult.errors.length > 0) {
      console.warn('Slack sync completed with errors:', slackResult.errors)
    }

    return NextResponse.json({
      success: true,
      result: {
        contactsProcessed: slackResult.contactsProcessed,
        contactsCreated: slackResult.contactsCreated,
        contactsMatched: slackResult.contactsMatched,
        messagesProcessed: slackResult.messagesProcessed,
        newMessages: slackResult.newMessages,
        crossPlatformMatches: syncResult.crossPlatformMatches,
        errors: slackResult.errors
      }
    })

  } catch (error) {
    console.error('Slack sync error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Sync failed' 
      },
      { status: 500 }
    )
  }
} 