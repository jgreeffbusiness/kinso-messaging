import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import { prisma } from '@/server/db'; // For user validation/auth if needed beyond JWT
import { PlatformContact } from '@/lib/platforms/types';
import { SlackAdapter } from '@/lib/platforms/adapters/slack';
// Assuming Google People API logic might be refactored into a GoogleContactsAdapter similar to SlackAdapter
// For now, we might reuse logic from existing Google contacts routes or build it here.
import { google } from 'googleapis';
import { getOAuth2Client, manuallyRefreshGoogleToken } from '@/server/services/gmail'; // For Google Auth and manuallyRefreshGoogleToken

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

interface GetParams {
  params: {
    platformName: string;
  };
}

export async function GET(request: NextRequest, { params }: GetParams) {
  let platformNameForErrorLogging = 'unknown platform'; // For outer catch block
  try {
    const { platformName } = params; 
    platformNameForErrorLogging = platformName; // Set it once params are accessed

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string };
    const userId = decoded.userId;

    if (!userId) {
      return NextResponse.json({ error: 'User ID not found' }, { status: 401 });
    }

    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found in DB' }, { status: 404 });
    }

    let fetchedContacts: PlatformContact[] = [];

    if (platformName === 'google') {
      if (!user.googleAccessToken || !user.googleRefreshToken) {
        return NextResponse.json({ error: 'Google not authenticated. Please connect your Google account.', reconnectRequired: true }, { status: 403 });
      }

      let oauth2Client = getOAuth2Client(user);
      let people = google.people({ version: 'v1', auth: oauth2Client });
      let googleApiResponse;

      try {
        googleApiResponse = await people.people.connections.list({
          resourceName: 'people/me',
          pageSize: 200, 
          personFields: 'names,emailAddresses,phoneNumbers,photos',
        });
      } catch (error: unknown) {
        const gError = error as { code?: number; message?: string };
        if (gError.code === 401 || gError.message?.includes('invalid_grant') || gError.message?.includes('Token has been expired') || gError.message?.includes('token has been revoked')) {
          console.log(`Google API auth error for user ${user.id}. Attempting manual token refresh.`);
          try {
            const refreshedUser = await manuallyRefreshGoogleToken(user); 
            user = refreshedUser;
            oauth2Client = getOAuth2Client(refreshedUser); 
            people = google.people({ version: 'v1', auth: oauth2Client });

            console.log(`Retrying Google API request for user ${user.id} with refreshed token.`);
            googleApiResponse = await people.people.connections.list({
              resourceName: 'people/me',
              pageSize: 200,
              personFields: 'names,emailAddresses,phoneNumbers,photos',
            });
          } catch (refreshError: unknown) {
            const rError = refreshError as { message?: string };
            console.error(`Manual Google token refresh failed for user ${user.id}:`, rError.message);
            return NextResponse.json({ 
              error: rError.message || 'Google authentication expired. Please reconnect your Google account.',
              reconnectRequired: true 
            }, { status: 401 }); 
          }
        } else {
          throw error; 
        }
      }

      const connections = googleApiResponse?.data?.connections || [];
      fetchedContacts = connections.map((person): PlatformContact => {
        return {
          id: person.resourceName || 'unknown-' + Math.random(), 
          name: person.names?.[0]?.displayName || 'Unnamed Contact',
          email: person.emailAddresses?.[0]?.value || undefined,
          avatar: person.photos?.[0]?.url || undefined,
          handle: undefined, 
          platformSpecific: {
            source: 'google', // Ensure source is set for the modal
            googleId: person.resourceName,
            phoneNumbers: person.phoneNumbers?.map(p => p.value).filter(Boolean) as string[] | undefined,
          }
        };
      }).filter(c => c.name !== 'Unnamed Contact');

    } else if (platformName === 'slack') {
      const slackAdapter = new SlackAdapter();
      if (!user.slackAccessToken) { 
        return NextResponse.json({ error: 'Slack not authenticated. Please connect your Slack account.', reconnectRequired: true }, { status: 403 });
      }
      try {
        fetchedContacts = await slackAdapter.fetchContacts(userId);
        fetchedContacts = fetchedContacts.map(c => ({...c, platformSpecific: {...c.platformSpecific, source: 'slack'}}));
      } catch (slackError: unknown) {
        const e = slackError as { isRateLimitError?: boolean; message?: string };
        if (e.isRateLimitError) {
          console.warn(`[API /contacts/fetch-platform/slack] Slack rate limit hit for user ${userId}: ${e.message}`);
          return NextResponse.json({
            contacts: [], // Return empty contacts or any fetched before error, if applicable by adapter
            error: 'Slack API is temporarily busy due to high request volume. Some Slack contacts may not be available. Please try again in a few minutes.',
            rateLimited: true,
            platform: 'slack'
          }, { status: 429 }); // HTTP 429 Too Many Requests
        } else {
          // Re-throw other Slack errors to be caught by the main catch block
          console.error(`[API /contacts/fetch-platform/slack] Non-rate-limit error for user ${userId}: ${e.message}`);
          throw slackError;
        }
      }
    } else {
      return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 });
    }

    return NextResponse.json({ contacts: fetchedContacts });

  } catch (error: unknown) {
    const e = error as { message?: string, stack?: string };
    console.error(`[API /contacts/fetch-platform] Error fetching ${platformNameForErrorLogging} contacts:`, e.message, e.stack);
    const errorMessage = e.message || 'Unknown error';
    return NextResponse.json({ error: `Failed to fetch ${platformNameForErrorLogging} contacts: ${errorMessage}` }, { status: 500 });
  }
} 