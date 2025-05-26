import { prisma } from '@/server/db'

export interface PendingMessage {
  id: string
  userId: string
  platform: string
  senderName: string
  senderEmail?: string
  senderHandle?: string
  messageCount: number
  firstMessageDate: Date
  lastMessageDate: Date
  previewContent: string
  fullMessages: Array<{
    id: string
    content: string
    timestamp: Date
    platformMessageId: string
  }>
}

export interface MessageProcessingResult {
  action: 'saved' | 'pending' | 'blocked'
  contactId?: string
  pendingId?: string
  reason: string
}

/**
 * Contact Approval System - Smart Pending Approval Approach
 * 
 * Strategy: Contact-first with intelligent pending system
 * 1. Message from existing contact → Save immediately
 * 2. Message from blacklisted sender → Block
 * 3. Message from unknown sender → Add to pending approval
 * 4. User approves → Create contact + import all pending messages
 * 5. User rejects → Add to blacklist + ignore future messages
 * 
 * DATABASE SCHEMA NEEDED:
 * 
 * ```sql
 * CREATE TABLE pending_contact_approvals (
 *   id TEXT PRIMARY KEY,
 *   user_id TEXT NOT NULL,
 *   platform TEXT NOT NULL,
 *   sender_name TEXT NOT NULL,
 *   sender_email TEXT,
 *   sender_handle TEXT,
 *   message_count INTEGER DEFAULT 1,
 *   first_message_date TIMESTAMP NOT NULL,
 *   last_message_date TIMESTAMP NOT NULL,
 *   preview_content TEXT,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   FOREIGN KEY (user_id) REFERENCES users(id)
 * );
 * 
 * CREATE TABLE pending_messages (
 *   id TEXT PRIMARY KEY,
 *   pending_approval_id TEXT NOT NULL,
 *   content TEXT NOT NULL,
 *   timestamp TIMESTAMP NOT NULL,
 *   platform_message_id TEXT NOT NULL,
 *   FOREIGN KEY (pending_approval_id) REFERENCES pending_contact_approvals(id)
 * );
 * 
 * CREATE TABLE blacklisted_senders (
 *   id TEXT PRIMARY KEY,
 *   user_id TEXT NOT NULL,
 *   platform TEXT NOT NULL,
 *   sender_name TEXT,
 *   sender_email TEXT,
 *   sender_handle TEXT,
 *   reason TEXT,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   FOREIGN KEY (user_id) REFERENCES users(id)
 * );
 * ```
 */
export class ContactApprovalSystem {
  
  /**
   * Process incoming message - main entry point for all platforms
   */
  async processIncomingMessage(message: {
    userId: string
    platform: string
    sender: { name?: string; email?: string; handle?: string }
    content: string
    timestamp: Date
    platformMessageId: string
  }): Promise<MessageProcessingResult> {
    
    // 1. Check if sender is an existing contact
    const existingContact = await this.findExistingContact(message.userId, message.sender)
    if (existingContact) {
      // Save message normally to existing contact
      await this.saveMessageToContact(message, existingContact.id)
      return {
        action: 'saved',
        contactId: existingContact.id,
        reason: `Message saved to existing contact: ${existingContact.fullName}`
      }
    }

    // 2. Check if sender is blacklisted
    const isBlacklisted = await this.isSenderBlacklisted(message.userId, message.sender)
    if (isBlacklisted) {
      console.log(`🚫 Blocked message from blacklisted sender: ${message.sender.name || message.sender.email}`)
      return {
        action: 'blocked',
        reason: 'Sender is blacklisted - message ignored'
      }
    }

    // 3. Add to pending approval
    const pendingId = await this.addToPendingApproval(message)
    console.log(`⏳ Message from new sender added to pending approval: ${message.sender.name || message.sender.email}`)
    
    return {
      action: 'pending',
      pendingId,
      reason: 'New sender - awaiting user approval'
    }
  }

