import { getPlatformRegistry } from '@/lib/platforms'
import { prisma } from '@/server/db'
import { processEmailContent } from '@/lib/email-processor'
import type { 
  PlatformMessage, 
  NormalizedMessage, 
  EnhancedMessage,
  PlatformSyncResult 
} from '@/lib/platforms/types'
import { supabaseAdmin } from '@/lib/supabaseClient'
import { getEmbedding, chunkText } from '@/lib/ai/embeddingUtils'

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
  async syncAllPlatforms(userId: string): Promise<Record<string, PlatformSyncResult>> {
    const registry = getPlatformRegistry()
    const results: Record<string, PlatformSyncResult> = {}

    for (const adapter of registry.getAllAdapters()) {
      try {
        console.log(`Syncing ${adapter.config.displayName} for user ${userId}`)
        
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
  async syncPlatform(userId: string, platformName: string, contactId?: string): Promise<PlatformSyncResult> {
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
        subject: platformMessage.metadata?.subject as string,
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
   * Store normalized message in database and trigger embedding
   */
  async storeMessage(message: NormalizedMessage | EnhancedMessage): Promise<string> {
    let createdMessageId: string;
    try {
      const existing = await prisma.message.findFirst({
        where: {
          userId: message.userId,
          platform: message.platform,
          platformMessageId: message.platformMessageId
        }
      })

      if (existing) {
        createdMessageId = existing.id;
        // Optionally, we could decide to re-embed if content might have changed, but for now, skip if exists.
        // console.log(`[UnifiedMessageService] Message ${existing.id} already exists. Skipping store & embedding.`);
        // return existing.id; 
              // Inside storeMessage, after `createdMessageId` is set:

        // Asynchronous embedding logic
        if (!supabaseAdmin) { // CHECK 1
          console.warn("[UnifiedMessageService] Supabase admin client NOT configured. Message vector cannot be stored.");
        } else if (!createdMessageId) { // CHECK 2
          console.warn("[UnifiedMessageService] Message ID NOT available. Embedding trigger aborted.");
        } else { // PROCEED WITH EMBEDDING
          console.log(`[UnifiedMessageService] Attempting to embed message ID: ${createdMessageId} for user: ${message.userId}, platform: ${message.platform}`); // LOGGING
          
          let textToEmbed = message.content;
          const subject = message.platformData?.subject as string | undefined;
          if (subject && typeof subject === 'string' && subject.trim() !== '') {
            textToEmbed = `${subject}\n\n${message.content}`;
          }
          console.log(`[UnifiedMessageService] Text to embed for ${createdMessageId} (length ${textToEmbed.length}): "${textToEmbed.substring(0, 100)}..."`); // LOGGING

          const chunks = chunkText({ text: textToEmbed });
          console.log(`[UnifiedMessageService] Generated ${chunks.length} chunks for message ID: ${createdMessageId}.`); // LOGGING

          if (chunks.length > 0) {
            chunks.forEach(async (chunk, index) => {
              console.log(`[UnifiedMessageService] Processing chunk ${index + 1}/${chunks.length} for message ${createdMessageId}.`); // LOGGING
              const embedding = await getEmbedding(chunk, message.userId); // Calls embeddingUtils

              if (embedding) { // CHECK 3: Was embedding successful?
                console.log(`[UnifiedMessageService] Embedding successful for chunk ${index + 1} of message ${createdMessageId}.`); // LOGGING
                try {
                  const { error: vectorError } = await supabaseAdmin
                    .from('platform_message_embeddings')
                    .insert({
                      message_id: createdMessageId, 
                      user_id: message.userId,
                      contact_id: message.contactId || null, 
                      embedding: embedding,
                      content_chunk: chunk,
                      chunk_index: index,
                    });
                  if (vectorError) { // CHECK 4: Supabase insert error?
                    console.error(`[UnifiedMessageService] Supabase vector insert ERROR for message ${createdMessageId}, chunk ${index + 1}:`, vectorError.message, vectorError); // DETAILED ERROR LOG
                  } else { // CHECK 5: Supabase insert success!
                    console.log(`[UnifiedMessageService] Vector successfully stored in Supabase for message ${createdMessageId}, chunk ${index + 1}.`); // SUCCESS LOG
                  }
                } catch (supaInsertError: unknown) { // CHECK 6: Exception during insert?
                  const e = supaInsertError as Error;
                  console.error(`[UnifiedMessageService] Supabase vector insert EXCEPTION for message ${createdMessageId}, chunk ${index + 1}:`, e.message, e.stack); // DETAILED EXCEPTION LOG
                }
              } else { // Embedding failed (returned null)
                console.warn(`[UnifiedMessageService] Embedding FAILED (returned null) for chunk ${index + 1} of message ${createdMessageId}. Not storing in vector DB.`); // LOGGING
              }
            });
          } else { // No chunks generated
              console.warn(`[UnifiedMessageService] No chunks generated for message ID: ${createdMessageId}. Original content might be empty or too short to chunk effectively.`); // LOGGING
          }
        } 
        return createdMessageId;
      } else {
        const created = await prisma.message.create({
          data: {
            userId: message.userId,
            contactId: message.contactId,
            platform: message.platform,
            platformMessageId: message.platformMessageId,
            content: message.content, // This is the content that will be embedded
            timestamp: message.timestamp,
            platformData: message.platformData as any 
          }
        });
        createdMessageId = created.id;
      }

      // Asynchronous embedding logic after message is confirmed in DB (created or found)
      if (supabaseAdmin && createdMessageId) {
        // Determine text to embed
        let textToEmbed = message.content;
        const subject = message.platformData?.subject as string | undefined;
        if (subject && typeof subject === 'string' && subject.trim() !== '') {
          textToEmbed = `${subject}\n\n${message.content}`;
        }

        const chunks = chunkText({ text: textToEmbed }); // Uses default chunking params from embeddingUtils

        if (chunks.length > 0) {
          console.log(`[UnifiedMessageService] Processing ${chunks.length} chunks for message ID: ${createdMessageId}`);
          chunks.forEach(async (chunk, index) => {
            const embedding = await getEmbedding(chunk, message.userId);
            if (embedding) {
              try {
                const { error: vectorError } = await supabaseAdmin
                  .from('platform_message_embeddings')
                  .insert({
                    message_id: createdMessageId, 
                    user_id: message.userId,
                    contact_id: message.contactId || null, // Ensure contact_id is present or null
                    embedding: embedding,
                    content_chunk: chunk,
                    chunk_index: index,
                    // token_count: can be added if getEmbedding returns it or estimated
                  });
                if (vectorError) {
                  console.error(`[UnifiedMessageService] Supabase vector insert error for message ${createdMessageId}, chunk ${index}:`, vectorError.message);
                } else {
                  // console.log(`[UnifiedMessageService] Vector stored for message ${createdMessageId}, chunk ${index}`);
                }
              } catch (supaInsertError: unknown) {
                console.error(`[UnifiedMessageService] Exception inserting vector for message ${createdMessageId}, chunk ${index}:`, (supaInsertError as Error).message);
              }
            }
          });
        } else {
            console.warn(`[UnifiedMessageService] No chunks generated for message ID: ${createdMessageId}. Original content might be empty or too short.`);
        }
      } else {
        if (!supabaseAdmin) console.warn("[UnifiedMessageService] Supabase admin client not configured. Message vector not stored.");
      }
      return createdMessageId; // Return the ID of the created or existing message

    } catch (error) {
      console.error('Failed to store message or trigger embedding:', error);
      // If createdMessageId was set before the error in embedding part, it might still be valid depending on desired behavior
      // For now, rethrow to indicate failure in the broader process.
      throw error;
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