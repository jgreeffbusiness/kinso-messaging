import { getPlatformRegistry } from '@/lib/platforms'
import { prisma } from '@/server/db'
import { processEmailContent } from '@/lib/email-processor'
import type { 
  PlatformMessage, 
  NormalizedMessage, 
  EnhancedMessage,
  SyncResult 
} from '@/lib/platforms/types'

export class UnifiedMessageService {
  private static instance: UnifiedMessageService

  static getInstance(): UnifiedMessageService {
    if (!UnifiedMessageService.instance) {
      UnifiedMessageService.instance = new UnifiedMessageService()
    }
    return UnifiedMessageService.instance
  }

  /**
   * Sync messages from all platforms for a user
   */
  async syncAllPlatforms(userId: string): Promise<Record<string, SyncResult>> {
    const registry = getPlatformRegistry()
    const results: Record<string, SyncResult> = {}

    for (const adapter of registry.getAllAdapters()) {
      try {
        console.log(`Syncing ${adapter.config.displayName} for user ${userId}`)
        
        // Check if user is authenticated with this platform
        const isAuth = await adapter.isAuthenticated(userId)
        if (!isAuth) {
          results[adapter.config.name] = {
            success: false,
            messagesProcessed: 0,
            newMessages: 0,
            errors: [`User not authenticated with ${adapter.config.displayName}`]
          }
          continue
        }

        // Sync messages from this platform
        const result = await adapter.syncMessages(userId)
        results[adapter.config.name] = result
      } catch (error) {
        results[adapter.config.name] = {
          success: false,
          messagesProcessed: 0,
          newMessages: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error']
        }
      }
    }

    return results
  }

