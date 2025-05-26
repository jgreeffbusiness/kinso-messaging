import { useMemo } from 'react'

interface PlatformData {
  subject?: string
  direction?: 'inbound' | 'outbound'
  from?: string
  to?: string[]
  cc?: string[]
  labels?: string[]
  threadId?: string
  aiSummary?: string
  keyPoints?: string[]
  actionItems?: string[]
  urgency?: 'low' | 'medium' | 'high'
  category?: 'meeting' | 'administrative' | 'commercial' | 'personal' | 'notification' | 'other'
  originalContent?: string
  isThreadSummary?: boolean
  analysis?: {
    keyTopics?: string[]
    keyInsights?: string[]
    actionItems?: string[]
    urgency?: 'low' | 'medium' | 'high'
    threadSummary?: string
    [key: string]: unknown
  }
  messageCount?: number
  [key: string]: unknown
}

interface Message {
  id: string
  platform: string
  content: string
  timestamp: Date
  platformData: PlatformData
  contact: {
    id: string
    fullName: string
    email: string | null
  } | null
}

interface EnhancedMessage extends Message {
  threadCount?: number
  threadMessages?: Message[] // All messages in the thread
  actualSender?: {
    name: string
    email: string
  }
  displayName: string
  readAt?: Date | null // Add readAt property for read/unread tracking
}

export function useThreadedMessages(messages: Message[]): EnhancedMessage[] {
  return useMemo(() => {
    if (!messages || messages.length === 0) return []

    // Separate thread summaries from regular messages
    const threadSummaries = messages.filter(msg => 
      msg.platform === 'thread_summary' || 
      msg.platform === 'email_thread' || 
      msg.platform === 'slack_thread_summary' ||
      msg.platformData?.isThreadSummary === true
    )
    
    const regularMessages = messages.filter(msg => 
      !['thread_summary', 'email_thread', 'slack_thread_summary'].includes(msg.platform) &&
      !msg.platformData?.isThreadSummary
    )

    // Group regular messages by threadId
    const threadGroups = new Map<string, Message[]>()
    
    regularMessages.forEach(message => {
      const threadId = message.platformData?.threadId || message.id
      
      if (!threadGroups.has(threadId)) {
        threadGroups.set(threadId, [])
      }
      threadGroups.get(threadId)!.push(message)
    })

    // Get latest message from each thread with enhanced info
    const deduplicatedMessages: EnhancedMessage[] = []

    threadGroups.forEach((threadMessages, threadId) => {
      // Look for a thread summary for this thread
      const threadSummary = threadSummaries.find(summary => 
        summary.platformData?.threadId === threadId
      )
      
      // Sort messages by timestamp (latest first)
      const sortedMessages = threadMessages.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      
      const latestMessage = sortedMessages[0]
      const threadCount = sortedMessages.length
      
      // Parse actual sender from email headers
      const actualSender = parseActualSender(latestMessage.platformData?.from)
      
      // Generate smart display name
      const displayName = generateDisplayName(latestMessage, actualSender)

      // If we have a thread summary, use it as the primary content but preserve message structure
      if (threadSummary) {
        const analysisData = threadSummary.platformData?.analysis
        
        deduplicatedMessages.push({
          ...latestMessage, // Keep the latest message structure for timing, contact, etc.
          content: threadSummary.content, // Use rich thread summary as content
          threadCount: threadCount > 1 ? threadCount : undefined,
          threadMessages: threadCount > 1 ? sortedMessages : undefined,
          actualSender,
          displayName,
          platformData: {
            ...latestMessage.platformData,
            // Override with thread analysis data
            aiSummary: threadSummary.content,
            keyPoints: analysisData?.keyTopics || analysisData?.keyInsights || latestMessage.platformData?.keyPoints || [],
            actionItems: analysisData?.actionItems || latestMessage.platformData?.actionItems || [],
            urgency: analysisData?.urgency || latestMessage.platformData?.urgency || 'low',
            isThreadSummary: true,
            analysis: analysisData
          }
        })
      } else {
        // No thread summary available, use regular message
        deduplicatedMessages.push({
          ...latestMessage,
          threadCount: threadCount > 1 ? threadCount : undefined,
          threadMessages: threadCount > 1 ? sortedMessages : undefined,
          actualSender,
          displayName
        })
      }
    })

    // Sort by timestamp
    return deduplicatedMessages.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  }, [messages])
}

function parseActualSender(fromField?: string): { name: string; email: string } | undefined {
  if (!fromField) return undefined

  // Parse "Name <email>" format
  const emailMatch = fromField.match(/<(.+?)>/)
  const nameMatch = fromField.match(/^([^<]+)/)

  if (emailMatch) {
    return {
      email: emailMatch[1].trim(),
      name: nameMatch ? nameMatch[1].trim() : emailMatch[1].trim()
    }
  }

  // If no angle brackets, assume it's just an email
  return {
    email: fromField.trim(),
    name: fromField.trim()
  }
}

function generateDisplayName(
  message: Message, 
  actualSender?: { name: string; email: string }
): string {
  if (!actualSender || !message.contact) {
    return message.contact?.fullName || 'Unknown'
  }

  const contactEmail = message.contact.email?.toLowerCase()
  const senderEmail = actualSender.email.toLowerCase()

  // If sender is the same as contact, just show contact name
  if (contactEmail === senderEmail) {
    return message.contact.fullName
  }

  // If sender is different, show "Actual Sender (via Contact)"
  return `${actualSender.name} (via ${message.contact.fullName})`
} 