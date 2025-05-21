import { google } from 'googleapis'
import { prisma } from '@server/db'
import type { User } from '@prisma/client'

// OAuth2 client setup
const getOAuth2Client = (user: User) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
  
  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
    expiry_date: user.googleTokenExpiry ? new Date(user.googleTokenExpiry).getTime() : undefined
  })
  
  return oauth2Client
}

export async function syncContactEmails(userId: string, contactId: string) {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: userId } 
    })
    
    if (!user?.googleAccessToken) {
      throw new Error('User not connected to Google')
    }
    
    const contact = await prisma.contact.findUnique({
      where: { id: contactId, userId }
    })
    
    if (!contact || !contact.email) {
      throw new Error('Contact has no email')
    }
    
    const oauth2Client = getOAuth2Client(user)
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    
    // Ensure proper escaping in the search query
    const searchQuery = contact.email ? 
      `(from:${contact.email.trim()}) OR (to:${contact.email.trim()})` : 
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
        const messageContent = extractEmailContent(messageDetails)
        
        // Store in database
        await prisma.message.create({
          data: {
            userId,
            contactId,
            platform: 'email', // Will display as 'gmail' in UI
            platformMessageId: gmailId as string,
            content: messageContent,
            timestamp,
            platformData: {
              subject,
              direction,
              from,
              to: headers.find(h => h.name === 'To')?.value?.split(',').map(e => e.trim()) || [],
              cc: headers.find(h => h.name === 'Cc')?.value?.split(',').map(e => e.trim()) || [],
              labels: messageDetails.data.labelIds || [],
              threadId: messageDetails.data.threadId
            }
          }
        })
        
        // Also create thread reference for organizing emails
        const threadId = messageDetails.data.threadId
        
        // Check for existing ContactEmail entries using both fields separately
        const existingContactEmail = await prisma.contactEmail.findFirst({
          where: {
            messageId: gmailId as string,
            contactId: contactId
          }
        })
        
        // Only create if this specific combination doesn't exist
        if (!existingContactEmail) {
          await prisma.contactEmail.create({
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
      
      // Add more specific error logging
      if (error.status === 400) {
        console.error('Bad request error. Search query:', searchQuery)
      }
      
      // Check token expiration
      if (error.message?.includes('invalid_grant') || error.status === 401) {
        console.log('Token may have expired, refreshing...')
        // Implement token refresh logic or skip this contact
      }
      
      // Continue with next contact rather than failing entire sync
      return { success: true, count: 0 }
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
      throw new Error('User not connected to Google')
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
    return { success: false, error: error.message }
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