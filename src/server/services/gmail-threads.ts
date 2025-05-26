import { google } from 'googleapis'
import { prisma } from '@server/db'
import type { User } from '@prisma/client'
import { analyzeEmailThread } from '@/lib/thread-processor'
import { getOAuth2Client } from './gmail'

interface GmailThreadMessage {
  id: string
  threadId: string
  internalDate: string
  payload: {
    headers: Array<{ name: string; value: string }>
    body?: { data?: string }
    parts?: Array<any>
  }
  labelIds?: string[]
}

export async function syncContactEmailThreads(userId: string, contactId: string) {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: userId } 
    })

    if (!user?.googleAccessToken || !user.email) {
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
    
    // Search for threads (not individual messages)
    const searchQuery = `from:${contact.email.trim()} OR to:${contact.email.trim()}`
    
    console.log(`Searching Gmail threads for contact ${contact.fullName}: ${searchQuery}`)
    
    const response = await gmail.users.threads.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 50
    })
    
    if (!response.data.threads || response.data.threads.length === 0) {
      console.log(`No threads found for contact ${contact.id}`)
      return { success: true, threads: 0 }
    }
    
    console.log(`Found ${response.data.threads.length} threads for contact ${contact.fullName}`)
    
    let processedThreads = 0
    
    // Process each thread
    for (const thread of response.data.threads) {
      if (!thread.id) continue
      
      try {
        // Check if we've already processed this thread recently
        const existingThread = await prisma.message.findFirst({
          where: {
            userId,
            contactId,
            platformData: {
              path: ['threadId'],
              equals: thread.id
            }
          },
          orderBy: { timestamp: 'desc' }
        })
        
        // Skip if processed recently (within last day)
        if (existingThread && 
            existingThread.timestamp && 
            (Date.now() - existingThread.timestamp.getTime()) < 24 * 60 * 60 * 1000) {
          continue
        }
        
        // Get full thread details
        const threadDetails = await gmail.users.threads.get({
          userId: 'me',
          id: thread.id
        })
        
        if (!threadDetails.data.messages || threadDetails.data.messages.length === 0) {
          continue
        }
        
        // Convert Gmail messages to our thread format
        const threadMessages = threadDetails.data.messages
          .map((msg: GmailThreadMessage) => {
            const headers = msg.payload.headers || []
            const from = headers.find(h => h.name === 'From')?.value || ''
            const to = headers.find(h => h.name === 'To')?.value || ''
            const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)'
            
            // Extract message content
            let content = ''
            if (msg.payload.body?.data) {
              content = Buffer.from(msg.payload.body.data, 'base64').toString()
            } else if (msg.payload.parts) {
              // Find text/plain part
              const textPart = msg.payload.parts.find(part => part.mimeType === 'text/plain')
              if (textPart?.body?.data) {
                content = Buffer.from(textPart.body.data, 'base64').toString()
              }
            }
            
            // Clean up content
            content = content.replace(/<[^>]+>/g, '').trim()
            if (content.length > 2000) {
              content = content.substring(0, 2000) + '...'
            }
            
            const isFromUser = from.toLowerCase().includes(user.email!.toLowerCase())
            
            return {
              id: msg.id,
              from,
              to: to.split(',').map(email => email.trim()),
              subject,
              content,
              timestamp: new Date(parseInt(msg.internalDate)),
              direction: isFromUser ? 'outbound' as const : 'inbound' as const,
              isFromUser
            }
          })
          .filter(msg => msg.content.length > 10) // Filter out empty messages
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        
        if (threadMessages.length === 0) continue
        
        // Analyze the thread with AI
        const threadAnalysis = await analyzeEmailThread(
          threadMessages,
          user.email!,
          contact.fullName
        )
        
        // Store thread analysis as a special message
        await prisma.message.upsert({
          where: {
            userId_contactId_platformMessageId: {
              userId,
              contactId,
              platformMessageId: `thread_${thread.id}`
            }
          },
          update: {
            content: threadAnalysis.threadSummary,
            timestamp: threadMessages[threadMessages.length - 1].timestamp,
            platformData: {
              threadId: thread.id,
              messageCount: threadMessages.length,
              analysis: threadAnalysis,
              lastActivity: threadMessages[threadMessages.length - 1].timestamp,
              isThreadSummary: true,
              unresponded: threadAnalysis.unresponded
            }
          },
          create: {
            userId,
            contactId,
            platform: 'email_thread',
            platformMessageId: `thread_${thread.id}`,
            content: threadAnalysis.threadSummary,
            timestamp: threadMessages[threadMessages.length - 1].timestamp,
            platformData: {
              threadId: thread.id,
              messageCount: threadMessages.length,
              analysis: threadAnalysis,
              lastActivity: threadMessages[threadMessages.length - 1].timestamp,
              isThreadSummary: true,
              unresponded: threadAnalysis.unresponded
            }
          }
        })
        
        // Also update the ContactMessage table for thread tracking
        await prisma.contactMessage.upsert({
          where: {
            messageId_contactId: {
              messageId: `thread_${thread.id}`,
              contactId
            }
          },
          update: {
            threadId: thread.id
          },
          create: {
            userId,
            contactId,
            messageId: `thread_${thread.id}`,
            threadId: thread.id
          }
        })
        
        processedThreads++
        console.log(`Processed thread ${thread.id} for ${contact.fullName}: ${threadAnalysis.currentStatus}`)
        
      } catch (threadError) {
        console.error(`Error processing thread ${thread.id}:`, threadError)
        continue
      }
    }
    
    return { success: true, threads: processedThreads }
    
  } catch (error) {
    console.error('Error syncing email threads:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function syncAllUserEmailThreads(userId: string) {
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
        const result = await syncContactEmailThreads(userId, contact.id)
        results.push({ contactId: contact.id, contactName: contact.fullName, result })
      }
    }
    
    return { success: true, results }
  } catch (error) {
    console.error('Error in bulk thread sync:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getThreadAnalysisForContact(userId: string, contactId: string) {
  try {
    const threadSummaries = await prisma.message.findMany({
      where: {
        userId,
        contactId,
        platform: 'email_thread'
      },
      orderBy: { timestamp: 'desc' },
      take: 10
    })
    
    return threadSummaries.map(msg => ({
      threadId: msg.platformData?.threadId,
      summary: msg.content,
      analysis: msg.platformData?.analysis,
      lastActivity: msg.timestamp,
      messageCount: msg.platformData?.messageCount,
      unresponded: msg.platformData?.unresponded
    }))
  } catch (error) {
    console.error('Error getting thread analysis:', error)
    return []
  }
} 