import { prisma } from '@/server/db'
import { Prisma } from '@prisma/client'
import { contactUnificationService } from './contact-unification-service'
import { syncStateManager } from './sync-state-manager'
import { SlackAdapter } from '@/lib/platforms/adapters/slack'
// Import other platform adapters as they're created
// import { GmailAdapter } from '@/lib/platforms/adapters/gmail'

interface Contact {
  id: string
  userId: string
  fullName: string
  email: string | null
  photoUrl: string | null
  platformData: unknown
  createdAt: Date
  updatedAt: Date
}

interface SyncResult {
  platform: string
  contactsProcessed: number
  contactsCreated: number
  contactsMatched: number
  messagesProcessed: number
  newMessages: number
  errors: string[]
}

interface UnifiedSyncResult {
  platforms: SyncResult[]
  totalContactsProcessed: number
  totalMessagesProcessed: number
  crossPlatformMatches: number
  errors: string[]
}

export class UnifiedMessageSyncService {
  
  /**
   * Sync all platforms for a user
   */
  async syncAllPlatforms(userId: string): Promise<UnifiedSyncResult> {
    console.log(`Starting unified sync for user ${userId}`)
    
    const results: SyncResult[] = []
    const errors: string[] = []
    let crossPlatformMatches = 0

    // Step 1: Sync Slack
    try {
      const slackResult = await this.syncSlackForUser(userId)
      results.push(slackResult)
    } catch (error) {
      errors.push(`Slack sync failed: ${error}`)
      console.error('Slack sync error:', error)
    }

    // Step 2: Sync Gmail (when implemented)
    // try {
    //   const gmailResult = await this.syncGmailForUser(userId)
    //   results.push(gmailResult)
    // } catch (error) {
    //   errors.push(`Gmail sync failed: ${error}`)
    // }

    // Step 3: Cross-platform contact consolidation
    try {
      crossPlatformMatches = await this.performCrossPlatformMatching(userId)
    } catch (error) {
      errors.push(`Cross-platform matching failed: ${error}`)
    }

    const totalContactsProcessed = results.reduce((sum, r) => sum + r.contactsProcessed, 0)
    const totalMessagesProcessed = results.reduce((sum, r) => sum + r.messagesProcessed, 0)

    console.log(`Unified sync completed for user ${userId}: ${totalContactsProcessed} contacts, ${totalMessagesProcessed} messages`)

    return {
      platforms: results,
      totalContactsProcessed,
      totalMessagesProcessed,
      crossPlatformMatches,
      errors
    }
  }

