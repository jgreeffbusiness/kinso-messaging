import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'
import { getUnifiedMessageService } from '@/lib/services/unified-message-service'
import { manuallyRefreshGoogleToken } from '@/server/services/gmail'
import type { User } from '@prisma/client'
import type { PlatformSyncResult } from '@/lib/platforms/types'

// JWT secret should be in env vars
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
// const GOOGLE_PEOPLE_API = 'https://people.googleapis.com/v1/people/me/connections'
// const GOOGLE_GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// Removed unused SafeGoogleMessage interface
// interface SafeGoogleMessage {
//   id: string; 
//   threadId: string;
// }

// Removed syncUserContacts and syncContactEmailsWithRefresh as they are no longer used by this refactored route.
// Their functionality is now handled by UnifiedMessageService -> EmailAdapter -> updated gmail.ts service.

export async function POST(request: NextRequest) {
  console.log('[API /google/sync] Received sync request')
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    const userId = decoded.userId
    
    let user = await prisma.user.findUnique({
      where: { id: userId },
      // Ensure all necessary fields for manuallyRefreshGoogleToken are selected
      select: { 
          id: true, email: true, googleAccessToken: true, googleRefreshToken: true, googleTokenExpiry: true,
          googleIntegrations: true // For checking if gmail integration is enabled
          // Add any other fields from User model that might be needed by manuallyRefreshGoogleToken
      }
    })
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }
    console.log(`[API /google/sync] Processing for userId: ${userId}`)
    
    if (!user.googleAccessToken || !user.googleRefreshToken || (user.googleTokenExpiry && new Date(user.googleTokenExpiry) < new Date())) {
        if (user.googleRefreshToken) {
            try {
                console.log("[API /google/sync] Preemptive Google token refresh attempt...")
                // Cast to User if the select statement makes `user` not directly assignable to User type expected by manuallyRefreshGoogleToken
                const refreshedUser = await manuallyRefreshGoogleToken(user as User)
                user = { ...user, ...refreshedUser } // Merge refreshed tokens into the user object we are working with
            } catch (refreshError: unknown) {
                const rErr = refreshError as Error
                console.error("[API /google/sync] Preemptive refresh failed:", rErr.message)
                return NextResponse.json({ error: 'Google authorization expired. Please reconnect.', reconnectRequired: true }, { status: 401 })
            }
        } else {
            return NextResponse.json({ error: 'Google not fully authenticated. Please connect/reconnect.', reconnectRequired: true }, { status: 401 })
        }
    }
    if (!user.googleAccessToken) { 
        console.error("[API /google/sync] Google access token still missing after refresh attempt for user:", userId)
        return NextResponse.json({ error: 'Google access token invalid after refresh. Please reconnect.', reconnectRequired: true }, { status: 401 })
    }
    
    const requestBody = await request.json().catch(() => ({})) 
    const syncEmails = typeof requestBody.syncEmails === 'boolean' ? requestBody.syncEmails : true // Default to true if not specified

    const integrations = (user.googleIntegrations as Record<string, boolean>) || {}
    let emailSyncResult: PlatformSyncResult | null = null
    const contactsSyncResult = { added: 0, success: true, errors: [] }

    if (syncEmails && integrations.gmail) {
        console.log(`[API /google/sync] Triggering email sync for user ${user.id} via UnifiedMessageService`)
        const unifiedMessageService = getUnifiedMessageService()
        try {
            emailSyncResult = await unifiedMessageService.syncPlatform(user.id, 'email')
            console.log(`[API /google/sync] Email sync result:`, emailSyncResult)
        } catch (umsError: unknown) {
            const e = umsError as Error
            console.error(`[API /google/sync] Error calling UnifiedMessageService for email sync: ${e.message}`, e.stack)
            emailSyncResult = { success: false, messagesProcessed: 0, newMessages: 0, errors: [e.message || 'UMS email sync failed'] }
        }
    } else if (syncEmails && !integrations.gmail) {
        console.log(`[API /google/sync] Gmail integration not enabled for user ${user.id}. Skipping email sync.`)
        emailSyncResult = { success: true, messagesProcessed: 0, newMessages: 0, errors: ["Gmail integration not enabled."] }
    }
    
    return NextResponse.json({
      success: emailSyncResult ? emailSyncResult.success && contactsSyncResult.success : contactsSyncResult.success, 
      contactsAdded: contactsSyncResult.added, 
      emailsAssociated: emailSyncResult ? emailSyncResult.newMessages : 0, 
      errors: [...(emailSyncResult?.errors || []), ...contactsSyncResult.errors]
    })
    
  } catch (error: unknown) {
    const e = error as Error
    console.error('[API /google/sync] Overall error:', e.message, e.stack)
    const errorMsg = e.message?.includes('reconnect') ? e.message : `Failed to sync Google data: ${e.message || 'Unknown error'}`
    const reconnect = e.message?.includes('reconnect')
    return NextResponse.json({ error: errorMsg, success: false, reconnectRequired: reconnect }, { status: 500 })
  }
} 