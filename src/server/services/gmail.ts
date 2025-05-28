import { google, Auth as GoogleAuth } from 'googleapis'
import { prisma } from '@server/db'
import type { User } from '@prisma/client'
import { Prisma } from '@prisma/client'
// import { getUnifiedMessageService } from '@/lib/services/unified-message-service'
// import { EmailAdapter } from '@/lib/platforms/adapters/email'

// Create a single function to handle OAuth client creation with auto-refresh capability
const createOAuth2ClientWithAutoRefresh = (user: User): GoogleAuth.OAuth2Client => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
  
  // Set initial credentials
  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
    expiry_date: user.googleTokenExpiry ? new Date(user.googleTokenExpiry).getTime() : undefined
  })
  
  // Add token refresh handler
  oauth2Client.on('tokens', async (tokens) => {
    const updateData: Prisma.UserUpdateInput = {
      googleAccessToken: tokens.access_token,
      googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined
    }
    if (tokens.refresh_token) {
      updateData.googleRefreshToken = tokens.refresh_token
    }
    await prisma.user.update({ where: { id: user.id }, data: updateData })
    console.log(`Refreshed Google token for user ${user.id}`)
  })
  
  return oauth2Client
}

// This replaces both your original functions
export const getOAuth2Client = createOAuth2ClientWithAutoRefresh

// Manual refresh function (for cases where auto-refresh fails)
export async function manuallyRefreshGoogleToken(user: User): Promise<User> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
  
  oauth2Client.setCredentials({
    refresh_token: user.googleRefreshToken
  })
  
  try {
    const { credentials } = await oauth2Client.refreshAccessToken()
    const expiryDate = credentials.expiry_date ? new Date(credentials.expiry_date) : null
    
    // Update user in database with new tokens
    return await prisma.user.update({
      where: { id: user.id },
      data: {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: expiryDate
      }
    })
  } catch (error) {
    console.error('Manual token refresh failed:', error)
    
    // Mark user's Google integration as requiring re-authentication
    await prisma.user.update({
      where: { id: user.id },
      data: {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
        googleIntegrations: Prisma.JsonNull
      }
    })
    
    throw new Error('Google authentication expired. Please reconnect your Google account.')
  }
}

// Helper type for raw Gmail message data from API
interface GmailApiMessageData { 
  id: string | null | undefined;
  threadId: string | null | undefined;
  internalDate?: string | null | undefined;
  payload?: any; // Keeping it simple for now, can be typed further based on EmailPayload from gmail.ts
  labelIds?: string[] | null | undefined;
  snippet?: string | null | undefined;
  // Add other fields you might use from messageDetails.data
}