  /**
   * Sync Slack platform for a user
   */
  private async syncSlackForUser(userId: string): Promise<SyncResult> {
    console.log(`Syncing Slack for user ${userId}`)
    
    const slackAdapter = new SlackAdapter()
    
    // Check if user has Slack connected
    const isAuthenticated = await slackAdapter.isAuthenticated(userId)
    if (!isAuthenticated) {
      throw new Error('User not authenticated with Slack')
    }

    let contactsProcessed = 0
    let contactsCreated = 0
    let contactsMatched = 0
    let messagesProcessed = 0
    let newMessages = 0
    const errors: string[] = []

    try {
      // Check if we already have Slack contacts for this user
      const existingSlackContacts = await prisma.contact.findMany({
        where: { 
          userId,
          platformData: {
            path: ['slack'],
            not: Prisma.DbNull
          }
        },
        select: { id: true, platformData: true }
      })

      const unifiedContactMap = new Map<string, string>() // slackUserId -> unifiedContactId

      // If we have existing contacts, use them instead of fetching again
      if (existingSlackContacts.length > 0) {
        console.log(`Found ${existingSlackContacts.length} existing Slack contacts, skipping contact fetch`)
        
        // Build contact mapping from existing data
        existingSlackContacts.forEach(contact => {
          const platformData = contact.platformData as Record<string, any>
          const slackData = platformData?.slack
          if (slackData?.platformContactId) {
            unifiedContactMap.set(slackData.platformContactId, contact.id)
          }
        })

        contactsProcessed = existingSlackContacts.length
        contactsMatched = existingSlackContacts.length
      } else {
        // Only fetch contacts if we don't have any yet
        console.log('No existing Slack contacts found, fetching from API...')
        const slackContacts = await slackAdapter.fetchContacts(userId)
        
        for (const slackContact of slackContacts) {
          try {
            contactsProcessed++
            
            // Use contact unification service to find or create unified contact
            const unifiedContactId = await contactUnificationService.unifyContact(
              slackContact, 
              'slack', 
              userId
            )
            
            // Track the mapping
            unifiedContactMap.set(slackContact.id, unifiedContactId)
            
            // Check if this was a new contact or matched existing
            const existingContact = await prisma.contact.findUnique({
              where: { id: unifiedContactId }
            })
            
            if (existingContact) {
              const platformData = (existingContact.platformData as Record<string, unknown>) || {}
              if (platformData.slack) {
                contactsMatched++
              } else {
                contactsCreated++
              }
            }
            
          } catch (error) {
            errors.push(`Failed to process Slack contact ${slackContact.id}: ${error}`)
            console.error(`Contact processing error:`, error)
          }
        }
      }

      // Step 2: Focus on syncing messages from known contacts
      console.log(`Fetching Slack messages for ${unifiedContactMap.size} known contacts...`)
      const slackMessages = await slackAdapter.fetchMessages(userId, {
        limit: 200, // Reasonable limit for sync
        since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
      })

      for (const slackMessage of slackMessages) {
        try {
          messagesProcessed++
          
          // Find the unified contact for this message sender
          const senderSlackId = slackMessage.sender.id
          const unifiedContactId = unifiedContactMap.get(senderSlackId)
          
          if (!unifiedContactId) {
            // Skip messages from unknown users (they might be bots or new users)
            console.log(`Skipping message from unknown Slack user: ${senderSlackId}`)
            continue
          }

          // Check if message already exists
          const existingMessage = await prisma.message.findFirst({
            where: {
              userId,
              platformMessageId: slackMessage.platformId,
              platform: 'slack'
            }
          })

          if (existingMessage) {
            continue // Skip existing messages
          }

          // Create new message
          await prisma.message.create({
            data: {
              userId,
              contactId: unifiedContactId,
              platform: 'slack',
              platformMessageId: slackMessage.platformId,
              content: slackMessage.content,
              timestamp: slackMessage.timestamp,
              platformData: {
                threadId: slackMessage.threadId,
                sender: slackMessage.sender,
                recipients: slackMessage.recipients,
                metadata: slackMessage.metadata || {},
                direction: slackMessage.direction
              } as Prisma.InputJsonValue
            }
          })

          newMessages++
          
        } catch (error) {
          errors.push(`Failed to process Slack message ${slackMessage.id}: ${error}`)
          console.error(`Message processing error:`, error)
        }
      }

    } catch (error) {
      errors.push(`Slack sync error: ${error}`)
      throw error
    }

    return {
      platform: 'slack',
      contactsProcessed,
      contactsCreated,
      contactsMatched,
      messagesProcessed,
      newMessages,
      errors
    }
  }

