import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
// import { prisma } from '@/server/db'; // Prisma no longer directly used here
import { PlatformContact } from '@/lib/platforms/types';
import { contactUnificationService, ContactMatchScore } from '@/lib/services/contact-unification-service'; // Ensure this is the correct path

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

interface FindMatchesBatchRequestBody {
  platformContacts: PlatformContact[]; 
}

interface BatchMatchResultItem {
  inputId: string; // Original platformContact.id
  matches: ContactMatchScore[];
  error?: string; // In case processing for this specific contact failed
}

export async function POST(request: NextRequest) {
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

    const body = await request.json() as FindMatchesBatchRequestBody;
    const { platformContacts } = body;

    if (!platformContacts || !Array.isArray(platformContacts) || platformContacts.length === 0) {
      return NextResponse.json({ error: 'Invalid or empty platformContacts array provided' }, { status: 400 });
    }

    const results: BatchMatchResultItem[] = [];

    for (const pc of platformContacts) {
      if (!pc || !pc.id || !pc.name) {
        results.push({ inputId: pc?.id || 'unknown', matches: [], error: 'Invalid platformContact data in batch' });
        continue;
      }
      try {
        const potentialMatches = await contactUnificationService.findContactMatches(pc, userId);
        results.push({ inputId: pc.id, matches: potentialMatches });
      } catch (error: unknown) {
        const e = error as Error;
        console.error(`[API /contacts/find-matches] Error processing contact ${pc.id} in batch:`, e.message);
        results.push({ inputId: pc.id, matches: [], error: e.message || 'Failed to find matches for this contact' });
      }
    }
    
    return NextResponse.json({ results });

  } catch (error) {
    console.error('[API /contacts/find-matches] Critical batch error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown critical error';
    return NextResponse.json({ error: `Failed to process batch find matches: ${errorMessage}` }, { status: 500 });
  }
} 