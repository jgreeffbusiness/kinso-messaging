import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
// import { prisma } from '@/server/db'; // Not directly used
// import { PlatformContact } from '@/lib/platforms/types'; // Not directly used
import { contactUnificationService } from '@/lib/services/contact-unification-service';
import { UserContactDecision } from '@/components/SyncContactsPlatformModal'; // Import the decision type

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

interface FinalizeImportRequestBody {
  decisions: UserContactDecision[];
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

    const body = await request.json() as FinalizeImportRequestBody;
    const { decisions } = body;

    if (!decisions || !Array.isArray(decisions)) {
      return NextResponse.json({ error: 'Invalid decisions data provided' }, { status: 400 });
    }

    let importedCount = 0;
    let mergedCount = 0;
    let skippedCount = 0;
    const errors: { platformContactName?: string, error: string }[] = [];

    for (const decision of decisions) {
      try {
        let platformName = 'unknown';
        const source = decision.platformContactData.platformSpecific?.source;
        if (typeof source === 'string') {
          platformName = source.replace('_webhook_message', '').replace('_contact_import', '');
        } else if (decision.platformContactData.platformSpecific?.platform && typeof decision.platformContactData.platformSpecific.platform === 'string') {
          platformName = decision.platformContactData.platformSpecific.platform.replace('_webhook_message', '').replace('_contact_import', '');
        }
        
        if (decision.decision === 'new') {
          await contactUnificationService.createUnifiedContact(decision.platformContactData, platformName, userId);
          importedCount++;
        } else if (decision.decision === 'merge' && decision.mergeTargetId) {
          await contactUnificationService.addPlatformIdentity(decision.mergeTargetId, decision.platformContactData, platformName);
          mergedCount++;
        } else if (decision.decision === 'skip') {
          skippedCount++;
        } else {
          // Should not happen if UI sends correct decisions
          console.warn('Unknown decision type or missing mergeTargetId:', decision);
        }
      } catch (error) {
        console.error(`Error processing decision for ${decision.platformContactData.name}:`, error);
        errors.push({ 
          platformContactName: decision.platformContactData.name, 
          error: error instanceof Error ? error.message : 'Unknown processing error' 
        });
      }
    }

    const resultMessage = `Import finalized: ${importedCount} new, ${mergedCount} merged, ${skippedCount} skipped. ${errors.length} errors.`;
    console.log(`[API /contacts/finalize-import] ${resultMessage}`);

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        message: resultMessage,
        imported: importedCount,
        merged: mergedCount,
        skipped: skippedCount,
        errors
      }, { status: 207 }); // Multi-Status for partial success
    }

    return NextResponse.json({
      success: true,
      message: resultMessage,
      imported: importedCount,
      merged: mergedCount,
      skipped: skippedCount,
    });

  } catch (error) {
    console.error('[API /contacts/finalize-import] Critical Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown critical error';
    return NextResponse.json({ error: `Failed to finalize import: ${errorMessage}` }, { status: 500 });
  }
} 