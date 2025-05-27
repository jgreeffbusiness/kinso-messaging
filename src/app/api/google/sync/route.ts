import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'
import { getOAuth2Client, manuallyRefreshGoogleToken } from '@/server/services/gmail'
import { google, Auth, gmail_v1 } from 'googleapis'
import type { User } from '@prisma/client'

// JWT secret should be in env vars
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
// const GOOGLE_PEOPLE_API = 'https://people.googleapis.com/v1/people/me/connections'
// const GOOGLE_GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// Removed unused SafeGoogleMessage interface
// interface SafeGoogleMessage {
//   id: string; 
//   threadId: string;
// }

async function syncUserContacts(userInstance: User, _oauth2Client: Auth.OAuth2Client) {
  console.log(`Simulating contact sync for user ${userInstance.id} using provided OAuth client.`)
  // Example: const people = google.people({ version: 'v1', auth: oauth2Client })
  // const response = await people.people.connections.list(...)
  return { added: 0, updated: 0 }
}

async function syncContactEmailsWithRefresh(userInstance: User, initialOAuth2Client: Auth.OAuth2Client) {
  let oauth2Client = initialOAuth2Client
  const contacts = await prisma.contact.findMany({
    where: { userId: userInstance.id, email: { not: null } },
    select: { id: true, email: true }
  })

  const emailToContactMap = new Map<string, string>()
  for (const contact of contacts) {
    if (contact.email) emailToContactMap.set(contact.email, contact.id)
  }

  let totalEmailsProcessed = 0
  let gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  for (const [email, contactId] of emailToContactMap.entries()) {
    const searchQuery = encodeURIComponent(`from:${email} OR to:${email}`)
    try {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: searchQuery,
        maxResults: 50
      })
      
      const messages = response.data.messages || []
      if (messages.length === 0) continue

      const emailEntries = messages
        .filter(msg => msg.id && msg.threadId) // Ensure id and threadId are present
        .map((message: gmail_v1.Schema$Message) => ({
          contactId,
          userId: userInstance.id,
          messageId: message.id!,
          threadId: message.threadId!,
        }))
      if(emailEntries.length > 0) {
        await prisma.contactMessage.createMany({ data: emailEntries, skipDuplicates: true })
        totalEmailsProcessed += emailEntries.length
      }

    } catch (error: unknown) {
      const e = error as { code?: number; message?: string }
      if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('Token has been expired')) {
        console.log(`Gmail API auth error for ${email}. Attempting refresh for user ${userInstance.id}.`)
        try {
          const refreshedUser = await manuallyRefreshGoogleToken(userInstance)
          userInstance = refreshedUser // Update userInstance with new tokens for subsequent internal use if any
          oauth2Client = getOAuth2Client(refreshedUser)
          gmail = google.gmail({ version: 'v1', auth: oauth2Client })

          console.log('Retrying Gmail API call after refresh...')
          const retryResponse = await gmail.users.messages.list({
            userId: 'me',
            q: searchQuery,
            maxResults: 50
          })
          const retryMessages = retryResponse.data.messages || []
          if (retryMessages.length === 0) continue

          const retryEmailEntries = retryMessages
            .filter(msg => msg.id && msg.threadId)
            .map((message: gmail_v1.Schema$Message) => ({ 
              contactId, 
              userId: userInstance.id, 
              messageId: message.id!, 
              threadId: message.threadId! 
            }))
          if (retryEmailEntries.length > 0) {
            await prisma.contactMessage.createMany({ data: retryEmailEntries, skipDuplicates: true })
            totalEmailsProcessed += retryEmailEntries.length
          }
        } catch (refreshError: unknown) {
          const rErr = refreshError as { message?: string }
          console.error(`Failed to refresh token or retry for ${email}: ${rErr.message}`)
          break
        }
      } else {
        console.error(`Failed to fetch emails for ${email} (non-auth error): ${e.message}`)
      }
    }
  }
  return { associated: totalEmailsProcessed }
}

export async function POST(request: Request) {
  try {
    // Get session cookie
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Verify the token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    
    // Fetch user data
    let user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    })
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }
    
    // Initial check of token validity before attempting any operation
    if (!user.googleAccessToken || !user.googleRefreshToken || (user.googleTokenExpiry && new Date(user.googleTokenExpiry) < new Date())) {
        // Attempt a preemptive refresh if tokens exist but might be expired
        if (user.googleRefreshToken) {
            try {
                console.log("Preemptive Google token refresh attempt on sync endpoint...")
                const refreshedUser = await manuallyRefreshGoogleToken(user)
                user = refreshedUser // Update user object with new tokens
            } catch (refreshError: unknown) {
                const rErr = refreshError as { message?: string }
                console.error("Preemptive refresh failed:", rErr.message)
                return NextResponse.json({ error: 'Google authorization expired. Please reconnect.', reconnectRequired: true }, { status: 401 })
            }
        } else {
            return NextResponse.json({ error: 'Google not fully authenticated. Please connect/reconnect.', reconnectRequired: true }, { status: 401 })
        }
    }
    
    // Get sync options from request
    const { syncContacts, syncEmails } = await request.json()
    
    // Check if integrations are enabled
    const integrations = (user.googleIntegrations as Record<string, boolean>) || {}
    
    let contactsAdded = 0
    let emailsAssociated = 0
    
    const oauth2Client = getOAuth2Client(user)

    if (syncContacts && integrations.contacts) {
      try {
        const contactsResult = await syncUserContacts(user, oauth2Client)
        contactsAdded = contactsResult.added
      } catch (contactError: unknown) {
        console.error("Error during syncUserContacts:", contactError)
      }
    }
    
    if (syncEmails && integrations.gmail) {
      const emailsResult = await syncContactEmailsWithRefresh(user, oauth2Client)
      emailsAssociated = emailsResult.associated
    }
    
    return NextResponse.json({
      success: true,
      contactsAdded,
      emailsAssociated
    })
    
  } catch (error) {
    const e = error as { message?: string }
    console.error('Google Sync API error:', e.message)
    return NextResponse.json({ error: `Failed to sync Google data: ${e.message || 'Unknown error'}` }, { status: 500 })
  }
} 