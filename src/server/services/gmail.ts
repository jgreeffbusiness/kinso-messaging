import { google } from 'googleapis'
import { prisma } from '@server/db'
import type { User } from '@prisma/client'
import { processEmailContent } from '@/lib/email-processor'

// Create a single function to handle OAuth client creation with auto-refresh capability
const createOAuth2ClientWithAutoRefresh = (user: User) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
  
  // Set initial credentials
  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
    expiry_date: user.googleTokenExpiry ? new Date(user.googleTokenExpiry).getTime() : undefined
  })
  
  // Add token refresh handler
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      // Only update if we got a new refresh token
      await prisma.user.update({
        where: { id: user.id },
        data: {
          googleAccessToken: tokens.access_token,
          googleRefreshToken: tokens.refresh_token,
          googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined
        }
      })
    } else if (tokens.access_token) {
      // Just update the access token and expiry
      await prisma.user.update({
        where: { id: user.id },
        data: {
          googleAccessToken: tokens.access_token,
          googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined
        }
      })
    }
    console.log(`Refreshed Google token for user ${user.id}`)
  })
  
  return oauth2Client
}

// This replaces both your original functions
export const getOAuth2Client = createOAuth2ClientWithAutoRefresh

// Manual refresh function (for cases where auto-refresh fails)
export async function manuallyRefreshGoogleToken(user: User) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
  
  oauth2Client.setCredentials({
    refresh_token: user.googleRefreshToken
  })
  
  try {
    const { credentials } = await oauth2Client.refreshAccessToken()
    
    // Update user in database with new tokens
    return await prisma.user.update({
      where: { id: user.id },
      data: {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: new Date(credentials.expiry_date)
      }
    })
  } catch (error) {
    console.error('Manual token refresh failed:', error)
    
    // Mark user's Google integration as requiring re-authentication
    await prisma.user.update({
      where: { id: user.id },
      data: {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
        googleIntegrations: null
      }
    })
    
    throw new Error('Google authentication expired. Please reconnect your Google account.')
  }
}

