import { 
  PlatformAdapter, 
  PlatformConfig, 
  PlatformMessage, 
  PlatformContact, 
  PlatformAuthResult,
  FetchOptions,
  OutgoingMessage,
  SyncResult
} from '../types'
import { syncContactEmails, syncAllUserEmails } from '@server/services/gmail'

export class EmailAdapter implements PlatformAdapter {
  config: PlatformConfig = {
    name: 'email',
    displayName: 'Email',
    icon: '📧',
    color: 'blue',
    authType: 'oauth',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    endpoints: {
      auth: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      api: 'https://gmail.googleapis.com/gmail/v1'
    }
  }

  async authenticate(userId: string): Promise<PlatformAuthResult> {
    try {
      // Email authentication is already handled by the existing Gmail OAuth
      // This would integrate with the existing Google auth system
      console.log(`Email authentication requested for user: ${userId}`)
      
      // For now, assume authenticated if user exists
      // In reality, this would check the Google OAuth tokens
      return {
        success: true,
        accessToken: 'existing-gmail-token', // Placeholder
        expiresAt: new Date(Date.now() + 3600000) // 1 hour
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      }
    }
  }

  async refreshAuth(userId: string): Promise<PlatformAuthResult> {
    // Gmail tokens can be refreshed using existing OAuth refresh logic
    console.log(`Email auth refresh requested for user: ${userId}`)
    return this.authenticate(userId)
  }

  async isAuthenticated(userId: string): Promise<boolean> {
    try {
      // Check if we have valid Gmail credentials for this user
      console.log(`Checking email authentication for user: ${userId}`)
      // This would check the existing Google OAuth token validity
      return true // Placeholder - assume authenticated
    } catch (error) {
      console.error(`Email auth check failed for user ${userId}:`, error)
      return false
    }
  }

  async fetchMessages(userId: string, options?: FetchOptions): Promise<PlatformMessage[]> {
    try {
      console.log(`Fetching email messages for user: ${userId}, options:`, options)
      
      // This would use the existing Gmail service functions
      // but return PlatformMessage[] format instead
      
      const messages: PlatformMessage[] = []
      
      // Implementation would:
      // 1. Use existing Gmail API calls
      // 2. Convert Gmail messages to PlatformMessage format
      // 3. Apply any filtering from options
      
      return messages
    } catch (error) {
      console.error('Error fetching email messages:', error)
      return []
    }
  }

  async fetchThread(userId: string, threadId: string): Promise<PlatformMessage[]> {
    try {
      console.log(`Fetching email thread ${threadId} for user: ${userId}`)
      
      // Use Gmail threads API to get all messages in a thread
      return []
    } catch (error) {
      console.error('Error fetching email thread:', error)
      return []
    }
  }

  async sendMessage(userId: string, message: OutgoingMessage): Promise<PlatformMessage> {
    try {
      console.log(`Sending email message for user: ${userId}`, message)
      
      // Use Gmail send API
      throw new Error('Email message sending not yet implemented in platform adapter')
    } catch (error) {
      throw new Error(`Failed to send email message: ${error}`)
    }
  }

  async fetchContacts(userId: string): Promise<PlatformContact[]> {
    try {
      console.log(`Fetching email contacts for user: ${userId}`)
      
      // This would use the existing contact fetching logic
      // but return PlatformContact[] format
      return []
    } catch (error) {
      console.error('Error fetching email contacts:', error)
      return []
    }
  }

  async searchContacts(userId: string, query: string): Promise<PlatformContact[]> {
    try {
      console.log(`Searching email contacts for user: ${userId}, query: ${query}`)
      
      // Search through Gmail contacts or address book
      return []
    } catch (error) {
      console.error('Error searching email contacts:', error)
      return []
    }
  }

  async syncMessages(userId: string, contactId?: string): Promise<SyncResult> {
    try {
      console.log(`Starting email message sync for user ${userId}, contact: ${contactId}`)
      
      // Use existing Gmail sync functions
      if (contactId) {
        const result = await syncContactEmails(userId, contactId)
        return {
          success: result.success,
          messagesProcessed: result.count || 0,
          newMessages: result.count || 0,
          errors: result.success ? [] : ['Failed to sync contact emails']
        }
      } else {
        const result = await syncAllUserEmails(userId)
        return {
          success: result.success,
          messagesProcessed: result.totalMessages || 0,
          newMessages: result.totalMessages || 0,
          errors: result.success ? [] : ['Failed to sync all emails']
        }
      }
    } catch (error) {
      return {
        success: false,
        messagesProcessed: 0,
        newMessages: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  // Convert Gmail message format to our PlatformMessage format
  private convertGmailMessage(gmailMessage: any): PlatformMessage {
    const headers = gmailMessage.payload?.headers || []
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || ''
    const from = headers.find((h: any) => h.name === 'From')?.value || ''
    const to = headers.find((h: any) => h.name === 'To')?.value || ''
    
    return {
      id: gmailMessage.id,
      platformId: gmailMessage.id,
      threadId: gmailMessage.threadId,
      content: this.extractEmailContent(gmailMessage),
      timestamp: new Date(parseInt(gmailMessage.internalDate)),
      direction: 'inbound', // We'll determine this based on sender
      sender: this.parseEmailContact(from),
      recipients: this.parseEmailContacts(to),
      metadata: {
        subject,
        labels: gmailMessage.labelIds,
        snippet: gmailMessage.snippet
      }
    }
  }

  private extractEmailContent(gmailMessage: any): string {
    // Use existing email content extraction logic
    // This would call the existing extractEmailContent function
    return gmailMessage.snippet || 'No content'
  }

  private parseEmailContact(emailString: string): PlatformContact {
    // Parse "Name <email>" format
    const emailMatch = emailString.match(/<(.+?)>/)
    const nameMatch = emailString.match(/^([^<]+)/)
    
    const email = emailMatch ? emailMatch[1].trim() : emailString.trim()
    const name = nameMatch ? nameMatch[1].trim() : email
    
    return {
      id: email,
      name,
      email,
      platformSpecific: {
        displayString: emailString
      }
    }
  }

  private parseEmailContacts(emailsString: string): PlatformContact[] {
    return emailsString.split(',').map(email => this.parseEmailContact(email.trim()))
  }
} 