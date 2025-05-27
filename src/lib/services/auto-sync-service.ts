import { unifiedMessageSyncService } from './unified-message-sync-service'
import { prisma } from '@/server/db'

interface InitialSyncConfig {
  platforms?: string[]
  forceSync?: boolean // Force external API calls
  maxStaleness?: number // Max age before considering data stale
}

interface SyncResult {
  platforms: Array<{
    platform: string
    messagesProcessed: number
    newMessages: number
    contactsProcessed: number
    contactsCreated: number
    contactsMatched: number
    errors: string[]
  }>
  totalContactsProcessed: number
  totalMessagesProcessed: number
  crossPlatformMatches: number
  errors: string[]
}

interface CachedSyncStatus {
  syncType: 'cached' | 'fresh' | 'stale'
  lastSync: Date | null
  dataAge: number // in milliseconds
  platforms: Array<{
    platform: string
    contactCount: number
    messageCount: number
    lastActivity: Date | null
  }>
  totalContacts: number
  totalMessages: number
}

export class AutoSyncService {
  private isSyncing = new Map<string, boolean>()
  private lastSyncTime = new Map<string, number>()
  
  // Smart sync thresholds
  private readonly FRESH_DATA_THRESHOLD = 4 * 60 * 60 * 1000 // 4 hours - data is "fresh"
  private readonly STALE_DATA_THRESHOLD = 24 * 60 * 60 * 1000 // 24 hours - data is "stale"
  private readonly MIN_FORCE_SYNC_INTERVAL = 5 * 60 * 1000 // 5 minutes between forced syncs

  /**
   * Get current status with cached data - fast, no external API calls
   */
  async getCachedStatus(userId: string): Promise<CachedSyncStatus> {
    const lastSyncTime = this.lastSyncTime.get(userId)
    const lastSync = lastSyncTime ? new Date(lastSyncTime) : null
    const dataAge = lastSyncTime ? Date.now() - lastSyncTime : Infinity

    // Get counts from database (cached data)
    const [contacts, messages] = await Promise.all([
      prisma.contact.findMany({
        where: { userId },
        select: { 
          id: true, 
          platformData: true,
          updatedAt: true
        }
      }),
      prisma.message.findMany({
        where: { userId },
        select: { 
          id: true, 
          platform: true,
          timestamp: true
        }
      })
    ])

    // Group by platform
    const platformStats = ['slack', 'gmail'].map(platform => {
      const platformContacts = contacts.filter(c => {
        const platformData = c.platformData as Record<string, unknown>
        return platformData && platformData[platform]
      })
      
      const platformMessages = messages.filter(m => 
        m.platform === platform || (platform === 'gmail' && m.platform === 'email')
      )

      const lastActivity = platformMessages.length > 0 
        ? new Date(Math.max(...platformMessages.map(m => m.timestamp.getTime())))
        : null

      return {
        platform,
        contactCount: platformContacts.length,
        messageCount: platformMessages.length,
        lastActivity
      }
    })

    const syncType: 'cached' | 'fresh' | 'stale' = 
      dataAge === Infinity ? 'cached' :
      dataAge < this.FRESH_DATA_THRESHOLD ? 'fresh' :
      dataAge < this.STALE_DATA_THRESHOLD ? 'cached' : 'stale'

    return {
      syncType,
      lastSync,
      dataAge,
      platforms: platformStats,
      totalContacts: contacts.length,
      totalMessages: messages.length
    }
  }

  /**
   * Determine if we should sync from external APIs
   */
  async shouldSyncExternally(userId: string, config?: InitialSyncConfig): Promise<{
    shouldSync: boolean
    reason: string
    platforms: string[]
  }> {
    const { forceSync = false, maxStaleness = this.STALE_DATA_THRESHOLD } = config || {}

    // Always skip if force sync was recent
    if (forceSync) {
      const timeSinceLastSync = this.timeSinceLastSync(userId)
      if (timeSinceLastSync < this.MIN_FORCE_SYNC_INTERVAL) {
        return {
          shouldSync: false,
          reason: `Force sync blocked - only ${timeSinceLastSync}ms since last sync`,
          platforms: []
        }
      }
    }

    // Check if currently syncing
    if (this.isSyncing.get(userId)) {
      return {
        shouldSync: false,
        reason: 'Sync already in progress',
        platforms: []
      }
    }

    const cachedStatus = await this.getCachedStatus(userId)
    
    // If forced, sync all valid platforms
    if (forceSync) {
      const validPlatforms = await this.getValidPlatforms(userId)
      return {
        shouldSync: validPlatforms.length > 0,
        reason: 'Manual sync requested',
        platforms: validPlatforms
      }
    }

    // If no data exists, do initial sync
    if (cachedStatus.totalContacts === 0 && cachedStatus.totalMessages === 0) {
      const validPlatforms = await this.getValidPlatforms(userId)
      return {
        shouldSync: validPlatforms.length > 0,
        reason: 'No cached data - initial sync needed',
        platforms: validPlatforms
      }
    }

    // If data is stale, suggest sync
    if (cachedStatus.dataAge > maxStaleness) {
      const validPlatforms = await this.getValidPlatforms(userId)
      return {
        shouldSync: validPlatforms.length > 0,
        reason: `Data is stale (${Math.round(cachedStatus.dataAge / (1000 * 60 * 60))} hours old)`,
        platforms: validPlatforms
      }
    }

    // Otherwise, use cached data
    return {
      shouldSync: false,
      reason: `Using cached data (${Math.round(cachedStatus.dataAge / (1000 * 60))} minutes old)`,
      platforms: []
    }
  }