  /**
   * Sync messages from a specific platform
   */
  async syncPlatform(userId: string, platformName: string, contactId?: string): Promise<SyncResult> {
    const registry = getPlatformRegistry()
    const adapter = registry.getAdapter(platformName)

    if (!adapter) {
      return {
        success: false,
        messagesProcessed: 0,
        newMessages: 0,
        errors: [`Platform ${platformName} not supported`]
      }
    }

    try {
      const isAuth = await adapter.isAuthenticated(userId)
      if (!isAuth) {
        return {
          success: false,
          messagesProcessed: 0,
          newMessages: 0,
          errors: [`User not authenticated with ${adapter.config.displayName}`]
        }
      }

      return await adapter.syncMessages(userId, contactId)
    } catch (error) {
      return {
        success: false,
        messagesProcessed: 0,
        newMessages: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  /**
   * Convert platform message to normalized database format
   */
  async normalizePlatformMessage(
    platformMessage: PlatformMessage, 
    userId: string, 
    platformName: string
  ): Promise<NormalizedMessage> {
    // Find or create contact for the sender
    const contactId = await this.findOrCreateContact(platformMessage.sender, userId)

    return {
      userId,
      contactId,
      platform: platformName,
      platformMessageId: platformMessage.platformId,
      content: platformMessage.content,
      timestamp: platformMessage.timestamp,
      platformData: {
        threadId: platformMessage.threadId,
        direction: platformMessage.direction,
        subject: platformMessage.metadata.subject as string,
        sender: platformMessage.sender,
        recipients: platformMessage.recipients,
        ...platformMessage.metadata
      }
    }
  }

  /**
   * Enhance a normalized message with AI processing
   */
  async enhanceMessage(message: NormalizedMessage): Promise<EnhancedMessage> {
    try {
      // Only process email messages for now
      if (message.platform.toLowerCase() === 'email') {
        const processed = await processEmailContent(message.content)
        
        return {
          ...message,
          content: processed.cleanedContent,
          platformData: {
            ...message.platformData,
            aiSummary: processed.summary,
            keyPoints: processed.keyPoints,
            actionItems: processed.actionItems,
            urgency: processed.urgency,
            category: processed.category,
            originalContent: processed.originalContent
          }
        }
      }

      // For other platforms, return as-is for now
      return message as EnhancedMessage
    } catch (error) {
      console.error('Failed to enhance message:', error)
      return message as EnhancedMessage
    }
  }

  /**
   * Store normalized message in database
   */
  async storeMessage(message: NormalizedMessage | EnhancedMessage): Promise<string> {
    try {
      // Check if message already exists
      const existing = await prisma.message.findFirst({
        where: {
          userId: message.userId,
          platform: message.platform,
          platformMessageId: message.platformMessageId
        }
      })

      if (existing) {
        return existing.id
      }

      // Create new message
      const created = await prisma.message.create({
        data: {
          userId: message.userId,
          contactId: message.contactId,
          platform: message.platform,
          platformMessageId: message.platformMessageId,
          content: message.content,
          timestamp: message.timestamp,
          platformData: message.platformData as any // Type assertion for Prisma JsonValue
        }
      })

      return created.id
    } catch (error) {
      console.error('Failed to store message:', error)
      throw error
    }
  }

  /**
   * Find or create contact based on platform contact info
   */
  private async findOrCreateContact(platformContact: any, userId: string): Promise<string> {
    try {
      // Try to find existing contact by email first
      if (platformContact.email) {
        const existing = await prisma.contact.findFirst({
          where: {
            userId,
            email: platformContact.email
          }
        })

        if (existing) {
          return existing.id
        }
      }

      // Try to find by name if no email match
      const existingByName = await prisma.contact.findFirst({
        where: {
          userId,
          fullName: platformContact.name
        }
      })

      if (existingByName) {
        // Update with email if we have it
        if (platformContact.email && !existingByName.email) {
          await prisma.contact.update({
            where: { id: existingByName.id },
            data: { email: platformContact.email }
          })
        }
        return existingByName.id
      }

      // Create new contact
      const created = await prisma.contact.create({
        data: {
          userId,
          fullName: platformContact.name,
          email: platformContact.email || null,
          source: 'platform-sync'
        }
      })

      return created.id
    } catch (error) {
      console.error('Failed to find/create contact:', error)
      throw error
    }
  }

  /**
   * Get supported platforms for a user
   */
  async getSupportedPlatforms(userId: string) {
    const registry = getPlatformRegistry()
    const platforms = registry.getSupportedPlatforms()
    
    // Check authentication status for each platform
    const platformStatus = await Promise.all(
      platforms.map(async (platform) => {
        const adapter = registry.getAdapter(platform.name)
        const isAuthenticated = adapter ? await adapter.isAuthenticated(userId) : false
        
        return {
          ...platform,
          isAuthenticated,
          isConfigured: isAuthenticated // For now, same as authenticated
        }
      })
    )

    return platformStatus
  }

  /**
   * Send a reply message via the appropriate platform
   */
  async sendReply(
    userId: string, 
    originalMessage: any, 
    replyContent: string
  ): Promise<boolean> {
    try {
      const registry = getPlatformRegistry()
      const adapter = registry.getAdapter(originalMessage.platform)

      if (!adapter) {
        throw new Error(`Platform ${originalMessage.platform} not supported`)
      }

      const isAuth = await adapter.isAuthenticated(userId)
      if (!isAuth) {
        throw new Error(`User not authenticated with ${adapter.config.displayName}`)
      }

      // Prepare outgoing message
      const outgoingMessage = {
        content: replyContent,
        threadId: originalMessage.platformData?.threadId,
        recipients: [originalMessage.platformData?.sender],
        replyToId: originalMessage.platformMessageId
      }

      // Send via platform adapter
      await adapter.sendMessage(userId, outgoingMessage)
      return true
    } catch (error) {
      console.error('Failed to send reply:', error)
      return false
    }
  }
}

// Convenience function to get the service
export const getUnifiedMessageService = () => UnifiedMessageService.getInstance() 