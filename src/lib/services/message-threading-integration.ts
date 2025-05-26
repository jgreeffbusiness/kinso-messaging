import { conversationThreadingService } from '@/lib/ai/conversation-threading'
import { prisma } from '@/server/db'

// Types for the raw message data from your existing system
interface RawMessage {
  id: string
  content: string
  timestamp: Date
  senderId: string
  senderName: string
  platform: string
  conversationId: string
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

export class MessageThreadingIntegrationService {
  
  /**
   * Get threaded conversations for a user, combining all platforms
   */
  async getThreadedConversationsForUser(userId: string): Promise<ConversationThread[]> {
    // Get raw messages from all platforms
    const rawMessages = await this.getRawMessagesForUser(userId)
    
    if (rawMessages.length === 0) {
      return []
    }
    
    // Convert to threading service format
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
    
    // Group by conversation/contact and create threads
    const conversationGroups = this.groupByConversation(threadingMessages)
    const allThreads: ConversationThread[] = []
    
    for (const [conversationId, messages] of conversationGroups.entries()) {
      try {
        const threads = await conversationThreadingService.createConversationThreads(
          messages, 
          userId
        )
        allThreads.push(...threads)
      } catch (error) {
        console.error(`Failed to create threads for conversation ${conversationId}:`, error)
        // Fall back to a simple single thread
        const fallbackThread = this.createFallbackThread(messages, userId)
        if (fallbackThread) {
          allThreads.push(fallbackThread)
        }
      }
    }
    
    // Sort threads by most recent activity
    return allThreads.sort((a, b) => b.endTime.getTime() - a.endTime.getTime())
  }
  
  /**
   * Get raw messages from your existing database
   */
  private async getRawMessagesForUser(userId: string): Promise<RawMessage[]> {
    try {
      // This queries your existing messages table structure
      const messages = await prisma.message.findMany({
        where: {
          userId: userId,
          // Only get recent messages (last 30 days) to avoid overwhelming the AI
          timestamp: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        },
        orderBy: {
          timestamp: 'desc'
        },
        take: 500 // Limit to recent messages
      })
      
      // Get all unique contact IDs
      const contactIds = [...new Set(messages.map(msg => msg.contactId).filter(Boolean))]
      
      // Fetch contact information separately
      const contacts = await prisma.contact.findMany({
        where: {
          id: {
            in: contactIds
          }
        },
        select: {
          id: true,
          fullName: true
        }
      })
      
      // Create a map for quick contact lookup
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
      
    } catch (error) {
      console.error('Failed to fetch raw messages:', error)
      return []
    }
  }
  
  /**
   * Group messages by conversation/contact
   */
  private groupByConversation(messages: Array<{
    id: string
    content: string
    timestamp: Date
    sender: {
      id: string
      name: string
    }
    platform: string
  }>): Map<string, typeof messages> {
    
    const groups = new Map<string, typeof messages>()
    
    for (const message of messages) {
      // Use sender ID + platform as conversation key
      const conversationKey = `${message.sender.id}_${message.platform}`
      
      if (!groups.has(conversationKey)) {
        groups.set(conversationKey, [])
      }
      groups.get(conversationKey)!.push(message)
    }
    
    return groups
  }
  
  /**
   * Create a simple fallback thread when AI processing fails
   */
  private createFallbackThread(
    messages: Array<{
      id: string
      content: string
      timestamp: Date
      sender: {
        id: string
        name: string
      }
      platform: string
    }>, 
    currentUserId: string
  ): ConversationThread | null {
    
    if (messages.length === 0) return null
    
    // Filter out user's own messages
    const displayMessages = messages.filter(m => m.sender.id !== currentUserId)
    if (displayMessages.length === 0) return null
    
    const sortedMessages = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    const participants = [...new Set(messages.map(m => m.sender.name))]
    const userParticipated = messages.some(m => m.sender.id === currentUserId)
    
    return {
      id: `fallback_${sortedMessages[0].id}_${sortedMessages[sortedMessages.length - 1].id}`,
      title: `Conversation with ${displayMessages[0]?.sender.name || 'Unknown'}`,
      summary: `${displayMessages.length} messages from ${displayMessages[0]?.sender.name}`,
      messages: displayMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
      startTime: sortedMessages[0].timestamp,
      endTime: sortedMessages[sortedMessages.length - 1].timestamp,
      participants,
      topic: 'General',
      actionItems: [],
      userParticipated
    }
  }
  
  /**
   * Refresh threads for a specific user (useful after new message sync)
   */
  async refreshThreadsForUser(userId: string): Promise<void> {
    // This could cache the results or trigger background processing
    console.log(`Refreshing conversation threads for user ${userId}`)
    
    try {
      const threads = await this.getThreadedConversationsForUser(userId)
      console.log(`Generated ${threads.length} conversation threads`)
      
      // Optionally cache results in database or memory store
      // await this.cacheThreads(userId, threads)
      
    } catch (error) {
      console.error('Failed to refresh threads:', error)
    }
  }
}

export const messageThreadingService = new MessageThreadingIntegrationService() 