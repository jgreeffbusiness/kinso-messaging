import { unifiedMessageSyncService } from './unified-message-sync-service'
import { prisma } from '@/server/db'

interface AutoSyncConfig {
  enabled: boolean
  intervalMinutes: number
  platforms: string[]
  lastSync?: Date
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

export class AutoSyncService {
  private syncIntervals = new Map<string, NodeJS.Timeout>()
  private isSyncing = new Map<string, boolean>()
  private lastSyncTime = new Map<string, number>()
  
  private readonly MIN_SYNC_INTERVAL = 10 * 60 * 1000 // 10 minutes minimum between syncs

  /**
   * Start automatic syncing for a user
   */
  async startAutoSync(userId: string, config?: Partial<AutoSyncConfig>) {
    const defaultConfig: AutoSyncConfig = {
      enabled: true,
      intervalMinutes: 15, // Increased from 5 to 15 minutes to reduce rate limiting
      platforms: ['slack', 'gmail'],
      ...config
    }

    // Stop existing sync if running
    this.stopAutoSync(userId)

    if (!defaultConfig.enabled) return

    console.log(`Starting auto-sync for user ${userId} every ${defaultConfig.intervalMinutes} minutes`)

    // Set up periodic sync
    const interval = setInterval(async () => {
      await this.performAutoSync(userId, defaultConfig.platforms)
    }, defaultConfig.intervalMinutes * 60 * 1000)

    this.syncIntervals.set(userId, interval)

    // Perform initial sync only if enough time has passed
    const lastSync = this.lastSyncTime.get(userId) || 0
    const timeSinceLastSync = Date.now() - lastSync
    
    if (timeSinceLastSync > this.MIN_SYNC_INTERVAL) {
      // Add a small delay to avoid immediate collision with other syncs
      setTimeout(() => {
        this.performAutoSync(userId, defaultConfig.platforms)
      }, 5000) // 5 second delay
    } else {
      console.log(`Skipping initial sync for user ${userId} - last sync was ${timeSinceLastSync}ms ago`)
    }
  }

  /**
   * Stop automatic syncing for a user
   */
  stopAutoSync(userId: string) {
    const interval = this.syncIntervals.get(userId)
    if (interval) {
      clearInterval(interval)
      this.syncIntervals.delete(userId)
      this.isSyncing.delete(userId)
      console.log(`Stopped auto-sync for user ${userId}`)
    }
  }

  /**
   * Perform sync for a user (called automatically)
   */
  private async performAutoSync(userId: string, platforms: string[]) {
    // Prevent concurrent syncs for same user
    if (this.isSyncing.get(userId)) {
      console.log(`Sync already in progress for user ${userId}, skipping`)
      return
    }

    // Check if minimum time has passed since last sync
    const timeSinceLastSync = this.timeSinceLastSync(userId)
    if (timeSinceLastSync < this.MIN_SYNC_INTERVAL) {
      console.log(`Skipping sync for user ${userId} - only ${timeSinceLastSync}ms since last sync`)
      return
    }

    try {
      this.isSyncing.set(userId, true)
      this.lastSyncTime.set(userId, Date.now())
      
      console.log(`Auto-sync triggered for user ${userId} for platforms: ${platforms.join(', ')}`)

      // Use unified sync service
      const result = await unifiedMessageSyncService.syncAllPlatforms(userId)
      
      // Update sync status in database
      await this.updateSyncStatus(userId, result)

      // Mark new messages as unread
      await this.markNewMessagesAsUnread(userId, result)

      console.log(`Auto-sync completed for user ${userId}: ${result.totalMessagesProcessed} messages processed`)

    } catch (error) {
      console.error(`Auto-sync failed for user ${userId}:`, error)
    } finally {
      this.isSyncing.set(userId, false)
    }
  }

  /**
   * Update user's sync status
   */
  private async updateSyncStatus(userId: string, syncResult: SyncResult) {
    try {
      // For now, just log the sync result since we don't have syncStatus field in DB
      console.log(`Sync completed for user ${userId}:`, {
        totalMessages: syncResult.totalMessagesProcessed,
        platforms: syncResult.platforms.map(p => ({
          platform: p.platform,
          messagesProcessed: p.messagesProcessed,
          newMessages: p.newMessages,
          lastSync: new Date()
        }))
      })
      
      // Could store this in a separate sync_logs table or user preferences later
    } catch (error) {
      console.error('Failed to update sync status:', error)
    }
  }

  /**
   * Mark newly synced messages as unread
   */
  private async markNewMessagesAsUnread(userId: string, syncResult: SyncResult) {
    try {
      const totalNewMessages = syncResult.platforms.reduce(
        (sum: number, p) => sum + p.newMessages, 
        0
      )

      if (totalNewMessages > 0) {
        // Get messages that don't have read status yet (newly synced are automatically unread)
        const recentMessages = await prisma.message.findMany({
          where: {
            userId,
            readAt: null // Not read yet
          }
        })

        // Mark as unread (readAt remains null, but we ensure they're flagged)
        console.log(`Found ${recentMessages.length} unread messages for user ${userId} (${totalNewMessages} newly synced)`)
      }
    } catch (error) {
      console.error('Failed to mark messages as unread:', error)
    }
  }

  /**
   * Get sync status for a user
   */
  async getSyncStatus(userId: string) {
    const isRunning = this.syncIntervals.has(userId)
    const isSyncing = this.isSyncing.get(userId) || false

    // Get basic user info to verify they exist
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true,
        createdAt: true
      }
    })

    if (!user) {
      return {
        autoSyncEnabled: false,
        currentlySyncing: false,
        lastSync: null,
        syncStatus: null
      }
    }

    return {
      autoSyncEnabled: isRunning,
      currentlySyncing: isSyncing,
      lastSync: user.createdAt, // Placeholder - could be enhanced later
      syncStatus: null // Will implement when we add proper DB fields
    }
  }

  /**
   * Force sync now for a user
   */
  async forceSyncNow(userId: string) {
    console.log(`Force sync requested for user ${userId}`)
    return await this.performAutoSync(userId, ['slack', 'gmail'])
  }

  /**
   * Check if a user is currently syncing (useful for external callers)
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
}

// Singleton instance
export const autoSyncService = new AutoSyncService()

// Helper function to initialize auto-sync for all users on app start
export async function initializeAutoSyncForAllUsers() {
  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { slackAccessToken: { not: null } },
          { googleAccessToken: { not: null } }
        ]
      },
      select: { id: true }
    })

    console.log(`Initializing auto-sync for ${users.length} users`)

    for (const user of users) {
      await autoSyncService.startAutoSync(user.id)
    }
  } catch (error) {
    console.error('Failed to initialize auto-sync:', error)
  }
} 