export async function syncContactEmails(user: User, contactId: string, initialOAuth2Client: GoogleAuth.OAuth2Client): Promise<{
  success: boolean;
  fetchedGmailMessages: GmailApiMessageData[];
  error?: string;
  processedCountAtApiLevel: number;
}> {
  let oauth2Client = initialOAuth2Client;
  let gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const contact = await prisma.contact.findUnique({ where: { id: contactId, userId: user.id } });

  const rawMessages: GmailApiMessageData[] = [];
  let messagesFetchedFromApi = 0;

  if (!contact || !contact.email) {
    return { success: false, fetchedGmailMessages: [], error: "Contact or email missing for syncContactEmails", processedCountAtApiLevel: 0 };
  }
  const contactEmailForSearch = contact.email.trim();
  console.log(`[syncContactEmails] Syncing for contact ${contactEmailForSearch} (ID: ${contactId}) for user ${user.id}`);
  const searchQuery = `from:${contactEmailForSearch} OR to:${contactEmailForSearch}`;
  
  try {
    const listResponse = await gmail.users.messages.list({ userId: 'me', q: searchQuery, maxResults: 50 });
    console.log(`[syncContactEmails] Gmail API listResponse for query "${searchQuery}" (User: ${user.id}, Contact: ${contactEmailForSearch}):`, JSON.stringify(listResponse.data, null, 2));
    const messagesToList = listResponse.data.messages || [];

    for (const listedMessage of messagesToList) {
      if (!listedMessage.id) continue;
      const gmailId = listedMessage.id;

      try {
        const messageDetailsResponse = await gmail.users.messages.get({ userId: 'me', id: gmailId, format: 'full' });
        console.log(`[syncContactEmails] Gmail API messageDetailsResponse for message ID ${gmailId}:`, JSON.stringify(messageDetailsResponse.data, null, 2));
        
        if (messageDetailsResponse.data) {
            rawMessages.push(messageDetailsResponse.data as GmailApiMessageData);
            messagesFetchedFromApi++;
        } else {
            console.warn(`[syncContactEmails] No data returned from messages.get for ID: ${gmailId}`);
        }
      } catch (msgGetError: unknown) {
        const mgErr = msgGetError as { code?: number; message?: string };
        if (mgErr.code === 401 || mgErr.message?.includes('invalid_grant') || mgErr.message?.includes('Token has been expired')) {
          console.log(`[syncContactEmails] Auth error getting message ${gmailId} for ${contactEmailForSearch}. Attempting refresh for user ${user.id}.`);
          try {
            const refreshedUser = await manuallyRefreshGoogleToken(user);
            user = refreshedUser; 
            oauth2Client = getOAuth2Client(refreshedUser);
            gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            console.log('[syncContactEmails] Retrying messages.get after refresh...');
            const refreshedMessageDetails = await gmail.users.messages.get({ userId: 'me', id: gmailId, format: 'full' });
            console.log(`[syncContactEmails] Gmail API refreshedMessageDetails for message ID ${gmailId}:`, JSON.stringify(refreshedMessageDetails.data, null, 2));
            if (refreshedMessageDetails.data) {
                rawMessages.push(refreshedMessageDetails.data as GmailApiMessageData);
                messagesFetchedFromApi++;
            }
          } catch (nestedRefreshError: unknown) {
            const nrErr = nestedRefreshError as Error;
            console.error(`[syncContactEmails] Failed to refresh token or retry messages.get for ${gmailId}: ${nrErr.message}`);
            return { success: false, fetchedGmailMessages: rawMessages, error: `Token refresh/retry failed: ${nrErr.message}`, processedCountAtApiLevel: messagesFetchedFromApi }; 
          }
        } else {
          console.error(`[syncContactEmails] Error fetching message details for ${gmailId} (non-auth): ${mgErr.message}`);
        }
      }
    }
    return { success: true, fetchedGmailMessages: rawMessages, processedCountAtApiLevel: messagesFetchedFromApi };

  } catch (listError: unknown) {
    const lErr = listError as { code?: number; message?: string };
    console.error(`[syncContactEmails] Error listing messages for ${contactEmailForSearch}: ${lErr.message}`);
    if (lErr.code === 401 || lErr.message?.includes('invalid_grant') || lErr.message?.includes('Token has been expired')) {
        return { success: false, fetchedGmailMessages: [], error: `Auth error listing messages: ${lErr.message}`, processedCountAtApiLevel: 0 };
    }
    return { success: false, fetchedGmailMessages: [], error: lErr.message, processedCountAtApiLevel: 0 };
  }
}

