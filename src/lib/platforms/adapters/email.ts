import { 
  PlatformAdapter, 
  PlatformConfig, 
  PlatformMessage, 
  PlatformContact, 
  PlatformAuthResult,
  FetchOptions,
  OutgoingMessage,
  PlatformSyncResult
} from '../types'
import { 
    // syncContactEmails, // Commented out: Not fully used in adapter's current primary path & needs OAuth handling review if used directly.
    syncAllUserEmails
} from '@server/services/gmail'
import { getUnifiedMessageService } from '@/lib/services/unified-message-service'
// import { User } from '@prisma/client' // Commented out as User type might be inferred
import { prisma } from '@/server/db'

// Define the raw Gmail message data type (mirroring what syncContactEmails now returns)
interface GmailApiMessageData { 
  id: string | null | undefined;
  threadId: string | null | undefined;
  internalDate?: string | null | undefined;
  payload?: { 
    headers?: Array<{ name?: string; value?: string }>, 
    parts?: Array<{ mimeType?: string; filename?: string; body?: { size?: number; data?: string; attachmentId?: string; }; parts?: any[] }>, // parts can also have sub-parts
    body?: { size?: number; data?: string; attachmentId?: string; }, 
    mimeType?: string 
  }; 
  labelIds?: string[] | null | undefined;
  snippet?: string | null | undefined;
  // Potentially other fields used by convertGmailMessage
}