  /**
   * Get valid platforms for a user (without triggering API calls)
   */
  private async getValidPlatforms(userId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleTokenExpiry: true,
        googleIntegrations: true,
        slackAccessToken: true,
      }
    })

    if (!user) return []

    const validPlatforms: string[] = []
    
    // Check Gmail
    if (user.googleAccessToken && 
        user.googleTokenExpiry && 
        user.googleTokenExpiry > new Date() &&
        user.googleIntegrations && 
        typeof user.googleIntegrations === 'object' &&
        !Array.isArray(user.googleIntegrations) &&
        'gmail' in user.googleIntegrations &&
        user.googleIntegrations.gmail === true) {
      validPlatforms.push('gmail')
    }
    
    // Check Slack
    if (user.slackAccessToken) {
      validPlatforms.push('slack')
    }

    return validPlatforms
  }

  /**
   * Perform sync only when needed - cached-first approach
   */
  async performInitialSync(userId: string, config?: InitialSyncConfig): Promise<SyncResult | null> {
    const syncDecision = await this.shouldSyncExternally(userId, config)
    
    if (!syncDecision.shouldSync) {
      console.log(`📚 Using cached data for user ${userId}: ${syncDecision.reason}`)
      return null
    }

    try {
      this.isSyncing.set(userId, true)
      this.lastSyncTime.set(userId, Date.now())
      
      console.log(`🔄 External sync for user ${userId}: ${syncDecision.reason}`)
      console.log(`📡 Fetching from: ${syncDecision.platforms.join(', ')}`)

      const result = await unifiedMessageSyncService.syncAllPlatforms(userId)
      
      console.log(`✅ External sync completed for user ${userId}: ${result.totalMessagesProcessed} messages processed`)
      
      return result

    } catch (error) {
      console.error(`❌ External sync failed for user ${userId}:`, error)
      throw error
    } finally {
      this.isSyncing.set(userId, false)
    }
  }

  /**
   * Force sync from external APIs (user-initiated)
   */
  async forceSyncNow(userId: string): Promise<SyncResult | null> {
    console.log(`🔄 Manual sync requested for user ${userId}`)
    return await this.performInitialSync(userId, { forceSync: true })
  }

  /**
   * Check if a user is currently syncing
   */
  isUserSyncing(userId: string): boolean {
    return this.isSyncing.get(userId) || false
  }

  /**
   * Get time since last sync for a user
   */
  timeSinceLastSync(userId: string): number {
    const lastSync = this.lastSyncTime.get(userId)
    return lastSync ? Date.now() - lastSync : Infinity
  }

  /**
   * Get comprehensive sync status
   */
  async getSyncStatus(userId: string) {
    const isSyncing = this.isSyncing.get(userId) || false
    const lastSyncTime = this.lastSyncTime.get(userId)
    const cachedStatus = await this.getCachedStatus(userId)
    const syncDecision = await this.shouldSyncExternally(userId)

    return {
      currentlySyncing: isSyncing,
      lastSync: lastSyncTime ? new Date(lastSyncTime) : null,
      webhooksEnabled: true,
      syncStrategy: 'cached-first + webhooks',
      cachedData: cachedStatus,
      recommendedAction: syncDecision.shouldSync ? 'sync' : 'use-cache',
      reason: syncDecision.reason
    }
  }
}

// Singleton instance
export const autoSyncService = new AutoSyncService()

/**
 * Initialize webhook-driven sync system
 */
export async function initializeWebhookDrivenSync() {
  console.log('🚀 Initializing cached-first sync system...')
  
  // Set up webhook endpoints if not already done
  // This would include Slack event subscriptions, Gmail push notifications, etc.
  
  console.log('✅ Cached-first sync system ready')
  console.log('ℹ️  Strategy: Cached data first + External sync only when needed + Webhooks for real-time')
} 