export async function syncContactEmails(userId: string, contactId: string) {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: userId } 
    })

    if (!user?.googleAccessToken) {
      return { success: false, error: 'Google authentication expired. Please reconnect your account.' }
    }
    
    const contact = await prisma.contact.findUnique({
      where: { id: contactId, userId }
    })
    
    if (!contact || !contact.email) {
      throw new Error('Contact has no email')
    }
    
    const oauth2Client = getOAuth2Client(user)
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    
    // Correct search query format for Gmail API
    const searchQuery = contact.email ? 
      `from:${contact.email.trim()} OR to:${contact.email.trim()}` : 
      ''
    
    // Log the query for debugging
    console.log(`Search query for ${contact.id}: ${searchQuery}`)
    
    // Skip if no email to search for
    if (!contact.email || contact.email.trim() === '') {
      console.log(`Skipping contact ${contact.id}, no valid email address`)
      return { success: true, count: 0 }
    }
    
    try {
      console.log(`Searching Gmail with query: ${searchQuery}`)
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: searchQuery,
        maxResults: 100
      })
      console.log(response)
      
      if (!response.data.messages || response.data.messages.length === 0) {
        console.log(`No messages found for contact ${contact.id}`)
        return { success: true, count: 0 }
      }
      
      console.log(`Found ${response.data.messages.length} messages for contact ${contact.id}`)
      
      let importedCount = 0
      
      // Process each message
      for (const { id: gmailId } of response.data.messages) {
        // Check if we already have this message
        const existingMessage = await prisma.message.findFirst({
          where: { 
            userId, 
            contactId,
            platform: 'gmail',
            platformMessageId: gmailId as string
          }
        })
        
        if (existingMessage) continue
        
        // Get full message details
        const messageDetails = await gmail.users.messages.get({
          userId: 'me',
          id: gmailId
        })
        
        const headers = messageDetails.data.payload.headers
        const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)'
        const timestamp = new Date(parseInt(messageDetails.data.internalDate))
        
        // Determine direction (inbound/outbound)
        const from = headers.find(h => h.name === 'From')?.value || ''
        const direction = from.includes(contact.email) ? 'inbound' : 'outbound'
        
        // Extract message content directly
        const rawMessageContent = extractEmailContent(messageDetails)
        
        // Process email with AI to clean content and extract insights
        let processedEmail = null
        let finalContent = rawMessageContent
        let enhancedPlatformData = {
          subject,
          direction,
          from,
          to: headers.find(h => h.name === 'To')?.value?.split(',').map(e => e.trim()) || [],
          cc: headers.find(h => h.name === 'Cc')?.value?.split(',').map(e => e.trim()) || [],
          labels: messageDetails.data.labelIds || [],
          threadId: messageDetails.data.threadId
        }
        
        try {
          processedEmail = await processEmailContent(rawMessageContent)
          finalContent = processedEmail.cleanedContent
          enhancedPlatformData = {
            ...enhancedPlatformData,
            aiSummary: processedEmail.summary,
            keyPoints: processedEmail.keyPoints,
            actionItems: processedEmail.actionItems,
            urgency: processedEmail.urgency,
            category: processedEmail.category,
            originalContent: processedEmail.originalContent
          }
          console.log(`AI processed email for contact ${contact.id}`)
        } catch (aiError) {
          console.error(`AI processing failed for message ${gmailId}, using raw content:`, aiError)
          // Continue with raw content if AI processing fails
        }
        
        // Store in database with cleaned content and AI insights
        await prisma.message.create({
          data: {
            userId,
            contactId,
            platform: 'email', // Will display as 'gmail' in UI
            platformMessageId: gmailId as string,
            content: finalContent, // Use cleaned content
            timestamp,
            platformData: enhancedPlatformData // Include AI insights
          }
        })
        
        // Also create thread reference for organizing emails
        const threadId = messageDetails.data.threadId
        
        // Check for existing ContactMessage entries using both fields separately
        const existingContactMessage = await prisma.contactMessage.findFirst({
          where: {
            messageId: gmailId as string,
            contactId: contactId
          }
        })
        
        // Only create if this specific combination doesn't exist
        if (!existingContactMessage) {
          await prisma.contactMessage.create({
            data: {
              userId,
              contactId,
              messageId: gmailId as string,
              threadId
            }
          })
        }
        
        importedCount++
      }
      
      return { success: true, count: importedCount }
    } catch (error) {
      console.error(`Gmail API error for contact ${contact.id}:`, error)
      
      // Check for token expiration
      if (error.message?.includes('invalid_grant') || 
          error.message?.includes('invalid_token') || 
          error.status === 401 || 
          error.status === 400) {
        console.log('Token may have expired, attempting to refresh...')
        
        try {
          // Refresh token and update user
          const refreshedUser = await manuallyRefreshGoogleToken(user)
          
          // Retry the operation with updated user credentials
          console.log('Token refreshed, retrying Gmail operation')
          const oauth2Client = getOAuth2Client(refreshedUser)
          const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
          
          // Retry the same operation
          const retryResponse = await gmail.users.messages.list({
            userId: 'me',
            q: searchQuery,
            maxResults: 100
          })
          
          // Continue with the rest of your code using retryResponse
          // This will need to duplicate some logic from above
        } catch (refreshError) {
          console.error('Unable to refresh token, skipping contact:', refreshError)
          return { 
            success: false, 
            error: 'Google authentication expired. Please reconnect your account.' 
          }
        }
      }
      
      return { success: false, error: error.message }
    }
  } catch (error) {
    console.error('Error syncing emails:', error)
    return { success: false, error: error.message }
  }
}

// Background job to sync all contacts' emails
export async function syncAllUserEmails(userId: string) {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: userId },
      include: { contacts: true }
    })
    
    if (!user?.googleAccessToken) {
      return { success: false, error: 'Google authentication expired. Please reconnect your account.' }
    }
    
    const results = []
    
    for (const contact of user.contacts) {
      if (contact.email) {
        const result = await syncContactEmails(userId, contact.id)
        results.push({ contactId: contact.id, result })
      }
    }
    
    return { success: true, results }
  } catch (error) {
    console.error('Error in bulk sync:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Helper function to extract email content
export function extractEmailContent(message) {
  // If plain text part exists, use that
  const plainPart = findBodyPart(message.data.payload, 'text/plain')
  if (plainPart) {
    return Buffer.from(plainPart.body.data, 'base64').toString()
  }
  
  // Otherwise use HTML part (and maybe strip HTML tags)
  const htmlPart = findBodyPart(message.data.payload, 'text/html')
  if (htmlPart) {
    const htmlContent = Buffer.from(htmlPart.body.data, 'base64').toString()
    // Optional: strip HTML tags for cleaner display
    return stripHtmlTags(htmlContent)
  }
  
  return 'No content'
}

// Helper to find body parts
export function findBodyPart(part, mimeType) {
  if (!part) return null
  
  if (part.mimeType === mimeType) {
    return part
  }
  
  if (part.parts) {
    for (const subPart of part.parts) {
      const found = findBodyPart(subPart, mimeType)
      if (found) return found
    }
  }
  
  return null
}

// Helper function to strip HTML tags
function stripHtmlTags(html) {
  return html.replace(/<[^>]+>/g, '')
} 