export class EmailAdapter implements PlatformAdapter {
  platform: string = 'email';
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
    const user = await prisma.user.findUnique({ 
        where: { id: userId }, 
        select: { googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true }
    });
    if (user && user.googleAccessToken && user.googleRefreshToken && user.googleTokenExpiry && new Date(user.googleTokenExpiry) > new Date(Date.now() - 5 * 60 * 1000)) { 
        return true;
    }
    console.warn(`[EmailAdapter] User ${userId} may not be truly authenticated with Google or tokens might be stale.`);
    return false; 
  }

  async fetchMessages(userId: string, options?: FetchOptions): Promise<PlatformMessage[]> {
    console.log(`[EmailAdapter] fetchMessages called for user: ${userId}, options:`, options);
    return [];
  }

  async fetchThread(userId: string, threadId: string): Promise<PlatformMessage[]> {
    console.log(`[EmailAdapter] fetchThread called for user: ${userId}, threadId: ${threadId}`);
    return [];
  }

  async sendMessage(userId: string, message: OutgoingMessage): Promise<{ success: boolean; platformMessageId?: string; error?: string; }> {
    console.log(`[EmailAdapter] sendMessage called for user: ${userId}`, message);
    return { success: false, error: 'Email message sending not yet implemented in platform adapter' };
  }

  async fetchContacts(userId: string): Promise<PlatformContact[]> {
    console.log(`[EmailAdapter] fetchContacts called for user: ${userId}`);
    return [];
  }

  async searchContacts(userId: string, query: string): Promise<PlatformContact[]> {
    console.log(`[EmailAdapter] searchContacts called for user: ${userId}, query: ${query}`);
    return [];
  }

  async syncMessages(userId: string, contactIdInput?: string): Promise<PlatformSyncResult> {
    console.log(`[EmailAdapter] Starting email message sync for user ${userId}, contact: ${contactIdInput}`);
    const unifiedMessageService = getUnifiedMessageService();
    let rawMessages: GmailApiMessageData[] = [];
    const syncErrors: string[] = []; 
    let overallSuccess = true;
    let totalMessagesAttemptedToStore = 0;
    let newMessagesStored = 0; 

    try {
      // User object is needed by syncAllUserEmails for token refresh logic.
      const user = await prisma.user.findUnique({ 
          where: { id: userId },
          // Ensure all fields needed by syncAllUserEmails (and its dependencies like getOAuth2Client) are selected.
          select: { 
            id: true, email: true, googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true,
            authId: true, authProvider: true, createdAt: true, googleIntegrations: true, 
            name: true, photoUrl: true, slackAccessToken: true, slackIntegrations: true, 
            slackRefreshToken: true, slackTeamId: true, slackTokenExpiry: true, slackUserId: true, updatedAt: true,
            contacts: true // Used by syncAllUserEmails to iterate
        }
      });
      if (!user) {
        throw new Error('User not found for sync operation');
      }

      if (contactIdInput) {
        // The `syncContactEmails` function expects a pre-configured OAuth2 client.
        // This path needs careful review if it's to be used directly, as `syncAllUserEmails` handles client creation/refresh.
        console.warn('[EmailAdapter] Syncing emails for a single contact is not fully supported via this adapter path due to OAuth client complexities. Recommend full sync.');
        syncErrors.push('Syncing emails for a single contact is not the primary path for this adapter; full sync is recommended.');
        overallSuccess = false;
        // If you still want to attempt it, you'd need to create an oauth2Client first:
        // import { getOAuth2Client } from '@server/services/gmail';
        // const oauth2Client = getOAuth2Client(user);
        // const contactSyncResult = await syncContactEmails(user, contactIdInput, oauth2Client);
        // ... process contactSyncResult ...
      } else {
        const allEmailsSyncResult = await syncAllUserEmails(userId); 
        if (allEmailsSyncResult.success && allEmailsSyncResult.allFetchedGmailMessages) {
          rawMessages = allEmailsSyncResult.allFetchedGmailMessages;
        } else {
          overallSuccess = false;
          syncErrors.push(allEmailsSyncResult.error || 'Failed to sync all user emails at service level');
        }
        if (allEmailsSyncResult.detailedResults) {
            allEmailsSyncResult.detailedResults.forEach(dr => {
                if (!dr.success && dr.error) syncErrors.push(`Contact ${dr.contactId}: ${dr.error}`);
            });
        }
      }

      if (rawMessages.length > 0) {
        console.log(`[EmailAdapter] Fetched ${rawMessages.length} raw Gmail messages. Converting and storing...`);
        for (const rawMessage of rawMessages) {
          if (!rawMessage.id) {
            console.warn('[EmailAdapter] Skipping raw message due to missing ID.', rawMessage);
            continue;
          }
          try {
            const platformMessage = this.convertGmailMessage(rawMessage); 
            
            const existingMessage = await prisma.message.findFirst({
                where: {
                    userId: userId, 
                    platform: this.config.name, // Correct: use adapter's platform name
                    platformMessageId: platformMessage.platformId // Correct: use platformId from PlatformMessage
                }
            });

            if (existingMessage) {
                totalMessagesAttemptedToStore++;
                continue;
            }
            
            const normalizedMessage = await unifiedMessageService.normalizePlatformMessage(platformMessage, userId, this.config.name);
            await unifiedMessageService.storeMessage(normalizedMessage); 
            newMessagesStored++;
            totalMessagesAttemptedToStore++;
          } catch (processingError: unknown) {
            const err = processingError as Error;
            console.error(`[EmailAdapter] Error processing/storing Gmail message ${rawMessage.id}: ${err.message}`, err.stack);
            syncErrors.push(`Error processing message ${rawMessage.id}: ${err.message}`);
            overallSuccess = false; 
          }
        }
      } else if (overallSuccess) { 
        console.log('[EmailAdapter] No new raw Gmail messages fetched to process.');
      }

      return {
        success: overallSuccess && syncErrors.length === 0,
        messagesProcessed: totalMessagesAttemptedToStore, 
        newMessages: newMessagesStored, 
        errors: syncErrors,
      };

    } catch (error: unknown) {
      const e = error as Error;
      console.error('[EmailAdapter] Critical error in syncMessages:', e, e.stack);
      return {
        success: false,
        messagesProcessed: totalMessagesAttemptedToStore,
        newMessages: newMessagesStored,
        errors: [...syncErrors, e.message || 'Unknown critical error in EmailAdapter.syncMessages'],
      };
    }
  }

  private convertGmailMessage(gmailMessage: GmailApiMessageData): PlatformMessage {
    const headers = gmailMessage.payload?.headers || [];
    const subject = headers.find((h: { name?: string; value?: string }) => h.name === 'Subject')?.value || ''
    const fromHeader = headers.find((h: { name?: string; value?: string }) => h.name === 'From')?.value || ''
    const toHeader = headers.find((h: { name?: string; value?: string }) => h.name === 'To')?.value || ''
    const dateHeader = headers.find((h: { name?: string; value?: string }) => h.name === 'Date')?.value;

    let timestamp = gmailMessage.internalDate ? new Date(parseInt(gmailMessage.internalDate)) : new Date();
    if (dateHeader) {
        try { timestamp = new Date(dateHeader); } catch { /* keep internalDate, ignore error */ }
    }
    
    // Simplified direction logic. Robust version would compare sender to user's known emails.
    const direction: 'inbound' | 'outbound' = 'inbound'; 
    
    if (!gmailMessage.id) {
        // This should ideally not happen if rawMessages are filtered earlier
        console.error('[EmailAdapter] convertGmailMessage called with missing gmailMessage.id');
        throw new Error('Cannot convert Gmail message without an ID');
    }

    return {
      id: gmailMessage.id, // Use Gmail ID as the base for PlatformMessage ID here
      platformId: gmailMessage.id, // Gmail message ID is the platformId
      threadId: gmailMessage.threadId || undefined,
      content: this.extractEmailContent(gmailMessage), 
      timestamp: timestamp,
      direction: direction, 
      sender: this.parseEmailContact(fromHeader),
      recipients: this.parseEmailContacts(toHeader),
      metadata: {
        subject,
        labels: gmailMessage.labelIds,
        snippet: gmailMessage.snippet,
        rawHeaders: headers 
      }
    };
  }

  private extractEmailContent(gmailMessage: GmailApiMessageData): string {
    const payload = gmailMessage.payload;
    if (!payload) return gmailMessage.snippet || 'No payload data';

    // Prefer text/plain part
    const plainTextPart = payload.parts?.find(p => p.mimeType === 'text/plain' && p.body?.data);
    if (plainTextPart?.body?.data) {
        return Buffer.from(plainTextPart.body.data, 'base64').toString();
    }

    // Fallback to text/html part (and strip HTML)
    const htmlPart = payload.parts?.find(p => p.mimeType === 'text/html' && p.body?.data);
    if (htmlPart?.body?.data) {
        const html = Buffer.from(htmlPart.body.data, 'base64').toString();
        return html.replace(/<[^>]+>/g, ''); // Basic HTML strip
    }

    // If no parts, or parts didn't yield content, try top-level body (for non-multipart messages)
    if (payload.body?.data) {
        let bodyData = Buffer.from(payload.body.data, 'base64').toString();
        if (payload.mimeType === 'text/html') {
            bodyData = bodyData.replace(/<[^>]+>/g, '');
        }
        return bodyData; 
    }
    
    return gmailMessage.snippet || 'No textual content found';
  }

  private parseEmailContact(emailString: string): PlatformContact {
    if (!emailString) return { id: 'unknown_sender', name: 'Unknown Sender', email: undefined };
    const emailMatch = emailString.match(/<(.+?)>/);
    const name = emailString.includes('<') ? emailString.substring(0, emailString.indexOf('<')).trim() : emailString.split('@')[0]; // Better name guess
    const email = emailMatch ? emailMatch[1].trim().toLowerCase() : emailString.trim().toLowerCase();
    return {
      id: email, 
      name: name || email, 
      email: email,
      platformSpecific: { displayString: emailString }
    };
  }

  private parseEmailContacts(emailsString: string): PlatformContact[] {
    if (!emailsString) return [];
    return emailsString.split(',')
        .map(emailStr => this.parseEmailContact(emailStr.trim()))
        .filter(pc => pc.email); // Ensure valid contacts with email
  }
} 