export async function syncAllUserEmails(userId: string): Promise<{
  success: boolean;
  allFetchedGmailMessages: GmailApiMessageData[];
  error?: string;
  detailedResults?: Array<{contactId: string, success: boolean, count: number, error?: string}>;
}> {
  let user = await prisma.user.findUnique({ 
    where: { id: userId },
    // Select all fields needed by getOAuth2Client and manuallyRefreshGoogleToken
    select: { 
        id: true, email: true, googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true,
        authId: true, authProvider: true, createdAt: true, googleIntegrations: true, 
        name: true, photoUrl: true, slackAccessToken: true, slackIntegrations: true, 
        slackRefreshToken: true, slackTeamId: true, slackTokenExpiry: true, slackUserId: true, updatedAt: true,
        contacts: true
    }
  });
  
  if (!user) {
    console.error(`[syncAllUserEmails] User ${userId} not found.`);
    return { success: false, allFetchedGmailMessages: [], error: 'User not found' };
  }

  if (!user.googleAccessToken || !user.googleRefreshToken || (user.googleTokenExpiry && new Date(user.googleTokenExpiry) < new Date())) {
    if (user.googleRefreshToken) {
      console.log(`[syncAllUserEmails] Attempting preemptive token refresh for user ${userId}`);
      try {
        const refreshedUser = await manuallyRefreshGoogleToken(user);
        // Re-fetch user with all includes after refresh, especially contacts
        user = await prisma.user.findUnique({ 
            where: { id: refreshedUser.id }, 
            select: { 
                id: true, email: true, googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true,
                authId: true, authProvider: true, createdAt: true, googleIntegrations: true, 
                name: true, photoUrl: true, slackAccessToken: true, slackIntegrations: true, 
                slackRefreshToken: true, slackTeamId: true, slackTokenExpiry: true, slackUserId: true, updatedAt: true,
                contacts: true
            }
        }); 
        if (!user) throw new Error("User not found after refresh attempt.");
        console.log(`[syncAllUserEmails] Token refreshed successfully for user ${userId}`);
      } catch (refreshError: unknown) {
        const e = refreshError as Error;
        console.error(`[syncAllUserEmails] Preemptive token refresh failed for user ${userId}: ${e.message}`);
        return { success: false, allFetchedGmailMessages: [], error: `Google token refresh failed: ${e.message}` };
      }
    } else {
      console.log(`[syncAllUserEmails] Google not fully authenticated for user ${userId} (missing refresh token). Skipping sync.`);
      return { success: false, allFetchedGmailMessages: [], error: 'Google not fully authenticated (no refresh token).' };
    }
  }
  if (!user.googleAccessToken) { 
      return { success: false, allFetchedGmailMessages: [], error: 'Google access token still missing after refresh attempt.' };
  }

  const oauth2Client: GoogleAuth.OAuth2Client = getOAuth2Client(user); 
  const aggregatedMessages: GmailApiMessageData[] = [];
  const detailedSyncResults = [];
  let overallSuccess = true;
  
  for (const contact of user.contacts) {
    if (contact.email) {
      const result = await syncContactEmails(user, contact.id, oauth2Client);
      detailedSyncResults.push({ 
          contactId: contact.id, 
          success: result.success, 
          count: result.processedCountAtApiLevel, // Use the API level count
          error: result.error 
      });
      if (result.success && result.fetchedGmailMessages.length > 0) {
        aggregatedMessages.push(...result.fetchedGmailMessages);
      }
      if (!result.success) {
        overallSuccess = false; // If any contact sync fails, mark overall as potentially partial
        // Decide if you want to stop all sync or continue with other contacts
        console.warn(`[syncAllUserEmails] Sync failed for contact ${contact.id}: ${result.error}`);
      }
    }
  }
  
  return { 
    success: overallSuccess, // Reflects if all contacts attempted were successful at API level
    allFetchedGmailMessages: aggregatedMessages, 
    detailedResults: detailedSyncResults 
  };
}

// Helper function to extract email content
export function extractEmailContent(message: { data: GmailMessageData }): string {
  const payload = message.data.payload;
  if (!payload) return 'No payload';
  
  const plainPart = findBodyPart(payload, 'text/plain');
  if (plainPart?.body?.data) return Buffer.from(plainPart.body.data, 'base64').toString();
  
  const htmlPart = findBodyPart(payload, 'text/html');
  if (htmlPart?.body?.data) {
    const htmlContent = Buffer.from(htmlPart.body.data, 'base64').toString();
    return stripHtmlTags(htmlContent);
  }
  
  return 'No content'
}

// Helper to find body parts
export function findBodyPart(part: EmailPayloadPart | EmailPayload | null, mimeType: string): EmailPayloadPart | null {
  if (!part) return null;
  
  if ((part as EmailPayload).mimeType === mimeType && 'body' in part && (part as EmailPayloadPart).body?.data) {
    return part as EmailPayloadPart;
  }
  
  if ((part as EmailPayloadPart).mimeType === mimeType && (part as EmailPayloadPart).body?.data) {
    return part as EmailPayloadPart;
  }
  
  if (part.parts) {
    for (const subPart of part.parts) {
      const found = findBodyPart(subPart, mimeType);
      if (found) return found;
    }
  }
  
  return null;
}

// Helper function to strip HTML tags
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

// Type helper functions for email content processing
interface EmailPayloadPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: EmailPayloadPart[] | null;
}
interface EmailPayload {
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
  body?: { data?: string | null } | null;
  parts?: EmailPayloadPart[] | null;
  mimeType?: string | null;
}
interface GmailMessageData { // More specific type for message.data
  payload?: EmailPayload | null;
  internalDate?: string | null;
  labelIds?: string[] | null;
  threadId?: string | null;
  id?: string | null;
} 