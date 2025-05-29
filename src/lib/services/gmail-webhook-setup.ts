import { google, gmail_v1 } from 'googleapis'
import { prisma } from '@/server/db'
import { Prisma } from '@prisma/client'
import { getOAuth2Client, manuallyRefreshGoogleToken } from '@/server/services/gmail'
import { getUnifiedMessageService } from '@/lib/services/unified-message-service'
import { PlatformMessage, PlatformContact } from '@/lib/platforms/types'

interface GoogleError {
  code?: number
  message?: string
}

interface GmailWatchDataForDB {
    historyId?: string | null;
    expiration?: string | null;
    watchActive: boolean;
    lastWebhook?: Date | string | null;
    lastSetupAttempt?: Date | string | null;
    lastError?: string | null;
}

// Helper type for raw Gmail message data from API (ensure this is defined or imported)
interface GmailApiMessageData { 
  id: string | null | undefined;
  threadId: string | null | undefined;
  internalDate?: string | null | undefined;
  payload?: any; 
  labelIds?: string[] | null | undefined;
  snippet?: string | null | undefined;
}

// Temporary helper function - ideally, this logic is shared with EmailAdapter
function tempConvertGmailToPlatformMessage(gmailMessage: GmailApiMessageData, userEmail: string): PlatformMessage {
  const headers = gmailMessage.payload?.headers || [];
  const subject = headers.find((h: { name?: string; value?: string }) => h.name === 'Subject')?.value || '';
  const fromHeader = headers.find((h: { name?: string; value?: string }) => h.name === 'From')?.value || '';
  const toHeader = headers.find((h: { name?: string; value?: string }) => h.name === 'To')?.value || '';
  const dateHeader = headers.find((h: { name?: string; value?: string }) => h.name === 'Date')?.value;

  let timestamp = gmailMessage.internalDate ? new Date(parseInt(gmailMessage.internalDate)) : new Date();
  if (dateHeader) { try { timestamp = new Date(dateHeader); } catch { /* keep internalDate */ } }

  const senderEmailFull = fromHeader.match(/<(.+?)>/)?.[1] || fromHeader;
  const direction = senderEmailFull.toLowerCase() === userEmail.toLowerCase() ? 'outbound' : 'inbound';

  const extractEmailContent = (payload: any): string => {
    if (!payload) return gmailMessage.snippet || 'No payload data';
    const plainTextPart = payload.parts?.find((p: any) => p.mimeType === 'text/plain' && p.body?.data);
    if (plainTextPart?.body?.data) return Buffer.from(plainTextPart.body.data, 'base64').toString();
    const htmlPart = payload.parts?.find((p: any) => p.mimeType === 'text/html' && p.body?.data);
    if (htmlPart?.body?.data) return Buffer.from(htmlPart.body.data, 'base64').toString().replace(/<[^>]+>/g, '');
    if (payload.body?.data) {
      let bodyData = Buffer.from(payload.body.data, 'base64').toString();
      if (payload.mimeType === 'text/html') bodyData = bodyData.replace(/<[^>]+>/g, '');
      return bodyData;
    }
    return gmailMessage.snippet || 'No textual content found';
  };

  const parseEmailContact = (emailString: string): PlatformContact => {
    if (!emailString) return { id: 'unknown_contact', name: 'Unknown', email: undefined };
    const emailMatch = emailString.match(/<(.+?)>/);
    const name = emailString.includes('<') ? emailString.substring(0, emailString.indexOf('<')).trim() : emailString.split('@')[0];
    const email = emailMatch ? emailMatch[1].trim().toLowerCase() : emailString.trim().toLowerCase();
    return { id: email, name: name || email, email: email };
  };

  return {
    id: gmailMessage.id!,
    platformId: gmailMessage.id!,
    threadId: gmailMessage.threadId || undefined,
    content: extractEmailContent(gmailMessage.payload),
    timestamp: timestamp,
    direction: direction,
    sender: parseEmailContact(fromHeader),
    recipients: toHeader.split(',').map(e => parseEmailContact(e.trim())),
    metadata: { subject, labels: gmailMessage.labelIds, snippet: gmailMessage.snippet, rawHeaders: headers }
  };
}

export class GmailWebhookSetupService {
  