  /**
   * Get all pending message approvals for a user
   */
  async getPendingApprovals(userId: string): Promise<PendingMessage[]> {
    try {
      const pendingApprovals = await prisma.pendingContactApproval.findMany({
        where: { userId },
        orderBy: { lastMessageDate: 'desc' },
        include: {
          messages: {
            orderBy: { timestamp: 'asc' }
          }
        }
      })

      return pendingApprovals.map(approval => ({
        id: approval.id,
        userId: approval.userId,
        platform: approval.platform,
        senderName: approval.senderName,
        senderEmail: approval.senderEmail || undefined,
        senderHandle: approval.senderHandle || undefined,
        messageCount: approval.messageCount,
        firstMessageDate: approval.firstMessageDate,
        lastMessageDate: approval.lastMessageDate,
        previewContent: approval.previewContent || '',
        fullMessages: approval.messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          timestamp: msg.timestamp,
          platformMessageId: msg.platformMessageId
        }))
      }))
    } catch (error) {
      console.error('Error getting pending approvals:', error)
      return []
    }
  }

  /**
   * Handle user decision on pending contact
   */
  async handleApprovalDecision(
    userId: string,
    pendingId: string,
    decision: 'approve' | 'reject'
  ): Promise<{ success: boolean; contactId?: string; messagesImported?: number }> {
    try {
      const pending = await prisma.pendingContactApproval.findUnique({
        where: { id: pendingId, userId },
        include: { messages: true }
      })

      if (!pending) {
        return { success: false }
      }

      if (decision === 'approve') {
        // Create new contact
        const contact = await prisma.contact.create({
          data: {
            userId,
            fullName: pending.senderName,
            email: pending.senderEmail,
            source: pending.platform,
            platformData: {
              [pending.platform + 'Handle']: pending.senderHandle
            }
          }
        })

        // Import all pending messages
        const messageImports = pending.messages.map(msg => ({
          userId,
          contactId: contact.id,
          platform: pending.platform,
          platformMessageId: msg.platformMessageId,
          content: msg.content,
          timestamp: msg.timestamp,
          platformData: {
            fromPendingApproval: true,
            originalSender: {
              name: pending.senderName,
              email: pending.senderEmail,
              handle: pending.senderHandle
            }
          }
        }))

        await prisma.message.createMany({
          data: messageImports,
          skipDuplicates: true
        })

        // Clean up pending approval and messages
        await prisma.pendingMessage.deleteMany({
          where: { pendingApprovalId: pendingId }
        })
        await prisma.pendingContactApproval.delete({
          where: { id: pendingId }
        })

        console.log(`✅ Approved contact: ${pending.senderName}, imported ${pending.messageCount} messages`)
        
        return {
          success: true,
          contactId: contact.id,
          messagesImported: pending.messageCount
        }

      } else {
        // Reject: Add to blacklist
        await prisma.blacklistedSender.create({
          data: {
            userId,
            platform: pending.platform,
            senderName: pending.senderName,
            senderEmail: pending.senderEmail,
            senderHandle: pending.senderHandle,
            reason: 'User rejected contact creation'
          }
        })

        // Clean up pending approval and messages
        await prisma.pendingMessage.deleteMany({
          where: { pendingApprovalId: pendingId }
        })
        await prisma.pendingContactApproval.delete({
          where: { id: pendingId }
        })

        console.log(`🚫 Rejected and blacklisted: ${pending.senderName}`)
        
        return { success: true }
      }

    } catch (error) {
      console.error('Error handling approval decision:', error)
      return { success: false }
    }
  }

  /**
   * Get blacklisted senders for user management
   */
  async getBlacklistedSenders(userId: string) {
    return await prisma.blacklistedSender.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    })
  }

  /**
   * Remove sender from blacklist (user can unblock)
   */
  async unblacklistSender(userId: string, blacklistId: string): Promise<boolean> {
    try {
      await prisma.blacklistedSender.delete({
        where: { id: blacklistId, userId }
      })
      return true
    } catch (error) {
      console.error('Error removing from blacklist:', error)
      return false
    }
  }

  // Private helper methods

  private async findExistingContact(userId: string, sender: {
    name?: string
    email?: string
    handle?: string
  }) {
    const whereConditions = []
    
    if (sender.email) {
      whereConditions.push({ email: sender.email })
    }
    if (sender.name) {
      whereConditions.push({ fullName: sender.name })
    }
    if (sender.handle) {
      whereConditions.push({
        platformData: {
          path: ['slackHandle'],
          equals: sender.handle
        }
      })
    }

    if (whereConditions.length === 0) {
      return null
    }

    return await prisma.contact.findFirst({
      where: {
        userId,
        OR: whereConditions
      },
      select: { id: true, fullName: true }
    })
  }

  private async isSenderBlacklisted(userId: string, sender: {
    name?: string
    email?: string
    handle?: string
  }): Promise<boolean> {
    const whereConditions = []
    
    if (sender.email) {
      whereConditions.push({ senderEmail: sender.email })
    }
    if (sender.handle) {
      whereConditions.push({ senderHandle: sender.handle })
    }
    if (sender.name) {
      whereConditions.push({ senderName: sender.name })
    }

    if (whereConditions.length === 0) {
      return false
    }

    const blacklisted = await prisma.blacklistedSender.findFirst({
      where: {
        userId,
        OR: whereConditions
      }
    })
    
    return !!blacklisted
  }

  private async saveMessageToContact(message: {
    userId: string
    platform: string
    sender: { name?: string; email?: string; handle?: string }
    content: string
    timestamp: Date
    platformMessageId: string
  }, contactId: string) {
    await prisma.message.create({
      data: {
        userId: message.userId,
        contactId,
        platform: message.platform,
        platformMessageId: message.platformMessageId,
        content: message.content,
        timestamp: message.timestamp,
        platformData: {
          sender: message.sender
        }
      }
    })
  }

  private async addToPendingApproval(message: {
    userId: string
    platform: string
    sender: { name?: string; email?: string; handle?: string }
    content: string
    timestamp: Date
    platformMessageId: string
  }): Promise<string> {
    
    // Check if we already have a pending approval for this sender
    const whereConditions = []
    
    if (message.sender.email) {
      whereConditions.push({ senderEmail: message.sender.email })
    }
    if (message.sender.handle) {
      whereConditions.push({ senderHandle: message.sender.handle })
    }

    let existingPending = null
    if (whereConditions.length > 0) {
      existingPending = await prisma.pendingContactApproval.findFirst({
        where: {
          userId: message.userId,
          OR: whereConditions
        }
      })
    }

    if (existingPending) {
      // Add message to existing pending approval
      await prisma.pendingMessage.create({
        data: {
          pendingApprovalId: existingPending.id,
          content: message.content,
          timestamp: message.timestamp,
          platformMessageId: message.platformMessageId
        }
      })

      // Update the pending approval with new message info
      await prisma.pendingContactApproval.update({
        where: { id: existingPending.id },
        data: {
          messageCount: { increment: 1 },
          lastMessageDate: message.timestamp,
          previewContent: message.content.substring(0, 200)
        }
      })

      return existingPending.id
    } else {
      // Create new pending approval
      const pending = await prisma.pendingContactApproval.create({
        data: {
          userId: message.userId,
          platform: message.platform,
          senderName: message.sender.name || 'Unknown Sender',
          senderEmail: message.sender.email,
          senderHandle: message.sender.handle,
          messageCount: 1,
          firstMessageDate: message.timestamp,
          lastMessageDate: message.timestamp,
          previewContent: message.content.substring(0, 200)
        }
      })

      // Add the message
      await prisma.pendingMessage.create({
        data: {
          pendingApprovalId: pending.id,
          content: message.content,
          timestamp: message.timestamp,
          platformMessageId: message.platformMessageId
        }
      })

      return pending.id
    }
  }
}

export const contactApprovalSystem = new ContactApprovalSystem() 