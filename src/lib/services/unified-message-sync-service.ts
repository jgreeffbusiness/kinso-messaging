import { prisma } from '@/server/db'
import { Prisma } from '@prisma/client'
import { contactUnificationService } from './contact-unification-service'
import { SlackAdapter } from '@/lib/platforms/adapters/slack'
import { syncAllUserEmails } from '@/server/services/gmail'
import { syncStateManager } from './sync-state-manager'
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
    console.log(`[UnifiedSync] Starting unified sync for user ${userId}`)
    
    // Set syncing in progress for relevant platforms
    // Check if user has integrations before setting flags
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { slackIntegrations: true, googleAccessToken: true }
    })

    if (user?.slackIntegrations) {
      await syncStateManager.setSyncInProgress(userId, 'slack', true)
    }
    if (user?.googleAccessToken) {
      await syncStateManager.setSyncInProgress(userId, 'gmail', true)
    }

    const results: SyncResult[] = []
    const errors: string[] = []
    let crossPlatformMatches = 0

    try {
      // Step 1: Sync Slack
      if (user?.slackIntegrations) {
        try {
          console.log(`[UnifiedSync] Attempting Slack sync for ${userId}`)
          const slackResult = await this.syncSlackForUser(userId)
          results.push(slackResult)
          // If syncSlackForUser calls markInitialSyncComplete or updateLastSync, 
          // isCurrentlySyncing for slack will be set to false by syncStateManager.
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          errors.push(`Slack sync failed: ${errorMessage}`)
          console.error('[UnifiedSync] Slack sync error:', errorMessage)
        }
      }

      // Step 2: Sync Gmail
      if (user?.googleAccessToken) {
        try {
          console.log(`[UnifiedSync] Attempting Gmail sync for ${userId}`)
          const gmailResult = await this.syncGmailForUser(userId)
          results.push(gmailResult)
          // If syncGmailForUser (via syncAllUserEmails) eventually calls markInitialSyncComplete or updateLastSync
          // for Gmail, isCurrentlySyncing for gmail will be set to false by syncStateManager.
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          errors.push(`Gmail sync failed: ${errorMessage}`)
          console.error('[UnifiedSync] Gmail sync error:', errorMessage)
        }
      }

      // Step 3: Cross-platform contact consolidation
      try {
        crossPlatformMatches = await this.performCrossPlatformMatching(userId)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        errors.push(`Cross-platform matching failed: ${errorMessage}`)
        console.error('[UnifiedSync] Cross-platform matching error:', errorMessage)
      }
    } finally {
      // Always ensure syncing flags are cleared for platforms that were attempted
      if (user?.slackIntegrations) {
        await syncStateManager.setSyncInProgress(userId, 'slack', false)
        console.log(`[UnifiedSync] Slack sync in_progress flag cleared for ${userId}`)
      }
      if (user?.googleAccessToken) {
        await syncStateManager.setSyncInProgress(userId, 'gmail', false)
        console.log(`[UnifiedSync] Gmail sync in_progress flag cleared for ${userId}`)
      }
      console.log(`[UnifiedSync] Unified sync attempt finished for user ${userId}.`)
    }
    
    const totalContactsProcessed = results.reduce((sum, r) => sum + r.contactsProcessed, 0)
    const totalMessagesProcessed = results.reduce((sum, r) => sum + r.messagesProcessed, 0)

    console.log(`[UnifiedSync] Completed for ${userId}: ${totalContactsProcessed} contacts, ${totalMessagesProcessed} messages`)

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
    console.log(`[UnifiedMessageSyncService] Syncing Slack for user ${userId}`)

    const syncCheck = await syncStateManager.shouldDoIncrementalSync(userId, 'slack');
    if (!syncCheck.shouldSync) {
      console.log(`[UnifiedMessageSyncService] Slack sync skipped for user ${userId}: ${syncCheck.reason}`);
      return {
        platform: 'slack',
        contactsProcessed: 0,
        contactsCreated: 0,
        contactsMatched: 0,
        messagesProcessed: 0,
        newMessages: 0,
        errors: []
      };
    }
    console.log(`[UnifiedMessageSyncService] Proceeding with Slack sync for ${userId}. Reason: ${syncCheck.reason}`);
    
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
    let latestMessageTimestampInBatch: Date | undefined = undefined;

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
          const platformData = contact.platformData as Record<string, unknown>
          const slackData = platformData?.slack as { platformContactId?: string } | undefined
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
      console.log(`[UnifiedMessageSyncService] Fetching Slack messages for ${unifiedContactMap.size} known contacts... Using since: ${syncCheck.lastMessageTimestamp || 'None (initial or full sync)'}`)
      const slackMessages = await slackAdapter.fetchMessages(userId, {
        limit: 200, // Reasonable limit for sync
        // Use the last message timestamp from sync state, or fetch broadly if not available (e.g. last 30 days for initial large sync)
        since: syncCheck.lastMessageTimestamp || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) 
      })

      for (const slackMessage of slackMessages) {
        try {
          messagesProcessed++
          
          // Update latestMessageTimestampInBatch
          if (!latestMessageTimestampInBatch || slackMessage.timestamp > latestMessageTimestampInBatch) {
            latestMessageTimestampInBatch = slackMessage.timestamp;
          }
          
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

      // Step 3: Automatically create conversation summaries if we have new messages
      if (newMessages > 0) {
        console.log(`📝 Auto-creating Slack conversation summaries for ${newMessages} new messages...`)
        
        try {
          const conversationResult = await this.createSlackConversationSummaries(userId)
          console.log(`✅ Created ${conversationResult.conversationsCreated} conversation summaries`)
        } catch (convError) {
          console.error('Failed to create conversation summaries:', convError)
          errors.push(`Failed to create conversation summaries: ${convError}`)
        }
      } else if (messagesProcessed > 0) {
        // Also check for existing messages that need conversation summaries
        console.log(`📝 Checking for missing conversation summaries for existing messages...`)
        
        try {
          const conversationResult = await this.createSlackConversationSummaries(userId)
          if (conversationResult.conversationsCreated > 0) {
            console.log(`✅ Created ${conversationResult.conversationsCreated} conversation summaries for existing messages`)
          }
        } catch (convError) {
          console.error('Failed to create conversation summaries for existing messages:', convError)
          errors.push(`Failed to create conversation summaries: ${convError}`)
        }
      }

    } catch (error) {
      errors.push(`Slack sync error: ${error}`)
      // Ensure sync state is updated even on error, perhaps to not set isCurrentlySyncing to false if it's a major crash
      // For now, just rethrow, the finally block in syncAllPlatforms will handle setSyncInProgress(false)
      throw error
    }

    // After processing, update the sync state
    if (syncCheck.reason === 'No sync state found - initial sync needed' || syncCheck.reason === 'Initial sync not complete') {
      // Assuming a larger initial fetch might have happened
      // This needs more robust logic to determine if it was truly the *full* initial sync
      await syncStateManager.markInitialSyncComplete(userId, 'slack', { 
        totalMessages: messagesProcessed, // This might be total ever, or just this batch if truly initial.
        lastMessageTimestamp: latestMessageTimestampInBatch 
      });
    } else if (newMessages > 0 || messagesProcessed > 0) { // update if any messages were processed, even if 0 new added to db
      await syncStateManager.updateLastSync(userId, 'slack', newMessages, latestMessageTimestampInBatch);
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
   * Sync Gmail platform for a user
   */
  private async syncGmailForUser(userId: string): Promise<SyncResult> {
    console.log(`[UnifiedMessageSyncService] Syncing Gmail for user ${userId}`)

    const syncCheck = await syncStateManager.shouldDoIncrementalSync(userId, 'gmail');
    if (!syncCheck.shouldSync) {
      console.log(`[UnifiedMessageSyncService] Gmail sync skipped for user ${userId}: ${syncCheck.reason}`);
      return {
        platform: 'gmail',
        contactsProcessed: 0,
        contactsCreated: 0,
        contactsMatched: 0,
        messagesProcessed: 0,
        newMessages: 0,
        errors: []
      };
    }
    console.log(`[UnifiedMessageSyncService] Proceeding with Gmail sync for ${userId}. Reason: ${syncCheck.reason}. Using since: ${syncCheck.lastMessageTimestamp || 'None (initial or full sync)'}`);
    
    try {
      // Use the existing Gmail sync service, passing the lastMessageTimestamp
      const result = await syncAllUserEmails(userId, syncCheck.lastMessageTimestamp);
      
      if (!result.success && (!result.detailedResults || result.detailedResults.length === 0)) {
        // If overall success is false and there are no detailed results, it might be a token error or similar general failure.
        throw new Error(result.error || 'Gmail sync failed at service level with no detailed results');
      }

      // Determine the latest message timestamp from this batch
      let latestMessageTimestampInBatch: Date | undefined = undefined;
      if (result.allFetchedGmailMessages && result.allFetchedGmailMessages.length > 0) {
        for (const gmailMsg of result.allFetchedGmailMessages) {
          if (gmailMsg.internalDate) {
            const currentMsgDate = new Date(parseInt(gmailMsg.internalDate, 10));
            if (!latestMessageTimestampInBatch || currentMsgDate > latestMessageTimestampInBatch) {
              latestMessageTimestampInBatch = currentMsgDate;
            }
          }
        }
      }
      
      const messagesProcessedInThisRun = result.allFetchedGmailMessages?.length || 0;
      // This `newMessages` count from syncAllUserEmails might represent all messages fetched in this run,
      // not necessarily messages *new* to the Prisma DB, as `syncAllUserEmails` doesn't check Prisma itself.
      // The actual number of *newly inserted* messages would be determined by UnifiedMessageService.storeMessage.
      // For sync state, `messagesProcessedInThisRun` (count of API fetched items) and `latestMessageTimestampInBatch` are key.
      // We'll rely on `storeMessage` to increment a counter if we want true `newMessagesAddedToDb`.
      // For now, let's consider messages fetched from API as potentially new for the sake of `updateLastSync`.
      const pseudoNewMessages = messagesProcessedInThisRun; 

      // Update sync state
      // Note: `result.detailedResults` gives per-contact counts, `result.allFetchedGmailMessages.length` is total API messages fetched.
      // The actual number of new messages inserted into *our* DB happens via storeMessage, which is not directly called here.
      // We need to refine how `newMessages` is determined if it needs to be exact DB inserts.
      if (syncCheck.reason === 'No sync state found - initial sync needed' || syncCheck.reason === 'Initial sync not complete') {
        await syncStateManager.markInitialSyncComplete(userId, 'gmail', {
          totalMessages: messagesProcessedInThisRun, // This is messages *fetched* in this batch
          lastMessageTimestamp: latestMessageTimestampInBatch
        });
      } else if (pseudoNewMessages > 0 || messagesProcessedInThisRun > 0) { 
        await syncStateManager.updateLastSync(userId, 'gmail', pseudoNewMessages, latestMessageTimestampInBatch);
      }
      
      const errorsFromDetailedResults = result.detailedResults?.filter(dr => !dr.success && dr.error).map(dr => `Contact ${dr.contactId}: ${dr.error}`) || [];
      if (result.error && !result.success) { // Add general error if present and overall not successful
        errorsFromDetailedResults.push(result.error);
      }

      return {
        platform: 'gmail',
        contactsProcessed: result.detailedResults?.length || 0,
        contactsCreated: 0, // Gmail sync works with existing contacts, creation happens elsewhere
        contactsMatched: result.detailedResults?.filter(dr => dr.success).length || 0,
        messagesProcessed: messagesProcessedInThisRun,
        newMessages: pseudoNewMessages, // This is messages fetched in this run
        errors: errorsFromDetailedResults
      }
      
    } catch (error: any) {
      console.error('[UnifiedMessageSyncService] Gmail sync error:', error);
      // Consider how to update sync state on error - e.g., set isCurrentlySyncing to false
      throw error; // Rethrow to be caught by syncAllPlatforms finally block
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

  /**
   * Manually merge duplicate contacts (useful for cleaning up existing duplicates)
   */
  async mergeDuplicateContacts(userId: string): Promise<{
    merged: number
    errors: string[]
  }> {
    console.log(`Starting manual duplicate contact merge for user ${userId}`)
    
    let merged = 0
    const errors: string[] = []
    
    try {
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

      // Also group by similar names (for contacts without emails)
      const nameGroups = new Map<string, typeof contacts>()
      contacts.forEach(contact => {
        if (!contact.email && contact.fullName) {
          const normalizedName = contact.fullName.toLowerCase().trim()
          if (!nameGroups.has(normalizedName)) {
            nameGroups.set(normalizedName, [])
          }
          nameGroups.get(normalizedName)!.push(contact)
        }
      })

      // Merge contacts with same email
      for (const [email, contactGroup] of emailGroups) {
        if (contactGroup.length > 1) {
          console.log(`Found ${contactGroup.length} contacts with email ${email}`)
          try {
            await this.mergeContacts(contactGroup, userId)
            merged += contactGroup.length - 1 // All but one were merged
            console.log(`Merged ${contactGroup.length - 1} duplicate contacts for ${email}`)
          } catch (error) {
            const errorMsg = `Failed to merge contacts for email ${email}: ${error}`
            errors.push(errorMsg)
            console.error(errorMsg)
          }
        }
      }

      // Merge contacts with same name (no email)
      for (const [name, contactGroup] of nameGroups) {
        if (contactGroup.length > 1) {
          console.log(`Found ${contactGroup.length} contacts with name "${name}" (no email)`)
          try {
            await this.mergeContacts(contactGroup, userId)
            merged += contactGroup.length - 1
            console.log(`Merged ${contactGroup.length - 1} duplicate contacts for "${name}"`)
          } catch (error) {
            const errorMsg = `Failed to merge contacts for name "${name}": ${error}`
            errors.push(errorMsg)
            console.error(errorMsg)
          }
        }
      }

      console.log(`Manual duplicate merge completed: ${merged} contacts merged, ${errors.length} errors`)

    } catch (error) {
      const errorMsg = `Manual duplicate merge failed: ${error}`
      errors.push(errorMsg)
      console.error(errorMsg)
    }

    return { merged, errors }
  }

  /**
   * Get a list of potential duplicate contacts for review
   */
  async findPotentialDuplicates(userId: string): Promise<{
    emailDuplicates: Array<{
      email: string
      contacts: Array<{ id: string, fullName: string, platforms: string[] }>
    }>
    nameDuplicates: Array<{
      name: string  
      contacts: Array<{ id: string, email: string | null, platforms: string[] }>
    }>
  }> {
    const contacts = await prisma.contact.findMany({
      where: { userId }
    })

    const emailDuplicates: any[] = []
    const nameDuplicates: any[] = []

    // Group by email
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

    // Find email duplicates
    for (const [email, contactGroup] of emailGroups) {
      if (contactGroup.length > 1) {
        emailDuplicates.push({
          email,
          contacts: contactGroup.map(contact => ({
            id: contact.id,
            fullName: contact.fullName,
            platforms: this.extractPlatformsFromContact(contact)
          }))
        })
      }
    }

    // Group by name (for contacts without email)
    const nameGroups = new Map<string, typeof contacts>()
    contacts.forEach(contact => {
      if (!contact.email && contact.fullName) {
        const normalizedName = contact.fullName.toLowerCase().trim()
        if (!nameGroups.has(normalizedName)) {
          nameGroups.set(normalizedName, [])
        }
        nameGroups.get(normalizedName)!.push(contact)
      }
    })

    // Find name duplicates
    for (const [name, contactGroup] of nameGroups) {
      if (contactGroup.length > 1) {
        nameDuplicates.push({
          name,
          contacts: contactGroup.map(contact => ({
            id: contact.id,
            email: contact.email,
            platforms: this.extractPlatformsFromContact(contact)
          }))
        })
      }
    }

    return { emailDuplicates, nameDuplicates }
  }

  private extractPlatformsFromContact(contact: any): string[] {
    const platformData = (contact.platformData as Record<string, unknown>) || {}
    return Object.keys(platformData)
  }

  /**
   * Automatically create Slack conversation summaries for a user
   */
  private async createSlackConversationSummaries(userId: string): Promise<{
    conversationsCreated: number
    totalContacts: number
    errors: string[]
  }> {
    const { analyzeEmailThread } = await import('@/lib/thread-processor')
    
    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, slackUserId: true, name: true }
    })

    if (!user?.email) {
      throw new Error('User not found')
    }

    // Get all Slack messages for this user
    const messages = await prisma.message.findMany({
      where: {
        userId,
        platform: 'slack'
      },
      include: {
        contact: {
          select: {
            id: true,
            fullName: true,
            email: true,
            platformData: true
          }
        }
      },
      orderBy: { timestamp: 'asc' }
    })

    if (messages.length === 0) {
      return { conversationsCreated: 0, totalContacts: 0, errors: [] }
    }

    // Group messages by contact to create conversations
    const conversationsMap = new Map<string, typeof messages>()
    
    for (const message of messages) {
      if (!message.contact) continue
      
      const contact = message.contact;
      const platformData = (contact.platformData as Record<string, unknown>) || {};
      const slackData = platformData.slack as { platformContactId?: string; [key: string]: any } | undefined;
      
      // More precise self-conversation check: primarily rely on matching Slack User IDs.
      // Only consider name match as a weaker secondary check if Slack IDs aren't definitive.
      let isSelfConversation = false;
      if (user.slackUserId && slackData?.platformContactId) {
        isSelfConversation = slackData.platformContactId === user.slackUserId;
      } else if (user.name && contact.fullName === user.name && platformData.slack) {
        // Fallback: if Slack IDs are missing on either side, but names match and it's a known Slack contact.
        // This is less reliable and might need to be even stricter or removed if it causes issues.
        console.warn(`Self-conversation check for ${contact.fullName} falling back to name match due to missing Slack IDs.`);
        isSelfConversation = true; 
      }
      
      if (isSelfConversation) {
        console.log(`⚠️  Skipping self-conversation with ${contact.fullName} (Contact SlackID: ${slackData?.platformContactId}, User SlackID: ${user.slackUserId})`);
        continue;
      }
      
      const conversationKey = `slack_conversation_${message.contactId}`;
      
      if (!conversationsMap.has(conversationKey)) {
        conversationsMap.set(conversationKey, [])
      }
      conversationsMap.get(conversationKey)!.push(message)
    }

    let conversationsCreated = 0
    const errors: string[] = []

    // Create conversation summaries for each contact
    for (const [conversationKey, conversationMessages] of conversationsMap) {
      if (conversationMessages.length === 0) continue

      const contact = conversationMessages[0].contact!
      
      // Skip if we already have a conversation summary for this contact
      const existingSummary = await prisma.message.findFirst({
        where: {
          userId,
          contactId: contact.id,
          platform: 'slack_thread_summary'
        }
      })

      if (existingSummary) {
        continue // Skip existing summaries
      }

      try {
        // Sort messages chronologically
        const sortedMessages = conversationMessages.sort((a, b) => 
          a.timestamp.getTime() - b.timestamp.getTime()
        )

        // Convert to thread processor format
        const formattedMessages = sortedMessages.map(msg => {
          let from = user.email || 'unknown@example.com'
          let isFromUser = true
          
          if (msg.platformData && typeof msg.platformData === 'object') {
            const data = msg.platformData as Record<string, unknown>
            const senderId = (data.sender as string) || (data.user as string)
            
            isFromUser = senderId === user.slackUserId || 
                        from.toLowerCase().includes((user.email || '').toLowerCase())
            
            from = senderId || from
          }

          return {
            id: msg.platformMessageId,
            from: from,
            to: [contact.email || 'slack-contact'],
            subject: `Slack conversation with ${contact.fullName}`,
            content: msg.content,
            timestamp: msg.timestamp,
            direction: isFromUser ? 'outbound' as const : 'inbound' as const,
            isFromUser
          }
        })

        // Analyze the conversation with AI
        const analysis = await analyzeEmailThread(
          formattedMessages,
          user.email,
          contact.fullName
        )

        // Create conversation summary message
        await prisma.message.create({
          data: {
            userId,
            contactId: contact.id,
            platform: 'slack_thread_summary',
            platformMessageId: `slack_thread_summary_${conversationKey}`,
            content: analysis.summary,
            timestamp: new Date(),
            platformData: {
              isThreadSummary: true,
              threadId: conversationKey,
              analysis: JSON.parse(JSON.stringify(analysis)),
              messageCount: conversationMessages.length,
              platform: 'slack'
            }
          }
        })

        conversationsCreated++
        console.log(`Created conversation summary for ${contact.fullName} (${conversationMessages.length} messages)`)

      } catch (error) {
        const errorMsg = `Failed to create conversation for ${contact.fullName}: ${error}`
        errors.push(errorMsg)
        console.error(errorMsg)
      }
    }

    return {
      conversationsCreated,
      totalContacts: conversationsMap.size,
      errors
    }
  }
}

// Singleton instance
export const unifiedMessageSyncService = new UnifiedMessageSyncService() 