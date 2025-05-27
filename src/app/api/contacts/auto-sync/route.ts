import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import { prisma } from '@/server/db';
import { PlatformContact } from '@/lib/platforms/types';
import { contactUnificationService } from '@/lib/services/contact-unification-service';
import { SlackAdapter } from '@/lib/platforms/adapters/slack';
import { getOAuth2Client, manuallyRefreshGoogleToken } from '@/server/services/gmail';
import { google } from 'googleapis';
import type { User } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

interface AutoSyncRequestBody {
  platforms: Array<'google' | 'slack'>;
}

async function fetchPlatformContacts(platformName: string, user: User): Promise<PlatformContact[]> {
  let fetchedContacts: PlatformContact[] = [];
  let platformKeyForSource = 'unknown';

  if (platformName === 'google') {
    platformKeyForSource = 'google';
    if (!user.googleAccessToken || !user.googleRefreshToken) {
      console.warn(`[AutoSync] Google not fully authenticated for user ${user.id}. Skipping Google sync.`);
      // Optionally throw an error that can be caught and reported per platform
      throw new Error('Google not authenticated. Please reconnect.'); 
    }
    const initialOAuth2Client = getOAuth2Client(user);
    const initialPeopleService = google.people({ version: 'v1', auth: initialOAuth2Client });
    try {
      const response = await initialPeopleService.people.connections.list({
        resourceName: 'people/me',
        pageSize: 500,
        personFields: 'names,emailAddresses,phoneNumbers,photos,metadata'
      });
      const connections = response.data.connections || [];
      fetchedContacts = connections.map((person): PlatformContact => ({
        id: person.metadata?.sources?.find(s => s.type === 'CONTACT')?.id || person.resourceName || 'google-' + Math.random(), // Prefer contact source ID
        name: person.names?.[0]?.displayName || 'Unnamed Contact',
        email: person.emailAddresses?.[0]?.value || undefined,
        avatar: person.photos?.[0]?.url || undefined,
        platformSpecific: { source: platformKeyForSource, googleId: person.resourceName, raw: person }, // Store raw person for future use
      })).filter(c => c.name !== 'Unnamed Contact');
    } catch (error: unknown) {
      const e = error as { code?: number; message?: string };
      if (e.code === 401 || e.message?.includes('invalid_grant')) {
        console.log(`[AutoSync] Google auth error for ${user.id}. Attempting refresh.`);
        try {
          const refreshedUser = await manuallyRefreshGoogleToken(user as User);
          user = await prisma.user.findUnique({where: {id: refreshedUser.id}}) as User;
          const refreshedOAuth2Client = getOAuth2Client(user);
          const refreshedPeopleService = google.people({ version: 'v1', auth: refreshedOAuth2Client });
          const retryResponse = await refreshedPeopleService.people.connections.list({
            resourceName: 'people/me',
            pageSize: 500,
            personFields: 'names,emailAddresses,phoneNumbers,photos,metadata'
          });
          const connections = retryResponse.data.connections || [];
          fetchedContacts = connections.map((person): PlatformContact => ({
            id: person.metadata?.sources?.find(s => s.type === 'CONTACT')?.id || person.resourceName || 'google-' + Math.random(),
            name: person.names?.[0]?.displayName || 'Unnamed Contact',
            email: person.emailAddresses?.[0]?.value || undefined,
            avatar: person.photos?.[0]?.url || undefined,
            platformSpecific: { source: platformKeyForSource, googleId: person.resourceName, raw: person },
          })).filter(c => c.name !== 'Unnamed Contact');
        } catch (refreshError: unknown) {
          console.error(`[AutoSync] Google refresh failed for ${user.id}: ${(refreshError as Error).message}`);
          throw new Error('Google token refresh failed. Please reconnect.');
        }
      } else {
        throw error; // Re-throw other errors
      }
    }
  } else if (platformName === 'slack') {
    platformKeyForSource = 'slack';
    if (!user.slackAccessToken) {
      console.warn(`[AutoSync] Slack not authenticated for user ${user.id}. Skipping Slack sync.`);
      throw new Error('Slack not authenticated. Please reconnect.');
    }
    const slackAdapter = new SlackAdapter();
    try {
      fetchedContacts = await slackAdapter.fetchContacts(user.id);
    } catch (slackError: unknown) {
      const e = slackError as {isRateLimitError?: boolean; message?: string};
      if (e.isRateLimitError) {
          throw new Error('Slack API rate limit hit. Try again later.');
      }
      throw slackError;
    }
  }
  // Ensure platformSpecific.source is set correctly from platformKeyForSource if not done by adapter
  return fetchedContacts.map(c => ({...c, platformSpecific: {...c.platformSpecific, source: platformKeyForSource}}));
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string };
    const userId = decoded.userId;
    if (!userId) return NextResponse.json({ error: 'User ID not found' }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const body = await request.json() as AutoSyncRequestBody;
    const { platforms } = body;
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json({ error: 'No platforms specified for sync' }, { status: 400 });
    }

    let totalProcessed = 0, totalAutoMerged = 0, totalAutoCreated = 0, totalFlagged = 0, totalErrors = 0;
    const platformResults: Record<string, {status: string, message?: string, processed?: number, merged?: number, created?: number, flagged?: number, error?: string}> = {};

    for (const platformName of platforms) {
      const platformKey = formatPlatformName(platformName); // Normalize e.g. 'google-contacts' to 'google'
      try {
        console.log(`[AutoSync] Starting sync for ${platformName} for user ${userId}`);
        const platformContacts = await fetchPlatformContacts(platformName, user as User); // Cast user
        platformResults[platformName] = { status: 'processing', processed: platformContacts.length };
        console.log(`[AutoSync] Fetched ${platformContacts.length} contacts from ${platformName}`);

        let currentPlatformMerged = 0, currentPlatformCreated = 0, currentPlatformFlagged = 0;
        for (const pc of platformContacts) {
          const result = await contactUnificationService.autoProcessPlatformContact(pc, platformKey, userId);
          totalProcessed++;
          if (result.action === 'auto_merged') { totalAutoMerged++; currentPlatformMerged++; }
          else if (result.action === 'auto_created_new') { totalAutoCreated++; currentPlatformCreated++; }
          else if (result.action === 'flagged_for_review') { totalFlagged++; currentPlatformFlagged++; }
          else if (result.action === 'definitive_link_exists') { /* Count as processed, but not new/merged */ }
          // Log other actions like auto_created_new_dup_flag_failed
        }
        platformResults[platformName] = {
            status: 'completed',
            processed: platformContacts.length,
            merged: currentPlatformMerged,
            created: currentPlatformCreated,
            flagged: currentPlatformFlagged
        };
        console.log(`[AutoSync] Finished processing ${platformName} for user ${userId}`);
      } catch (error: unknown) {
        const e = error as Error;
        console.error(`[AutoSync] Error syncing ${platformName} for user ${userId}: ${e.message}`);
        platformResults[platformName] = { status: 'failed', error: e.message };
        totalErrors++;
      }
    }

    const summary = {
        message: totalErrors === platforms.length ? "All platform syncs failed." : totalErrors > 0 ? "Some platform syncs encountered errors." : "Sync process completed.",
        totalProcessed, totalAutoMerged, totalAutoCreated, totalFlagged, totalErrors,
        platformResults
    };
    console.log("[AutoSync] Summary:", summary);
    return NextResponse.json(summary, { status: totalErrors > 0 && totalErrors === platforms.length ? 500 : totalErrors > 0 ? 207 : 200 });

  } catch (error: unknown) {
    const e = error as Error;
    console.error('[AutoSync] Critical error:', e.message);
    return NextResponse.json({ error: `Auto-sync failed: ${e.message}` }, { status: 500 });
  }
}

// Helper to normalize platform name, ensure it's available
const formatPlatformName = (source?: string): string => {
  if (!source) return 'unknown';
  const lowerSource = source.toLowerCase();
  if (lowerSource.includes('google')) return 'google';
  if (lowerSource.includes('slack')) return 'slack';
  return lowerSource.replace(/_webhook_message|_contact_import|_contacts|_contact/gi, '').replace(/_/g, ' ').trim() || 'unknown';
}; 