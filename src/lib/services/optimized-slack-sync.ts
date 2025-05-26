import { prisma } from '@/server/db'
import { SlackAdapter } from '@/lib/platforms/adapters/slack'
import { PlatformContact } from '@/lib/platforms/types'

interface SlackConversation {
  id: string
  name?: string
  is_im?: boolean
  is_mpim?: boolean
  user?: string
}

interface SlackMessage {
  ts: string
  text?: string
  user?: string
  channel?: string
  thread_ts?: string
}

interface SyncState {
  lastContactSync: Date | null
  lastMessageSync: Date | null
  cachedContacts: Map<string, PlatformContact>
  conversationCursors: Map<string, string> // conversation_id -> last_ts
}

interface IncrementalSyncOptions {
  forceContactRefresh?: boolean
  specificConversationId?: string
  onlyNewMessages?: boolean
}

interface SyncStats {
  lastContactSync: Date | null
  lastMessageSync: Date | null
  cachedContactsCount: number
  conversationCursorsCount: number
  conversationCursors: Record<string, string>
}

export class OptimizedSlackSyncService {
  private slackAdapter = new SlackAdapter()
  private syncState = new Map<string, SyncState>() // userId -> syncState
  
  /**
   * Smart sync that only fetches what's needed
   */
  async syncUserMessages(
    userId: string, 
    options: IncrementalSyncOptions = {}
  ): Promise<{
    success: boolean
    newMessages: number
    errors: string[]
    skippedReason?: string
  }> {
    try {
      console.log(`🔄 Starting optimized Slack sync for user ${userId}`)
      
      // Get or initialize sync state
      const state = this.getSyncState(userId)
      
      // 1. Check if contacts need refreshing (only if never synced or forced)
      if (!state.lastContactSync || options.forceContactRefresh) {
        await this.syncContactsIfNeeded(userId, state)
      } else {
        console.log(`📋 Skipping contact sync (last synced: ${state.lastContactSync})`)
      }
      
      // 2. Get conversation list (cached if available)
      const conversations = await this.getConversationsWithCache(userId)
      
      if (conversations.length === 0) {
        return {
          success: true,
          newMessages: 0,
          errors: [],
          skippedReason: 'No conversations found'
        }
      }
      
      // 3. Sync messages incrementally
      let totalNewMessages = 0
      const errors: string[] = []
      
      for (const conversation of conversations) {
        try {
          const newMessages = await this.syncConversationMessages(
            userId, 
            conversation, 
            state
          )
          totalNewMessages += newMessages
        } catch (error) {
          console.error(`❌ Error syncing conversation ${conversation.id}:`, error)
          errors.push(`Conversation ${conversation.id}: ${error}`)
        }
      }
      
      // 4. Update sync timestamps
      state.lastMessageSync = new Date()
      this.syncState.set(userId, state)
      
      console.log(`✅ Optimized sync complete: ${totalNewMessages} new messages`)
      
      return {
        success: true,
        newMessages: totalNewMessages,
        errors
      }
      
    } catch (error) {
      console.error('❌ Optimized sync failed:', error)
      return {
        success: false,
        newMessages: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }
  
  /**
   * Only sync contacts if needed (first time or forced refresh)
   */
  private async syncContactsIfNeeded(userId: string, state: SyncState): Promise<void> {
    console.log(`📋 Syncing Slack contacts...`)
    
    // Check database to see if we have contacts already
    const existingContactCount = await prisma.contact.count({
      where: {
        userId,
        source: 'slack'
      }
    })
    
    // Only fetch from API if we don't have contacts or it's been > 24 hours
    const shouldRefresh = existingContactCount === 0 || 
      !state.lastContactSync || 
      (Date.now() - state.lastContactSync.getTime()) > 24 * 60 * 60 * 1000
    
    if (!shouldRefresh) {
      console.log(`📋 Skipping contact API fetch (${existingContactCount} cached contacts)`)
      return
    }
    
    try {
      const contacts = await this.slackAdapter.fetchContacts(userId)
      console.log(`📋 Fetched ${contacts.length} contacts from Slack API`)
      
      // Cache contacts in memory for this session
      state.cachedContacts.clear()
      contacts.forEach(contact => {
        state.cachedContacts.set(contact.handle || contact.email || contact.name, contact)
      })
      
      state.lastContactSync = new Date()
    } catch (error) {
      console.error('❌ Contact sync failed:', error)
      throw error
    }
  }
  
  /**
   * Get conversations with smart caching
   */
  private async getConversationsWithCache(userId: string): Promise<SlackConversation[]> {
    // For conversations, we can afford to fetch them since it's a lightweight call
    // But we could cache this too if needed
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { 
          slackAccessToken: true,
          slackIntegrations: true
        }
      })

      if (!user?.slackAccessToken) {
        throw new Error('User not authenticated with Slack')
      }

      // Get user token for personal DMs
      const integrations = user.slackIntegrations as { tokens?: { userToken?: string } } | null
      const userToken = integrations?.tokens?.userToken

      if (!userToken) {
        throw new Error('User token not available - please reconnect Slack')
      }

      // Use the existing SlackAdapter method but with user token
      const conversations = await this.fetchSlackConversations(userToken, userId)
      console.log(`💬 Found ${conversations.length} conversations`)
      
      return conversations
    } catch (error) {
      console.error('❌ Failed to get conversations:', error)
      return []
    }
  }
  
  /**
   * Sync messages for a specific conversation incrementally
   */
  private async syncConversationMessages(
    userId: string,
    conversation: SlackConversation,
    state: SyncState
  ): Promise<number> {
    
    const conversationId = conversation.id
    const lastCursor = state.conversationCursors.get(conversationId)
    
    console.log(`📨 Syncing conversation ${conversationId} (last cursor: ${lastCursor || 'none'})`)
    
    try {
      // Get user token
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { slackIntegrations: true }
      })

      const integrations = user?.slackIntegrations as { tokens?: { userToken?: string } } | null
      const userToken = integrations?.tokens?.userToken

      if (!userToken) {
        throw new Error('User token not available')
      }
      
      // Fetch only new messages since last cursor
      const messages = await this.fetchSlackConversationHistory(
        userToken,
        conversationId,
        userId,
        {
          oldest: lastCursor,
          limit: 100
        }
      )
      
      if (messages.length === 0) {
        console.log(`📨 No new messages in conversation ${conversationId}`)
        return 0
      }
      
      console.log(`📨 Found ${messages.length} new messages in conversation ${conversationId}`)
      
      // Convert and save messages to database
      const convertedMessages = messages.map(msg => 
        this.slackAdapter['convertSlackMessage'](msg, conversation)
      )
      
      let savedCount = 0
      for (const platformMessage of convertedMessages) {
        try {
          // Check if message already exists
          const existing = await prisma.message.findFirst({
            where: {
              userId,
              platform: 'slack',
              platformMessageId: platformMessage.platformId
            }
          })

          if (existing) {
            continue // Skip if already exists
          }

          // Find or create contact for the sender
          const contactId = await this.findOrCreateContact(platformMessage.sender, userId)

          // Create new message
          await prisma.message.create({
            data: {
              userId,
              contactId,
              platform: 'slack',
              platformMessageId: platformMessage.platformId,
              content: platformMessage.content,
              timestamp: platformMessage.timestamp,
              platformData: {
                threadId: platformMessage.threadId,
                direction: platformMessage.direction,
                sender: platformMessage.sender,
                recipients: platformMessage.recipients,
                ...platformMessage.metadata
              }
            }
          })
          
          savedCount++
        } catch (error) {
          console.error(`❌ Failed to save message ${platformMessage.platformId}:`, error)
        }
      }
      
      console.log(`💾 Saved ${savedCount} new messages from conversation ${conversationId}`)
      
      // Update cursor to the latest message timestamp
      const latestMessage = messages[messages.length - 1]
      if (latestMessage?.ts) {
        state.conversationCursors.set(conversationId, latestMessage.ts)
      }
      
      return savedCount
      
    } catch (error) {
      console.error(`❌ Failed to sync conversation ${conversationId}:`, error)
      throw error
    }
  }
  
  /**
   * Find or create contact based on platform contact info
   */
  private async findOrCreateContact(platformContact: { 
    name?: string; 
    handle?: string; 
    email?: string;
    id?: string;
  }, userId: string): Promise<string> {
    try {
      // Try to find existing contact by handle (Slack user ID)
      if (platformContact.handle) {
        const existing = await prisma.contact.findFirst({
          where: {
            userId,
            OR: [
              { platformData: { path: ['slackUserId'], equals: platformContact.handle } },
              { email: platformContact.email },
              { fullName: platformContact.name }
            ]
          }
        })

        if (existing) {
          return existing.id
        }
      }

      // Create new contact
      const created = await prisma.contact.create({
        data: {
          userId,
          fullName: platformContact.name || 'Unknown User',
          email: null, // Slack doesn't always provide email in DMs
          source: 'slack',
          platformData: {
            slackUserId: platformContact.handle,
            slackHandle: platformContact.handle
          }
        }
      })

      console.log(`👤 Created new contact: ${created.fullName} (${created.id})`)
      return created.id
    } catch (error) {
      console.error('Failed to find/create contact:', error)
      throw error
    }
  }
  
  /**
   * Get or initialize sync state for a user
   */
  private getSyncState(userId: string): SyncState {
    if (!this.syncState.has(userId)) {
      this.syncState.set(userId, {
        lastContactSync: null,
        lastMessageSync: null,
        cachedContacts: new Map(),
        conversationCursors: new Map()
      })
    }
    return this.syncState.get(userId)!
  }
  
  /**
   * Trigger sync only when there are actually new messages
   * (This would be called by webhooks or user actions)
   */
  async triggerSyncIfNeeded(userId: string, reason: string): Promise<void> {
    const state = this.getSyncState(userId)
    const now = new Date()
    
    // Don't sync more than once every 5 minutes unless forced
    if (state.lastMessageSync && (now.getTime() - state.lastMessageSync.getTime()) < 5 * 60 * 1000) {
      console.log(`⏭️  Skipping sync for ${userId} - too recent (${reason})`)
      return
    }
    
    console.log(`🚀 Triggering sync for ${userId} - reason: ${reason}`)
    await this.syncUserMessages(userId, { onlyNewMessages: true })
  }
  
  /**
   * Targeted sync for webhook events - only sync the specific channel
   * This prevents full syncs when we know exactly which channel has new messages
   */
  async syncSpecificChannel(userId: string, channelId: string, reason: string): Promise<{
    success: boolean
    newMessages: number
    channelId: string
  }> {
    try {
      console.log(`🎯 Targeted webhook sync for user ${userId}, channel ${channelId} - ${reason}`)
      
      const state = this.getSyncState(userId)
      
      // Create a minimal conversation object for this channel
      const conversation: SlackConversation = {
        id: channelId,
        is_im: true // Assume it's a DM since webhooks are configured for DMs
      }
      
      // Sync only this specific conversation
      const newMessages = await this.syncConversationMessages(
        userId, 
        conversation, 
        state
      )
      
      // Update only the message sync timestamp, not full sync
      state.lastMessageSync = new Date()
      this.syncState.set(userId, state)
      
      console.log(`✅ Targeted sync complete: ${newMessages} new messages in channel ${channelId}`)
      
      return {
        success: true,
        newMessages,
        channelId
      }
      
    } catch (error) {
      console.error(`❌ Targeted sync failed for channel ${channelId}:`, error)
      return {
        success: false,
        newMessages: 0,
        channelId
      }
    }
  }
  
  /**
   * Clear cache for a user (useful for troubleshooting)
   */
  clearUserCache(userId: string): void {
    this.syncState.delete(userId)
    console.log(`🗑️  Cleared sync cache for user ${userId}`)
  }
  
  /**
   * Get sync statistics for debugging
   */
  getSyncStats(userId: string): SyncStats | null {
    const state = this.syncState.get(userId)
    if (!state) return null
    
    return {
      lastContactSync: state.lastContactSync,
      lastMessageSync: state.lastMessageSync,
      cachedContactsCount: state.cachedContacts.size,
      conversationCursorsCount: state.conversationCursors.size,
      conversationCursors: Object.fromEntries(state.conversationCursors)
    }
  }
  
  // Helper methods (using existing SlackAdapter methods privately)
  private async fetchSlackConversations(userToken: string, userId: string): Promise<SlackConversation[]> {
    // Use the existing method from SlackAdapter
    return await this.slackAdapter['fetchSlackConversations'](userToken, userId)
  }
  
  private async fetchSlackConversationHistory(
    userToken: string,
    conversationId: string,
    userId: string,
    options: { oldest?: string; limit?: number }
  ): Promise<SlackMessage[]> {
    // Use the existing method from SlackAdapter
    return await this.slackAdapter['fetchSlackConversationHistory'](
      userToken,
      conversationId,
      userId,
      options
    )
  }
}

export const optimizedSlackSync = new OptimizedSlackSyncService() 