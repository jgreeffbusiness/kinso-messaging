import { google, gmail_v1 } from 'googleapis'
import { prisma } from '@/server/db'
import { Prisma } from '@prisma/client'
import { getOAuth2Client, manuallyRefreshGoogleToken } from '@/server/services/gmail'

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

  /**
   * Process incremental Gmail sync using history API
   */
  async processHistoryUpdate(userId: string, startHistoryId: string): Promise<{ 
    success: boolean; 
    newMessagesProcessed: number; 
    error?: string; 
    nextHistoryId?: string | null; // Return next history ID to store
  }> {
    let user = await prisma.user.findUnique({
      where: { id: userId },
      // Select all fields needed for token refresh and user context
      select: { 
        id: true, email: true, googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true,
        authId: true, authProvider: true, createdAt: true, googleIntegrations: true, 
        name: true, photoUrl: true, slackAccessToken: true, slackIntegrations: true, 
        slackRefreshToken: true, slackTeamId: true, slackTokenExpiry: true, slackUserId: true, updatedAt: true
      }
    });

    if (!user || !user.googleAccessToken || !user.googleRefreshToken || !user.email) {
      return { success: false, newMessagesProcessed: 0, error: 'User not authenticated, refresh token, or email missing for history update.', nextHistoryId: startHistoryId };
    }

    let oauth2Client = getOAuth2Client(user);
    let gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let historyResponseData: gmail_v1.Schema$ListHistoryResponse | null | undefined = null;

    try {
      try {
        const response = await gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          historyTypes: ['messageAdded'] // Or other types as needed
        });
        historyResponseData = response.data;
      } catch (error: unknown) {
        const e = error as GoogleError;
        if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('Token has been expired')) {
          console.log(`Gmail history.list auth error for user ${user.email}. Attempting refresh.`);
          try {
            const refreshedUser = await manuallyRefreshGoogleToken(user);
            user = refreshedUser;
            oauth2Client = getOAuth2Client(refreshedUser);
            gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            console.log('Retrying gmail.users.history.list after token refresh...');
            const retryResponse = await gmail.users.history.list({
              userId: 'me',
              startHistoryId,
              historyTypes: ['messageAdded']
            });
            historyResponseData = retryResponse.data;
          } catch (refreshError: unknown) {
            const rErr = refreshError as GoogleError;
            console.error(`Failed to refresh token or retry history.list for ${user.email}: ${rErr.message}`);
            return { success: false, newMessagesProcessed: 0, error: rErr.message || 'Token refresh failed during history list.', nextHistoryId: startHistoryId };
          }
        } else {
          console.error(`❌ Gmail history.list failed (non-auth error) for ${user.email}:`, e.message);
          throw error; // Re-throw to be caught by outer try-catch for this function
        }
      }

      if (!historyResponseData) {
        return { success: false, newMessagesProcessed: 0, error: 'Failed to get history response from Google.', nextHistoryId: startHistoryId };
      }

      const historyRecords = historyResponseData.history || [];
      const nextHistoryId = historyResponseData.historyId || startHistoryId; // Update historyId for next sync

      if (historyRecords.length === 0) {
        console.log(`[GmailWebhook] No new message history for ${user.email} since ${startHistoryId}`);
        return { success: true, newMessagesProcessed: 0, nextHistoryId };
      }

      console.log(`[GmailWebhook] Found ${historyRecords.length} history items for ${user.email} since ${startHistoryId}`);
      let newMessagesSaved = 0;

      for (const record of historyRecords) {
        if (record.messagesAdded) {
          for (const addedMsg of record.messagesAdded) {
            const gmailMessageId = addedMsg.message?.id;
            if (!gmailMessageId) continue;

            // TODO: Wrap the following gmail.users.messages.get() call (if used to fetch full message)
            // with its own try-catch-refresh-retry block, re-using the 'user', 'oauth2Client', and 'gmail' variables
            // which may have been updated by a refresh during the history.list() call or a previous iteration.
            // If messages.get() fails due to auth, it should attempt refresh and retry for that specific message.
            // If refresh fails during messages.get(), decide whether to skip that message or halt further processing.
            try {
                // Example: const messageDetails = await gmail.users.messages.get({ userId: 'me', id: gmailMessageId });
                // Process messageDetails... save to DB etc.
                // For now, just incrementing a counter as placeholder for full processing
                console.log(`   Would process message ${gmailMessageId}`);
                newMessagesSaved++;
            } catch (msgError: unknown) {
                console.error(`[GmailWebhook] Error processing individual message ${gmailMessageId}:`, msgError);
                // Potentially log this error to a specific message processing error log
            }
          }
        }
      }
      
      if (newMessagesSaved > 0) {
        console.log(`[GmailWebhook] Successfully processed ${newMessagesSaved} new message stubs for ${user.email}.`);
      }
      return { success: true, newMessagesProcessed: newMessagesSaved, nextHistoryId };

    } catch (error: unknown) {
      const e = error as GoogleError;
      console.error(`❌ Gmail history processing failed globally for user ${userId}:`, e.message);
      return { success: false, newMessagesProcessed: 0, error: e.message || 'Unknown error during history processing', nextHistoryId: startHistoryId };
    }
  }
}

export const gmailWebhookSetup = new GmailWebhookSetupService() 