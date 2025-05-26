import { prisma } from '@/server/db'
import { optimizedSlackSync } from './optimized-slack-sync'

interface ThreadCache {
  threads: ConversationThread[]
  lastCalculated: Date
  messageCount: number
  lastMessageTimestamp: Date
}

interface ConversationThread {
  id: string
  title: string
  summary: string
  messages: Array<{
    id: string
    content: string
    timestamp: Date
    sender: {
      id: string
      name: string
    }
    platform: string
  }>
  startTime: Date
  endTime: Date
  participants: string[]
  topic: string
  actionItems?: string[]
  userParticipated: boolean
}

interface SyncResult {
  success: boolean
  newMessages: number
  errors: string[]
  skippedReason?: string
}

export class OptimizedMessageThreadingService {
  private threadCache = new Map<string, ThreadCache>() // userId -> ThreadCache
  
  /**
   * Get threaded conversations - uses cache when possible
   */
  async getThreadedConversationsForUser(userId: string, forceRefresh = false): Promise<ConversationThread[]> {
    try {
      console.log(`🧵 Getting threaded conversations for user: ${userId}`)
      
      // Check if we need to recalculate threads
      const needsRefresh = await this.shouldRefreshThreads(userId, forceRefresh)
      
      if (!needsRefresh) {
        const cached = this.threadCache.get(userId)
        if (cached) {
          console.log(`✅ Returning ${cached.threads.length} cached threads`)
          return cached.threads
        }
      }
      
      console.log(`🔄 Calculating fresh threads...`)
      
      // Get raw messages efficiently
      const rawMessages = await this.getRawMessagesOptimized(userId)
      
      if (rawMessages.length === 0) {
        console.log(`📭 No messages found for user ${userId}`)
        return []
      }
      
      // Convert to threading format
      const threadingMessages = rawMessages.map(msg => ({
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
        sender: {
          id: msg.senderId,
          name: msg.senderName
        },
        platform: msg.platform
      }))
      
      // Group by conversation and create threads
      const conversationGroups = this.groupByConversation(threadingMessages)
      const allThreads: ConversationThread[] = []
      
      for (const [conversationId, messages] of conversationGroups.entries()) {
        try {
          // Use fallback for now since AI service isn't implemented yet
          const thread = this.createFallbackThread(messages, userId)
          if (thread) {
            allThreads.push(thread)
          }
        } catch (error) {
          console.error(`Failed to create threads for conversation ${conversationId}:`, error)
        }
      }
      
      // Sort threads by most recent activity
      const sortedThreads = allThreads.sort((a, b) => b.endTime.getTime() - a.endTime.getTime())
      
      // Cache the results
      await this.cacheThreads(userId, sortedThreads, rawMessages)
      
      console.log(`✅ Generated ${sortedThreads.length} threads`)
      return sortedThreads
      
    } catch (error) {
      console.error('❌ Error getting threaded conversations:', error)
      return []
    }
  }
  
  /**
   * Check if threads need to be recalculated
   */
  private async shouldRefreshThreads(userId: string, forceRefresh: boolean): Promise<boolean> {
    if (forceRefresh) {
      console.log(`🔄 Force refresh requested`)
      return true
    }
    
    const cached = this.threadCache.get(userId)
    if (!cached) {
      console.log(`🔄 No cached threads found`)
      return true
    }
    
    // Check if it's been more than 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
    if (cached.lastCalculated < thirtyMinutesAgo) {
      console.log(`🔄 Cache expired (last calculated: ${cached.lastCalculated})`)
      return true
    }
    
    // Check if message count has changed
    const currentMessageCount = await prisma.message.count({
      where: {
        userId,
        timestamp: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      }
    })
    
    if (currentMessageCount !== cached.messageCount) {
      console.log(`🔄 Message count changed: ${cached.messageCount} -> ${currentMessageCount}`)
      return true
    }
    
    console.log(`✅ Using cached threads (${cached.threads.length} threads)`)
    return false
  }
  
