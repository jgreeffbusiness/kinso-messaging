import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import { syncStateManager } from '@/lib/services/sync-state-manager';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export async function POST(request: NextRequest) {
  try {
    // 1. Verify user authentication (ensure this is a logged-in user action)
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

    // 2. Determine which platform to reset (or all)
    // For now, let's allow specifying a platform, or reset all if none specified.
    // We can make this a POST request that accepts a body like { platform: 'gmail' }
    // Or, for simplicity in a one-off debug, just reset both.
    
    console.log(`[Debug API] Attempting to reset sync state for user: ${userId}`);

    // Reset Gmail sync state
    await syncStateManager.resetSyncState(userId, 'gmail');
    console.log(`[Debug API] Gmail sync state reset for user: ${userId}`);

    // Optionally, reset Slack sync state too if needed
    await syncStateManager.resetSyncState(userId, 'slack');
    console.log(`[Debug API] Slack sync state reset for user: ${userId}`);

    return NextResponse.json({
      success: true,
      message: `Sync states for Gmail and Slack have been reset for user ${userId}.`,
    });

  } catch (error) {
    console.error('[Debug API] Error resetting sync state:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to reset sync state', details: errorMessage },
      { status: 500 }
    );
  }
}

// It's good practice to also add a GET handler for debug routes 
// that explains what the POST endpoint does, or just returns a 405 Method Not Allowed.
export async function GET() {
  return NextResponse.json(
    { message: 'Use POST to reset sync states for the authenticated user.' }, 
    { status: 405 }
  );
} 