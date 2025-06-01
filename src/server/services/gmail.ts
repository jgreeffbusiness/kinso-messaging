import { google, Auth as GoogleAuth } from 'googleapis'
import { prisma } from '@server/db'
import type { User } from '@prisma/client'
import { Prisma } from '@prisma/client'
import {
  createOAuth2Client,
  manuallyRefreshGoogleToken,
  ensureValidAccessToken,
} from './gmailAuth'
// import { getUnifiedMessageService } from '@/lib/services/unified-message-service'
// import { EmailAdapter } from '@/lib/platforms/adapters/email'

// OAuth client helpers are in gmailAuth.ts
export { createOAuth2Client as getOAuth2Client, manuallyRefreshGoogleToken } from './gmailAuth'

// Helper type for raw Gmail message data from API
export interface GmailApiMessageData { 
  id: string | null | undefined;
  threadId: string | null | undefined;
  internalDate?: string | null | undefined;
  payload?: any; // Keeping it simple for now, can be typed further based on EmailPayload from gmail.ts
  labelIds?: string[] | null | undefined;
  snippet?: string | null | undefined;
  // Add other fields you might use from messageDetails.data
}

export async function syncContactEmails(user: User, contactId: string, initialOAuth2Client: GoogleAuth.OAuth2Client, since?: Date): Promise<{
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
  const sinceQuery = since ? ` after:${since.toISOString().split('T')[0].replace(/-/g,'/')}` : '';
  console.log(`[syncContactEmails] Syncing for contact ${contactEmailForSearch} (ID: ${contactId}) for user ${user.id}${sinceQuery ? ' since ' + sinceQuery.trim().split(':')[1] : ''}`);
  const searchQuery = `(from:${contactEmailForSearch} OR to:${contactEmailForSearch})${sinceQuery}`;
  
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

export async function syncAllUserEmails(userId: string, since?: Date): Promise<{
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

  try {
    user = await ensureValidAccessToken(user);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Google token error';
    console.error(`[syncAllUserEmails] ${message}`);
    return { success: false, allFetchedGmailMessages: [], error: message };
  }

  const oauth2Client: GoogleAuth.OAuth2Client = getOAuth2Client(user); 
  const aggregatedMessages: GmailApiMessageData[] = [];
  const detailedSyncResults = [];
  let overallSuccess = true;
    
    for (const contact of user.contacts) {
      if (contact.email) {
      // Pass the 'since' date to syncContactEmails
      const result = await syncContactEmails(user, contact.id, oauth2Client, since);
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