  /**
   * Get raw messages optimized for threading
   */
  private async getRawMessagesOptimized(userId: string) {
    // Only get recent messages to avoid overwhelming the system
    const messages = await prisma.message.findMany({
      where: {
        userId: userId,
        timestamp: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 1000 // Reasonable limit
    })
    
    // Get unique contact IDs efficiently
    const contactIds = [...new Set(messages.map(msg => msg.contactId).filter(Boolean))]
    
    // Batch fetch contacts
    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: contactIds }
      },
      select: {
        id: true,
        fullName: true
      }
    })
    
    const contactMap = new Map(contacts.map(contact => [contact.id, contact]))
    
    return messages.map(msg => {
      const contact = contactMap.get(msg.contactId)
      return {
        id: msg.id,
        content: msg.content || '',
        timestamp: msg.timestamp,
        senderId: msg.contactId || 'unknown',
        senderName: contact?.fullName || 'Unknown',
        platform: msg.platform || 'unknown',
        conversationId: msg.contactId || 'unknown'
      }
    })
  }
  
  /**
   * Group messages by conversation efficiently
   */
  private groupByConversation(messages: Array<{
    id: string
    content: string
    timestamp: Date
    sender: { id: string; name: string }
    platform: string
  }>): Map<string, typeof messages> {
    
    const groups = new Map<string, typeof messages>()
    
    for (const message of messages) {
      const conversationKey = `${message.sender.id}_${message.platform}`
      
      if (!groups.has(conversationKey)) {
        groups.set(conversationKey, [])
      }
      groups.get(conversationKey)!.push(message)
    }
    
    return groups
  }
  
  /**
   * Create a simple thread when AI processing isn't available
   */
  private createFallbackThread(
    messages: Array<{
      id: string
      content: string
      timestamp: Date
      sender: { id: string; name: string }
      platform: string
    }>, 
    currentUserId: string
  ): ConversationThread | null {
    
    if (messages.length === 0) return null
    
    // Filter out user's own messages for display
    const displayMessages = messages.filter(m => m.sender.id !== currentUserId)
    if (displayMessages.length === 0) return null
    
    const sortedMessages = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    const participants = [...new Set(messages.map(m => m.sender.name))]
    const userParticipated = messages.some(m => m.sender.id === currentUserId)
    
    // Create a better title based on content
    const senderName = displayMessages[0]?.sender.name || 'Unknown'
    const platform = displayMessages[0]?.platform || 'unknown'
    const recentContent = displayMessages[0]?.content || ''
    
    let title = `${senderName}`
    if (recentContent.length > 0) {
      const preview = recentContent.substring(0, 30)
      title += `: ${preview}${recentContent.length > 30 ? '...' : ''}`
    }
    
    return {
      id: `thread_${sortedMessages[0].id}_${sortedMessages[sortedMessages.length - 1].id}`,
      title,
      summary: `${displayMessages.length} messages${userParticipated ? ' (you participated)' : ''}`,
      messages: displayMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
      startTime: sortedMessages[0].timestamp,
      endTime: sortedMessages[sortedMessages.length - 1].timestamp,
      participants,
      topic: platform.charAt(0).toUpperCase() + platform.slice(1),
      actionItems: [],
      userParticipated
    }
  }
  
  /**
   * Cache thread results for performance
   */
  private async cacheThreads(
    userId: string, 
    threads: ConversationThread[], 
    rawMessages: Array<{ timestamp: Date }>
  ): Promise<void> {
    const lastMessageTimestamp = rawMessages.length > 0 
      ? new Date(Math.max(...rawMessages.map(m => m.timestamp.getTime())))
      : new Date()
    
    this.threadCache.set(userId, {
      threads,
      lastCalculated: new Date(),
      messageCount: rawMessages.length,
      lastMessageTimestamp
    })
    
    console.log(`💾 Cached ${threads.length} threads for user ${userId}`)
  }
  
  /**
   * Trigger thread refresh when new messages arrive
   */
  async onNewMessages(userId: string, messageCount: number): Promise<void> {
    console.log(`📨 New messages detected for user ${userId}: ${messageCount}`)
    
    // Clear cache to force refresh on next request
    this.threadCache.delete(userId)
    
    // Optionally pre-calculate threads in background
    // await this.getThreadedConversationsForUser(userId, true)
  }
  
  /**
   * Clear cache for a user
   */
  clearCache(userId: string): void {
    this.threadCache.delete(userId)
    console.log(`🗑️ Cleared thread cache for user ${userId}`)
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): Record<string, { threadCount: number; lastCalculated: Date; messageCount: number }> {
    const stats: Record<string, { threadCount: number; lastCalculated: Date; messageCount: number }> = {}
    
    for (const [userId, cache] of this.threadCache.entries()) {
      stats[userId] = {
        threadCount: cache.threads.length,
        lastCalculated: cache.lastCalculated,
        messageCount: cache.messageCount
      }
    }
    
    return stats
  }
  
  /**
   * Integration with optimized Slack sync
   */
  async syncAndRefreshThreads(userId: string): Promise<{
    syncResult: SyncResult
    threadsRefreshed: boolean
  }> {
    console.log(`🔄 Running optimized sync + thread refresh for user ${userId}`)
    
    // Run optimized Slack sync
    const syncResult = await optimizedSlackSync.syncUserMessages(userId)
    
    // If new messages were found, refresh threads
    let threadsRefreshed = false
    if (syncResult.newMessages > 0) {
      await this.onNewMessages(userId, syncResult.newMessages)
      threadsRefreshed = true
    }
    
    return {
      syncResult,
      threadsRefreshed
    }
  }
}

export const optimizedThreadingService = new OptimizedMessageThreadingService() 