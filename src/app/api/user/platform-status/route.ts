import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import { prisma } from '@/server/db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

interface PlatformStatus {
  connected: boolean;
  needsAction?: boolean; // e.g., token expired, needs re-auth
  message?: string;
  // Potentially add lastSync, other relevant info if needed by UI
}

interface UserPlatformStatuses {
  google?: PlatformStatus;
  slack?: PlatformStatus;
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string };
    const userId = decoded.userId;

    if (!userId) {
      return NextResponse.json({ error: 'User ID not found in session' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true, // Important for checking if initial setup was done
        googleTokenExpiry: true,
        // googleIntegrations: true, // Could check specific integrations if needed
        slackAccessToken: true,
        // slackIntegrations: true,
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const statuses: UserPlatformStatuses = {};

    // Google Status
    const hasGoogleAccessToken = !!user.googleAccessToken;
    const isGoogleTokenExpired = user.googleTokenExpiry ? new Date(user.googleTokenExpiry) < new Date() : true; // Expired if no expiry date or past
    
    const googleEffectivelyConnected = hasGoogleAccessToken && !isGoogleTokenExpired;
    let googleNeedsAction = false;
    let googleMessage = '';

    if (googleEffectivelyConnected) {
      googleMessage = 'Connected';
      if (!user.googleRefreshToken) {
        // Optional: could set needsAction to true if a refresh token is desired for long-term server sync
        // googleNeedsAction = true;
        // googleMessage = 'Connected (session may be short-lived without full offline access setup)';
      }
    } else if (hasGoogleAccessToken && isGoogleTokenExpired) {
      googleNeedsAction = true;
      googleMessage = 'Session expired. Reconnecting may be needed.'; 
    } else { // No access token or other issues
      googleNeedsAction = true;
      googleMessage = 'Not connected. Click to authenticate.';
    }

    statuses.google = {
      connected: googleEffectivelyConnected,
      needsAction: googleNeedsAction,
      message: googleMessage
    };

    // Slack Status
    const slackConnected = !!user.slackAccessToken;
    statuses.slack = {
      connected: slackConnected,
      needsAction: !slackConnected,
      message: slackConnected ? 'Connected' : 'Not connected. Click to authenticate.'
    };

    return NextResponse.json(statuses);

  } catch (error) {
    console.error('[API /user/platform-status] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to fetch platform statuses: ${errorMessage}` }, { status: 500 });
  }
} 