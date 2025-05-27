import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

interface IntegrationsBody {
  token: string; // Access Token
  refreshToken?: string | null; // Refresh Token is optional from Firebase client
  integrations: {
    contacts: boolean;
    gmail: boolean;
    calendar: boolean;
  };
  // expiryTime is sent by client, but we'll calculate it server-side for consistency here
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string };
    
    const body = await request.json() as IntegrationsBody;
    const { token, refreshToken, integrations } = body;

    console.log("[API /auth/save-google-integrations] Received body:", body);

    if (!token) {
      return NextResponse.json({ error: 'Missing access token' }, { status: 400 });
    }
    
    // Calculate token expiry (typically 1 hour for Google access tokens)
    const tokenExpiry = new Date(Date.now() + 3600 * 1000);
    
    await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        googleAccessToken: token,
        googleRefreshToken: refreshToken || null, // Save null if refreshToken is not provided
        googleTokenExpiry: tokenExpiry,
        googleIntegrations: integrations
      }
    });
    
    console.log(`[API /auth/save-google-integrations] Google integrations updated for user ${decoded.userId}`);
    return NextResponse.json({
      success: true,
      tokenExpiry: tokenExpiry.toISOString()
    });
  } catch (error) {
    console.error("[API /auth/save-google-integrations] Error:", error);
    return NextResponse.json(
      { error: 'Failed to save Google integrations' }, 
      { status: 500 }
    );
  }
} 