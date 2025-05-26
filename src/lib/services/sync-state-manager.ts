import { prisma } from '@/server/db'

interface SyncState {
  userId: string
  platform: string
  initialSyncComplete: boolean
  lastSyncTimestamp: Date | null
  lastMessageTimestamp: Date | null
  totalMessagesProcessed: number
  isCurrentlySyncing: boolean
}

interface SyncStateData {
  initialSyncComplete?: boolean
  lastSyncTimestamp?: string | null
  lastMessageTimestamp?: string | null
  totalMessagesProcessed?: number
  isCurrentlySyncing?: boolean
}

interface SlackIntegrationData {
  syncState?: SyncStateData
  tokens?: Record<string, unknown>
  [key: string]: unknown
}

interface GoogleIntegrationData {
  syncState?: SyncStateData
  [key: string]: unknown
}

interface PlatformSyncStatus {
  slack: SyncState | null
  gmail: SyncState | null
}

export class SyncStateManager {
  
  /**
   * Check if initial sync is complete for a user across all platforms
   */
  async isInitialSyncComplete(userId: string): Promise<boolean> {
    try {
      // Check if user has Slack connected
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          slackIntegrations: true,
          googleAccessToken: true
        }
      })

      const hasSlack = !!user?.slackIntegrations
      const hasGmail = !!user?.googleAccessToken

      // If no platforms connected, consider it "complete"
      if (!hasSlack && !hasGmail) {
        return true
      }

      // Check sync state for connected platforms
      const syncStates = await this.getSyncStates(userId)

      // All connected platforms must have completed initial sync
      if (hasSlack && (!syncStates.slack || !syncStates.slack.initialSyncComplete)) {
        return false
      }

      if (hasGmail && (!syncStates.gmail || !syncStates.gmail.initialSyncComplete)) {
        return false
      }

      return true
    } catch (error) {
      console.error('Error checking initial sync status:', error)
      return false
    }
  }

  /**
   * Get sync states for all platforms
   */
  async getSyncStates(userId: string): Promise<PlatformSyncStatus> {
    try {
      // For now, we'll store this in user preferences/metadata
      // In production, you'd want a dedicated sync_states table
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          slackIntegrations: true,
          googleIntegrations: true
        }
      })

      const slackData = user?.slackIntegrations as SlackIntegrationData | null
      const gmailData = user?.googleIntegrations as GoogleIntegrationData | null

      return {
        slack: slackData?.syncState ? {
          userId,
          platform: 'slack',
          initialSyncComplete: slackData.syncState.initialSyncComplete || false,
          lastSyncTimestamp: slackData.syncState.lastSyncTimestamp ? new Date(slackData.syncState.lastSyncTimestamp) : null,
          lastMessageTimestamp: slackData.syncState.lastMessageTimestamp ? new Date(slackData.syncState.lastMessageTimestamp) : null,
          totalMessagesProcessed: slackData.syncState.totalMessagesProcessed || 0,
          isCurrentlySyncing: slackData.syncState.isCurrentlySyncing || false
        } : null,
        gmail: gmailData?.syncState ? {
          userId,
          platform: 'gmail',
          initialSyncComplete: gmailData.syncState.initialSyncComplete || false,
          lastSyncTimestamp: gmailData.syncState.lastSyncTimestamp ? new Date(gmailData.syncState.lastSyncTimestamp) : null,
          lastMessageTimestamp: gmailData.syncState.lastMessageTimestamp ? new Date(gmailData.syncState.lastMessageTimestamp) : null,
          totalMessagesProcessed: gmailData.syncState.totalMessagesProcessed || 0,
          isCurrentlySyncing: gmailData.syncState.isCurrentlySyncing || false
        } : null
      }
    } catch (error) {
      console.error('Error getting sync states:', error)
      return { slack: null, gmail: null }
    }
  }

  /**
   * Mark initial sync as complete for a platform
   */
  async markInitialSyncComplete(
    userId: string, 
    platform: 'slack' | 'gmail',
    stats: {
      totalMessages: number
      lastMessageTimestamp?: Date
    }
  ): Promise<void> {
    try {
      const syncState = {
        initialSyncComplete: true,
        lastSyncTimestamp: new Date(),
        lastMessageTimestamp: stats.lastMessageTimestamp || new Date(),
        totalMessagesProcessed: stats.totalMessages,
        isCurrentlySyncing: false
      }

      if (platform === 'slack') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            slackIntegrations: {
              ...(await this.getCurrentIntegrations(userId, 'slack')),
              syncState
            }
          }
        })
      } else if (platform === 'gmail') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            googleIntegrations: {
              ...(await this.getCurrentIntegrations(userId, 'gmail')),
              syncState
            }
          }
        })
      }

      console.log(`✅ Marked ${platform} initial sync complete for user ${userId}: ${stats.totalMessages} messages`)
    } catch (error) {
      console.error(`Error marking ${platform} sync complete:`, error)
    }
  }

  /**
   * Update last sync timestamp for incremental syncs
   */
  async updateLastSync(
    userId: string,
    platform: 'slack' | 'gmail',
    newMessages: number,
    lastMessageTimestamp?: Date
  ): Promise<void> {
    try {
      const currentState = await this.getSyncStates(userId)
      const platformState = currentState[platform]

      const syncState = {
        initialSyncComplete: platformState?.initialSyncComplete || false,
        lastSyncTimestamp: new Date(),
        lastMessageTimestamp: lastMessageTimestamp || platformState?.lastMessageTimestamp || new Date(),
        totalMessagesProcessed: (platformState?.totalMessagesProcessed || 0) + newMessages,
        isCurrentlySyncing: false
      }

      if (platform === 'slack') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            slackIntegrations: {
              ...(await this.getCurrentIntegrations(userId, 'slack')),
              syncState
            }
          }
        })
      } else if (platform === 'gmail') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            googleIntegrations: {
              ...(await this.getCurrentIntegrations(userId, 'gmail')),
              syncState
            }
          }
        })
      }

      if (newMessages > 0) {
        console.log(`📊 Updated ${platform} sync for user ${userId}: +${newMessages} messages`)
      }
    } catch (error) {
      console.error(`Error updating ${platform} sync state:`, error)
    }
  }

  /**
   * Set sync in progress status
   */
  async setSyncInProgress(userId: string, platform: 'slack' | 'gmail', inProgress: boolean): Promise<void> {
    try {
      const currentState = await this.getSyncStates(userId)
      const platformState = currentState[platform]

      const syncState = {
        initialSyncComplete: platformState?.initialSyncComplete || false,
        lastSyncTimestamp: platformState?.lastSyncTimestamp || new Date(),
        lastMessageTimestamp: platformState?.lastMessageTimestamp || new Date(),
        totalMessagesProcessed: platformState?.totalMessagesProcessed || 0,
        isCurrentlySyncing: inProgress
      }

      if (platform === 'slack') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            slackIntegrations: {
              ...(await this.getCurrentIntegrations(userId, 'slack')),
              syncState
            }
          }
        })
      } else if (platform === 'gmail') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            googleIntegrations: {
              ...(await this.getCurrentIntegrations(userId, 'gmail')),
              syncState
            }
          }
        })
      }
    } catch (error) {
      console.error(`Error setting sync progress for ${platform}:`, error)
    }
  }

  /**
   * Check if we should do incremental sync (only if initial sync is complete)
   */
  async shouldDoIncrementalSync(userId: string, platform: 'slack' | 'gmail'): Promise<{
    shouldSync: boolean
    reason: string
    lastMessageTimestamp?: Date
  }> {
    try {
      const syncStates = await this.getSyncStates(userId)
      const platformState = syncStates[platform]

      if (!platformState) {
        return {
          shouldSync: true,
          reason: 'No sync state found - initial sync needed'
        }
      }

      if (!platformState.initialSyncComplete) {
        return {
          shouldSync: true,
          reason: 'Initial sync not complete'
        }
      }

      if (platformState.isCurrentlySyncing) {
        return {
          shouldSync: false,
          reason: 'Sync already in progress'
        }
      }

      // Only do incremental sync if it's been > 1 hour since last sync
      // (Webhooks should handle real-time updates)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      if (platformState.lastSyncTimestamp && platformState.lastSyncTimestamp > oneHourAgo) {
        return {
          shouldSync: false,
          reason: 'Recent sync completed - rely on webhooks for real-time updates'
        }
      }

      return {
        shouldSync: true,
        reason: 'Incremental sync due - checking for missed messages',
        lastMessageTimestamp: platformState.lastMessageTimestamp || undefined
      }
    } catch (error) {
      console.error(`Error checking incremental sync for ${platform}:`, error)
      return {
        shouldSync: false,
        reason: 'Error checking sync state'
      }
    }
  }

  /**
   * Get current integrations data to preserve it during updates
   */
  private async getCurrentIntegrations(userId: string, platform: 'slack' | 'gmail'): Promise<SlackIntegrationData | GoogleIntegrationData> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          slackIntegrations: platform === 'slack',
          googleIntegrations: platform === 'gmail'
        }
      })

      if (platform === 'slack') {
        return (user?.slackIntegrations as SlackIntegrationData) || {}
      } else {
        return (user?.googleIntegrations as GoogleIntegrationData) || {}
      }
    } catch (error) {
      console.error(`Error getting current ${platform} integrations:`, error)
      return {}
    }
  }

  /**
   * Reset sync state (for troubleshooting)
   */
  async resetSyncState(userId: string, platform?: 'slack' | 'gmail'): Promise<void> {
    try {
      const platforms = platform ? [platform] : ['slack', 'gmail'] as const

      for (const p of platforms) {
        if (p === 'slack') {
          await prisma.user.update({
            where: { id: userId },
            data: {
              slackIntegrations: {
                ...(await this.getCurrentIntegrations(userId, 'slack')),
                syncState: {
                  initialSyncComplete: false,
                  lastSyncTimestamp: null,
                  lastMessageTimestamp: null,
                  totalMessagesProcessed: 0,
                  isCurrentlySyncing: false
                }
              }
            }
          })
        } else if (p === 'gmail') {
          await prisma.user.update({
            where: { id: userId },
            data: {
              googleIntegrations: {
                ...(await this.getCurrentIntegrations(userId, 'gmail')),
                syncState: {
                  initialSyncComplete: false,
                  lastSyncTimestamp: null,
                  lastMessageTimestamp: null,
                  totalMessagesProcessed: 0,
                  isCurrentlySyncing: false
                }
              }
            }
          })
        }
      }

      console.log(`🔄 Reset sync state for user ${userId}${platform ? ` (${platform})` : ' (all platforms)'}`)
    } catch (error) {
      console.error('Error resetting sync state:', error)
    }
  }
}

export const syncStateManager = new SyncStateManager() 