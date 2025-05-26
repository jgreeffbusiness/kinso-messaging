interface Message {
  id: string
  platform: string
  content: string
  timestamp: Date
  platformData?: {
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
  }
  contact?: {
    id: string
    name: string
    email?: string
  }
}

interface ThreadedMessage extends Message {
  threadCount: number
  isLatestInThread: boolean
  actualSender?: {
    name: string
    email: string
  }
  contactContext?: string
}

interface MessageWithContact {
  id: string
  platform: string
  content: string
  timestamp: Date
  platformData: any
  contact: {
    id: string
    fullName: string
    email: string | null
  } | null
}

interface ThreadGroup {
  threadId: string
  subject: string
  latestMessage: MessageWithContact
  messageCount: number
  participants: Array<{
    id: string
    name: string
    email: string | null
  }>
  timestamp: Date
  isFromMe: boolean
}

/**
 * Groups messages by thread and determines proper sender attribution
 */
export function groupMessagesByThread(messages: Message[]): ThreadedMessage[] {
  // Group messages by threadId (or fallback to subject for non-threaded messages)
  const threadGroups = new Map<string, Message[]>()
  
  for (const message of messages) {
    const threadKey = message.platformData?.threadId || 
                     `${message.platformData?.subject || 'no-subject'}-${message.contact?.id || 'no-contact'}`
    
    if (!threadGroups.has(threadKey)) {
      threadGroups.set(threadKey, [])
    }
    threadGroups.get(threadKey)!.push(message)
  }
  
  const threadedMessages: ThreadedMessage[] = []
  
  // Process each thread
  for (const [, threadMessages] of threadGroups) {
    // Sort messages in thread by timestamp (newest first)
    const sortedMessages = threadMessages.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    
    // Get the latest message to represent the thread
    const latestMessage = sortedMessages[0]
    const threadCount = sortedMessages.length
    
    // Determine actual sender vs contact attribution
    const actualSender = extractActualSender(latestMessage)
    const contactContext = determineContactContext(latestMessage, actualSender)
    
    threadedMessages.push({
      ...latestMessage,
      threadCount,
      isLatestInThread: true,
      actualSender,
      contactContext
    })
  }
  
  // Sort threads by latest message timestamp
  return threadedMessages.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
}

/**
 * Enhanced thread grouping with full participant tracking
 */
export function groupMessagesWithParticipants(messages: MessageWithContact[]): ThreadGroup[] {
  const threadMap = new Map<string, ThreadGroup>()

  for (const message of messages) {
    const threadId = message.platformData?.threadId || message.id
    const subject = message.platformData?.subject || 'No Subject'
    const direction = message.platformData?.direction || 'inbound'
    
    if (!threadMap.has(threadId)) {
      // Create new thread group
      threadMap.set(threadId, {
        threadId,
        subject: cleanSubject(subject),
        latestMessage: message,
        messageCount: 1,
        participants: [],
        timestamp: message.timestamp,
        isFromMe: direction === 'outbound'
      })
    } else {
      // Update existing thread
      const thread = threadMap.get(threadId)!
      thread.messageCount++
      
      // Keep the latest message
      if (message.timestamp > thread.timestamp) {
        thread.latestMessage = message
        thread.timestamp = message.timestamp
        thread.isFromMe = direction === 'outbound'
      }
    }

    // Add contact to participants if not already included
    const thread = threadMap.get(threadId)!
    const contact = message.contact
    
    if (contact && !thread.participants.find(p => p.id === contact.id)) {
      thread.participants.push({
        id: contact.id,
        name: contact.fullName,
        email: contact.email
      })
    }

    // Parse participants from email headers
    addParticipantsFromHeaders(thread, message.platformData)
  }

  // Convert to array and sort by latest timestamp
  return Array.from(threadMap.values()).sort((a, b) => 
    b.timestamp.getTime() - a.timestamp.getTime()
  )
}

/**
 * Extract the actual sender from email headers
 */
function extractActualSender(message: Message): { name: string; email: string } | undefined {
  const fromField = message.platformData?.from
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

/**
 * Determine how to show the contact context
 */
function determineContactContext(message: Message, actualSender?: { name: string; email: string }): string | undefined {
  if (!actualSender || !message.contact) return undefined
  
  const contactEmail = message.contact.email?.toLowerCase()
  const senderEmail = actualSender.email.toLowerCase()
  
  // If sender is the same as contact, no context needed
  if (contactEmail === senderEmail) {
    return undefined
  }
  
  // If sender is different from contact, show context
  return `(via ${message.contact.name})`
}

/**
 * Get display name for a message considering actual sender and contact context
 */
export function getMessageDisplayName(message: ThreadedMessage): string {
  if (message.actualSender && message.contactContext) {
    return `${message.actualSender.name} ${message.contactContext}`
  }
  
  if (message.actualSender) {
    return message.actualSender.name
  }
  
  return message.contact?.name || 'Unknown'
}

/**
 * Add participants from email headers to thread
 */
function addParticipantsFromHeaders(thread: ThreadGroup, platformData: any) {
  // Parse TO field
  if (platformData?.to) {
    const toEmails = Array.isArray(platformData.to) ? platformData.to : [platformData.to]
    
    for (const toEmail of toEmails) {
      const cleanEmail = extractEmailFromString(toEmail)
      if (cleanEmail && !thread.participants.find(p => p.email?.toLowerCase() === cleanEmail.toLowerCase())) {
        const name = extractNameFromEmailString(toEmail) || cleanEmail
        thread.participants.push({
          id: `email-${cleanEmail}`,
          name,
          email: cleanEmail
        })
      }
    }
  }

  // Parse CC field
  if (platformData?.cc) {
    const ccEmails = Array.isArray(platformData.cc) ? platformData.cc : [platformData.cc]
    
    for (const ccEmail of ccEmails) {
      const cleanEmail = extractEmailFromString(ccEmail)
      if (cleanEmail && !thread.participants.find(p => p.email?.toLowerCase() === cleanEmail.toLowerCase())) {
        const name = extractNameFromEmailString(ccEmail) || cleanEmail
        thread.participants.push({
          id: `email-${cleanEmail}`,
          name,
          email: cleanEmail
        })
      }
    }
  }
}

function cleanSubject(subject: string): string {
  // Remove "Re:", "Fwd:", etc. prefixes
  return subject.replace(/^(Re:|Fwd:|RE:|FW:)\s*/i, '').trim()
}

function extractEmailFromString(emailString: string): string | null {
  // Extract email from "Name <email@domain.com>" format
  const emailMatch = emailString.match(/<(.+?)>/)
  if (emailMatch) {
    return emailMatch[1].trim()
  }
  
  // If it's just an email without brackets
  const directEmailMatch = emailString.match(/[\w.-]+@[\w.-]+\.\w+/)
  return directEmailMatch ? directEmailMatch[0] : null
}

function extractNameFromEmailString(emailString: string): string | null {
  // Extract name from "Name <email@domain.com>" format
  const nameMatch = emailString.match(/^([^<]+)/)
  if (nameMatch) {
    const name = nameMatch[1].trim()
    // Don't return email addresses as names
    return name.includes('@') ? null : name
  }
  return null
} 