  /**
   * Set up Gmail push notifications for a user
   */
  async setupGmailWatch(userId: string): Promise<{
    success: boolean
    watchResponse?: gmail_v1.Schema$WatchResponse
    error?: string
    historyId?: string
  }> {
    try {
      let user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true,
          authId: true, authProvider: true, createdAt: true, googleIntegrations: true, 
          name: true, photoUrl: true, slackAccessToken: true, slackIntegrations: true, 
          slackRefreshToken: true, slackTeamId: true, slackTokenExpiry: true, slackUserId: true, updatedAt: true
        }
      });

      if (!user || !user.googleAccessToken || !user.googleRefreshToken) {
        await this.storeWatchError(userId, 'User not fully authenticated for webhook setup.');
        return { success: false, error: 'User not fully authenticated for webhook setup.' };
      }

      let oauth2Client = getOAuth2Client(user);
      let gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      let responseData: gmail_v1.Schema$WatchResponse | null | undefined = null;

      const watchRequestParams = {
        userId: 'me',
        requestBody: {
          labelIds: ['INBOX'],
          topicName: `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/gmail-notifications`,
          labelFilterBehavior: 'INCLUDE'
        }
      };

      try {
        console.log('🔍 Setting up Gmail watch for user:', user.email);
        const response = await gmail.users.watch(watchRequestParams);
        responseData = response.data;
      } catch (error: unknown) {
        const e = error as GoogleError;
        if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('Token has been expired')) {
          console.log(`Gmail watch setup auth error for ${user.email}. Attempting refresh.`);
          try {
            const refreshedUser = await manuallyRefreshGoogleToken(user);
            user = refreshedUser;
            oauth2Client = getOAuth2Client(refreshedUser);
            gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            console.log('Retrying gmail.users.watch after token refresh...');
            const retryResponse = await gmail.users.watch(watchRequestParams);
            responseData = retryResponse.data;
          } catch (refreshError: unknown) {
            const rErr = refreshError as GoogleError;
            console.error(`Failed to refresh token or retry watch setup for ${user.email}: ${rErr.message}`);
            await this.storeWatchError(userId, rErr.message || 'Token refresh failed during watch setup.');
            return { success: false, error: rErr.message || 'Token refresh failed during watch setup.' };
          }
        } else {
          console.error('❌ Gmail watch setup failed (non-auth error):', e.message);
          await this.storeWatchError(userId, e.message || 'Non-auth error during watch setup');
          return { success: false, error: e.message || 'Non-auth error during watch setup' };
        }
      }

      if (!responseData || !responseData.historyId) {
        const errMsg = 'Failed to get valid watch response (missing historyId) from Google.';
        await this.storeWatchError(userId, errMsg);
        return { success: false, error: errMsg };
      }
      
      console.log('✅ Gmail watch setup successful:', { historyId: responseData.historyId, expiration: responseData.expiration });
      await this.storeWatchData(userId, {
          historyId: responseData.historyId,
          expiration: responseData.expiration,
          watchActive: true,
          lastSetupAttempt: new Date(),
          lastError: null
      });

      return {
        success: true,
        watchResponse: responseData,
        historyId: responseData.historyId
      };

    } catch (error: unknown) {
      const e = error as GoogleError;
      console.error('❌ Gmail watch setup critical error:', e.message);
      await this.storeWatchError(userId, e.message || 'Critical error during watch setup');
      return { success: false, error: e.message || 'Unknown error during watch setup' };
    }
  }

  /**
   * Stop Gmail push notifications for a user
   */
  async stopGmailWatch(userId: string): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      let user = await prisma.user.findUnique({
        where: { id: userId },
        select: { 
          id: true, email: true, googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true,
          authId: true, authProvider: true, createdAt: true, googleIntegrations: true, 
          name: true, photoUrl: true, slackAccessToken: true, slackIntegrations: true, 
          slackRefreshToken: true, slackTeamId: true, slackTokenExpiry: true, slackUserId: true, updatedAt: true
        }
      });

      if (!user || !user.googleAccessToken || !user.googleRefreshToken) {
        // Don't store error here if already not watching or not authed, just return status
        return { success: false, error: 'User not fully authenticated with Google to stop watch.' };
      }

      let oauth2Client = getOAuth2Client(user);
      let gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      try {
        console.log('🛑 Attempting to stop Gmail watch for user:', user.email);
        await gmail.users.stop({ userId: 'me' });
      } catch (error: unknown) {
        const e = error as GoogleError;
        if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('Token has been expired')) {
          console.log(`Gmail stop watch auth error for ${user.email}. Attempting refresh.`);
          try {
            const refreshedUser = await manuallyRefreshGoogleToken(user);
            user = refreshedUser;
            oauth2Client = getOAuth2Client(refreshedUser);
            gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            console.log('Retrying gmail.users.stop after token refresh...');
            await gmail.users.stop({ userId: 'me' });
          } catch (refreshError: unknown) {
            const rErr = refreshError as GoogleError;
            console.error(`Failed to refresh token or retry stop watch for ${user.email}: ${rErr.message}`);
            // Don't store this as a watch error, as the goal is to stop.
            // The user might need to re-auth if they want to start watch again.
            return { success: false, error: rErr.message || 'Token refresh failed during stop watch attempt.' };
          }
        } else {
          // For non-auth errors during stop, it might mean watch wasn't active or other issues.
          console.error('❌ Gmail stop watch failed (non-auth error):', e.message);
          // Don't necessarily mark as a persistent watch error, but return failure.
          return { success: false, error: e.message || 'Failed to stop watch due to non-auth error.' };
        }
      }

      console.log('✅ Gmail watch stopped successfully for user:', user.email);
      await this.storeWatchData(userId, { 
        watchActive: false, 
        lastError: null, // Clear any previous error
        historyId: null, // Clear historyId as watch is stopped
        expiration: null // Clear expiration
      });
      return { success: true };

    } catch (error: unknown) {
      const e = error as GoogleError;
      console.error('❌ Gmail stop watch critical error:', e.message);
      return { success: false, error: e.message || 'Unknown critical error during stop watch' };
    }
  }

  /**
   * Check if Gmail watch is active for a user
   */
  async getWatchStatus(userId: string): Promise<{
    isActive: boolean
    historyId?: string
    expiration?: string
    lastUpdate?: Date
  }> {
    // In a full implementation, you'd store this in the database
    // For now, we'll check if the user has Google access
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        // You'd add these fields to your schema:
        // gmailWatchHistoryId: true,
        // gmailWatchExpiration: true,
        // gmailWatchActive: true,
        // gmailWatchUpdated: true
      }
    })

    return {
      isActive: !!user?.googleAccessToken,
      historyId: undefined, // Would come from database
      expiration: undefined,
      lastUpdate: undefined
    }
  }

  /**
   * Get setup instructions for the UI
   */
  getSetupInstructions(): {
    steps: string[]
    commands: string[]
    requirements: string[]
  } {
    return {
      requirements: [
        '🔑 Google Cloud Project with billing enabled',
        '📧 Gmail API already enabled',
        '📡 Cloud Pub/Sub API enabled',
        '🌐 Ngrok tunnel running (for local development)',
        '⚙️ Proper IAM permissions configured'
      ],
      steps: [
        '1. Enable Cloud Pub/Sub API in Google Cloud Console',
        '2. Create Pub/Sub topic: gmail-notifications',
        '3. Create push subscription to your webhook URL',
        '4. Set IAM permissions for Gmail API service account',
        '5. Call Gmail watch() API to start notifications',
        '6. Test by sending yourself an email'
      ],
      commands: [
        '# Create topic',
        'gcloud pubsub topics create gmail-notifications',
        '',
        '# Create subscription (replace YOUR_NGROK_URL)',
        `gcloud pubsub subscriptions create gmail-webhook-subscription \\`,
        `  --topic=gmail-notifications \\`,
        `  --push-endpoint=https://YOUR_NGROK_URL.ngrok.io/api/webhooks/gmail`,
        '',
        '# Set IAM permissions',
        'gcloud pubsub topics add-iam-policy-binding gmail-notifications \\',
        '  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \\',
        '  --role=roles/pubsub.publisher'
      ]
    }
  }

  /**
   * Store watch data in database (placeholder)
   */
  private async storeWatchData(userId: string, dataToStore: Partial<GmailWatchDataForDB>): Promise<void> {
    try {
      const user = await prisma.user.findUnique({ 
        where: { id: userId }, 
        select: { googleIntegrations: true }
      });
      
      const currentIntegrations = (user?.googleIntegrations || {}) as Prisma.JsonObject;
      
      let currentGmailWatchDataBase: Partial<GmailWatchDataForDB> = { watchActive: false };
      if (typeof currentIntegrations.gmailWatch === 'object' && currentIntegrations.gmailWatch !== null && !Array.isArray(currentIntegrations.gmailWatch)) {
        currentGmailWatchDataBase = currentIntegrations.gmailWatch as unknown as Partial<GmailWatchDataForDB>;
      }

      const newGmailWatchData: GmailWatchDataForDB = {
        watchActive: false,
        historyId: null,
        expiration: null,
        lastWebhook: null,
        lastSetupAttempt: null,
        lastError: null,
        ...currentGmailWatchDataBase,
        ...dataToStore
      };
      
      if (typeof dataToStore.watchActive === 'boolean') {
        newGmailWatchData.watchActive = dataToStore.watchActive;
      }

      const updateData: Prisma.UserUpdateInput = {
        googleIntegrations: {
          ...(currentIntegrations as Prisma.JsonObject),
          gmailWatch: newGmailWatchData as unknown as Prisma.InputJsonValue
        }
      };

      await prisma.user.update({
          where: { id: userId },
          data: updateData
      });
      console.log(`Stored Gmail watch data for user ${userId}:`, newGmailWatchData);
    } catch (dbError: unknown) {
        const e = dbError as { message?: string };
        console.error(`Failed to store watch data for user ${userId}:`, e.message);
    }
  }

  private async storeWatchError(userId: string, errorMessage: string): Promise<void> {
    const errorDataToStore: Partial<GmailWatchDataForDB> = {
        watchActive: false, 
        lastError: errorMessage,
        lastSetupAttempt: new Date()
    };
    await this.storeWatchData(userId, errorDataToStore);
  }

  private async getStoredHistoryId(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleIntegrations: true }
    });
    const integrations = (user?.googleIntegrations || {}) as Prisma.JsonObject;
    if (typeof integrations.gmailWatch === 'object' && integrations.gmailWatch !== null && !Array.isArray(integrations.gmailWatch)) {
      const watchData = integrations.gmailWatch as unknown as Partial<GmailWatchDataForDB>;
      return watchData.historyId || null;
    }
    return null;
  }

  /**
   * Process incremental Gmail sync using history API
   */
  async processHistoryUpdate(userId: string, newHistoryIdFromWebhook: string): Promise<{ 
    success: boolean; 
    newMessagesProcessed: number; 
    error?: string; 
    // nextHistoryIdToStore?: string | null; // This will be handled by storing newHistoryIdFromWebhook or actual next from API
  }> {
    const lastKnownHistoryId = await this.getStoredHistoryId(userId);

    if (!lastKnownHistoryId) {
      console.warn(`[GmailWebhook] No last known historyId found for user ${userId}. Using new historyId from webhook as start, but this might miss messages if this is not the very first notification after watch() setup.`);
      // For the very first webhook after a watch() command, the historyId from the watch() response should have been stored.
      // If it wasn't, using newHistoryIdFromWebhook for the *first* history.list call is problematic.
      // A robust solution ensures the historyId from watch() is the initial stored historyId.
      // For now, if null, we might have to skip or only store the newHistoryIdFromWebhook for the *next* run.
      // Let's try to process assuming this newHistoryIdFromWebhook is the one to start *after*, effectively making this run a no-op for message fetching but good for updating the stored ID.
      await this.storeWatchData(userId, { historyId: newHistoryIdFromWebhook, lastWebhook: new Date() });
      return { success: true, newMessagesProcessed: 0, error: "No previously stored historyId to start from. Stored current webhook historyId for next time." };
    }

    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { /* ... all required user fields ... */ 
        id: true, email: true, googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true,
        authId: true, authProvider: true, createdAt: true, googleIntegrations: true, 
        name: true, photoUrl: true, slackAccessToken: true, slackIntegrations: true, 
        slackRefreshToken: true, slackTeamId: true, slackTokenExpiry: true, slackUserId: true, updatedAt: true
      }
    });

    if (!user || !user.googleAccessToken || !user.googleRefreshToken || !user.email) {
      return { success: false, newMessagesProcessed: 0, error: 'User not authenticated for history update.' };
    }

    let oauth2Client = getOAuth2Client(user);
    let gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let historyResponseData: gmail_v1.Schema$ListHistoryResponse | null | undefined = null;
    let actualNextHistoryIdToStore = newHistoryIdFromWebhook; // Default to storing the ID from this webhook

    try {
      try {
        console.log(`[GmailWebhook] Calling history.list for user ${user.email} with startHistoryId: ${lastKnownHistoryId}`);
        const response = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: lastKnownHistoryId, // USE THE STORED, PREVIOUS historyId
          historyTypes: ['messageAdded'] 
        });
        historyResponseData = response.data;
      } catch (error: unknown) { // ... (token refresh logic for history.list remains the same) ...
        const e = error as GoogleError;
        if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('Token has been expired')) {
          console.log(`Gmail history.list auth error for user ${user.email}. Attempting refresh.`);
          const refreshedUser = await manuallyRefreshGoogleToken(user);
          user = refreshedUser;
          oauth2Client = getOAuth2Client(refreshedUser);
          gmail = google.gmail({ version: 'v1', auth: oauth2Client });
          console.log('Retrying gmail.users.history.list after token refresh...');
          const retryResponse = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: lastKnownHistoryId,
            historyTypes: ['messageAdded']
          });
          historyResponseData = retryResponse.data;
        } else {
          console.error(`❌ Gmail history.list failed (non-auth error) for ${user.email}:`, e.message);
          throw error;
        }
      }

      if (!historyResponseData) {
        await this.storeWatchData(userId, { lastError: 'Failed to get history response from Google.', lastWebhook: new Date() });
        return { success: false, newMessagesProcessed: 0, error: 'Failed to get history response from Google.' };
      }

      const historyRecords = historyResponseData.history || [];
      if (historyResponseData.historyId) { // Gmail API provides the historyId of the list response
        actualNextHistoryIdToStore = historyResponseData.historyId;
      }

      if (historyRecords.length === 0) {
        console.log(`[GmailWebhook] No new message history for ${user.email} between ${lastKnownHistoryId} and ${actualNextHistoryIdToStore}`);
        await this.storeWatchData(userId, { historyId: actualNextHistoryIdToStore, lastWebhook: new Date() }); // Update to the latest historyId from API response
        return { success: true, newMessagesProcessed: 0 };
      }

      console.log(`[GmailWebhook] Found ${historyRecords.length} history items for ${user.email} (since ${lastKnownHistoryId}, up to ${actualNextHistoryIdToStore})`);
      let newMessagesSaved = 0;
      const unifiedMessageService = getUnifiedMessageService();

      for (const record of historyRecords) {
        if (record.messagesAdded) {
          for (const addedMsg of record.messagesAdded) {
            const gmailMessageId = addedMsg.message?.id;
            if (!gmailMessageId) continue;
            try {
              console.log(`[GmailWebhook] Fetching details for message ID: ${gmailMessageId}`);
              let messageDetailsResponse;
              try {
                messageDetailsResponse = await gmail.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'full' });
              } catch (msgGetError: unknown) {
                const mgErr = msgGetError as GoogleError;
                if (mgErr.code === 401 || mgErr.message?.includes('invalid_grant') || mgErr.message?.includes('Token has been expired')) {
                  console.log(`[GmailWebhook] Auth error getting message ${gmailMessageId}. Attempting refresh.`);
                  const refreshedUser = await manuallyRefreshGoogleToken(user!);
                  user = refreshedUser;
                  oauth2Client = getOAuth2Client(refreshedUser);
                  gmail = google.gmail({ version: 'v1', auth: oauth2Client });
                  console.log('[GmailWebhook] Retrying messages.get after refresh...');
                  messageDetailsResponse = await gmail.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'full' });
                } else { throw mgErr; }
              }
              if (messageDetailsResponse?.data) {
                const rawGmailMessage = messageDetailsResponse.data as GmailApiMessageData;
                const existingMessage = await prisma.message.findFirst({ where: { userId: user!.id, platform: 'email', platformMessageId: rawGmailMessage.id } });
                if (existingMessage) {
                  console.log(`[GmailWebhook] Message ${gmailMessageId} already exists in DB. Skipping.`);
                  continue;
                }
                const platformMessage = tempConvertGmailToPlatformMessage(rawGmailMessage, user!.email!);
                const normalizedMessage = await unifiedMessageService.normalizePlatformMessage(platformMessage, user!.id, 'email');
                await unifiedMessageService.storeMessage(normalizedMessage);
                console.log(`[GmailWebhook] Successfully processed and stored new message ${gmailMessageId}`);
                newMessagesSaved++;
              } else { console.warn(`[GmailWebhook] No data returned from messages.get for ID: ${gmailMessageId}`); }
            } catch (msgProcessingError: unknown) {
              const err = msgProcessingError as Error;
              console.error(`[GmailWebhook] Error processing individual message ${gmailMessageId}: ${err.message}`, err.stack);
            }
          }
        }
      }
      
      await this.storeWatchData(userId, { historyId: actualNextHistoryIdToStore, lastWebhook: new Date(), lastError: null });
      if (newMessagesSaved > 0) {
        console.log(`[GmailWebhook] Successfully processed ${newMessagesSaved} new messages for ${user.email}.`);
      }
      return { success: true, newMessagesProcessed: newMessagesSaved };

    } catch (error: unknown) {
      const e = error as GoogleError;
      console.error(`❌ Gmail history processing failed globally for user ${userId}:`, e.message);
      await this.storeWatchData(userId, { lastError: e.message || 'Unknown error in history processing', lastWebhook: new Date() });
      return { success: false, newMessagesProcessed: 0, error: e.message || 'Unknown error during history processing' };
    }
  }
}

export const gmailWebhookSetup = new GmailWebhookSetupService() 