  /**
   * Perform cross-platform contact matching to consolidate duplicates
   */
  private async performCrossPlatformMatching(userId: string): Promise<number> {
    console.log(`Performing cross-platform contact matching for user ${userId}`)
    
    let matchesFound = 0
    
    // Get all contacts for the user
    const contacts = await prisma.contact.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' } // Process older contacts first
    })

    // Group contacts by email for easy matching
    const emailGroups = new Map<string, typeof contacts>()
    
    contacts.forEach(contact => {
      if (contact.email) {
        const email = contact.email.toLowerCase()
        if (!emailGroups.has(email)) {
          emailGroups.set(email, [])
        }
        emailGroups.get(email)!.push(contact)
      }
    })

    // Merge contacts with same email
    for (const [email, contactGroup] of emailGroups) {
      if (contactGroup.length > 1) {
        try {
          await this.mergeContacts(contactGroup, userId)
          matchesFound += contactGroup.length - 1 // All but one were merged
        } catch (error) {
          console.error(`Failed to merge contacts for email ${email}:`, error)
        }
      }
    }

    console.log(`Cross-platform matching completed: ${matchesFound} contacts merged`)
    return matchesFound
  }

  /**
   * Merge multiple contacts into one unified contact
   */
  private async mergeContacts(contacts: Contact[], userId: string): Promise<void> {
    if (contacts.length <= 1) return

    // Use the first contact as the primary one
    const primaryContact = contacts[0]
    const contactsToMerge = contacts.slice(1)

    console.log(`Merging ${contactsToMerge.length} contacts into ${primaryContact.id}`)

    // Combine platform data from all contacts
    const combinedPlatformData = { ...(primaryContact.platformData as Record<string, unknown>) }
    
    for (const contact of contactsToMerge) {
      const platformData = (contact.platformData as Record<string, unknown>) || {}
      Object.assign(combinedPlatformData, platformData)
    }

    // Update the primary contact with combined data
    await prisma.contact.update({
      where: { id: primaryContact.id },
      data: {
        platformData: combinedPlatformData,
        // Update with best available data
        fullName: this.getBestName(contacts),
        photoUrl: this.getBestPhoto(contacts)
      }
    })

    // Move all messages from merged contacts to primary contact
    for (const contact of contactsToMerge) {
      await prisma.message.updateMany({
        where: {
          userId,
          contactId: contact.id
        },
        data: {
          contactId: primaryContact.id
        }
      })
    }

    // Delete the merged contacts
    await prisma.contact.deleteMany({
      where: {
        id: { in: contactsToMerge.map(c => c.id) },
        userId
      }
    })
  }

  /**
   * Get the best name from a group of contacts
   */
  private getBestName(contacts: Contact[]): string {
    // Prefer the longest name that's not just an email
    return contacts
      .map(c => c.fullName)
      .filter(name => name && !name.includes('@'))
      .sort((a, b) => b.length - a.length)[0] || contacts[0].fullName
  }

  /**
   * Get the best photo from a group of contacts
   */
  private getBestPhoto(contacts: Contact[]): string | null {
    // Prefer any photo that exists
    return contacts.find(c => c.photoUrl)?.photoUrl || null
  }

  /**
   * Get sync status for a user across all platforms
   */
  async getSyncStatus(userId: string) {
    const contacts = await prisma.contact.findMany({
      where: { userId }
    })

    const messages = await prisma.message.findMany({
      where: { userId },
      select: { platform: true, timestamp: true, createdAt: true }
    })

    // Group by platform
    const platformStats = {
      slack: {
        contacts: contacts.filter(c => {
          const platformData = c.platformData as Record<string, unknown>
          return platformData?.slack
        }).length,
        messages: messages.filter(m => m.platform === 'slack').length,
        lastSync: this.getLastSyncTime(messages.filter(m => m.platform === 'slack'))
      },
      gmail: {
        contacts: contacts.filter(c => {
          const platformData = c.platformData as Record<string, unknown>
          return platformData?.gmail || platformData?.email
        }).length,
        messages: messages.filter(m => m.platform === 'email' || m.platform === 'gmail').length,
        lastSync: this.getLastSyncTime(messages.filter(m => m.platform === 'email' || m.platform === 'gmail'))
      }
    }

    return {
      totalContacts: contacts.length,
      totalMessages: messages.length,
      platforms: platformStats,
      crossPlatformContacts: contacts.filter(c => {
        const platformData = c.platformData as Record<string, unknown>
        return Object.keys(platformData || {}).length > 1
      }).length
    }
  }

  private getLastSyncTime(messages: { timestamp?: Date; createdAt: Date }[]): Date | null {
    if (messages.length === 0) return null
    
    // Use timestamp if available, otherwise fall back to createdAt
    const sortedMessages = messages.sort((a, b) => {
      const timeA = a.timestamp || a.createdAt
      const timeB = b.timestamp || b.createdAt
      return timeB.getTime() - timeA.getTime()
    })
    
    return sortedMessages[0].timestamp || sortedMessages[0].createdAt
  }

  /**
   * Refresh Slack contacts for a user (call this only when needed)
   */
  async refreshSlackContacts(userId: string): Promise<{
    contactsProcessed: number
    contactsCreated: number
    contactsMatched: number
    errors: string[]
  }> {
    console.log(`Refreshing Slack contacts for user ${userId}`)
    
    const slackAdapter = new SlackAdapter()
    
    // Check if user has Slack connected
    const isAuthenticated = await slackAdapter.isAuthenticated(userId)
    if (!isAuthenticated) {
      throw new Error('User not authenticated with Slack')
    }

    let contactsProcessed = 0
    let contactsCreated = 0
    let contactsMatched = 0
    const errors: string[] = []

    try {
      console.log('Fetching fresh Slack contacts from API...')
      const slackContacts = await slackAdapter.fetchContacts(userId)
      
      for (const slackContact of slackContacts) {
        try {
          contactsProcessed++
          
          // Use contact unification service to find or create unified contact
          const unifiedContactId = await contactUnificationService.unifyContact(
            slackContact, 
            'slack', 
            userId
          )
          
          // Check if this was a new contact or matched existing
          const existingContact = await prisma.contact.findUnique({
            where: { id: unifiedContactId }
          })
          
          if (existingContact) {
            const platformData = (existingContact.platformData as Record<string, unknown>) || {}
            if (platformData.slack) {
              contactsMatched++
            } else {
              contactsCreated++
            }
          }
          
        } catch (error) {
          errors.push(`Failed to process Slack contact ${slackContact.id}: ${error}`)
          console.error(`Contact processing error:`, error)
        }
      }

      console.log(`Contact refresh completed: ${contactsProcessed} processed, ${contactsCreated} created, ${contactsMatched} matched`)

    } catch (error) {
      errors.push(`Slack contact refresh error: ${error}`)
      throw error
    }

    return {
      contactsProcessed,
      contactsCreated,
      contactsMatched,
      errors
    }
  }
}

// Singleton instance
export const unifiedMessageSyncService = new UnifiedMessageSyncService() 