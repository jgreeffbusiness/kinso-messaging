import { processEmailContent } from './email-processor'

export interface EnhancedMessage {
  id: string
  platform: string
  content: string // This will be the cleaned content
  timestamp: Date
  platformData?: {
    subject?: string
    direction?: 'inbound' | 'outbound'
    from?: string
    to?: string[]
    cc?: string[]
    labels?: string[]
    threadId?: string
    // Enhanced fields
    aiSummary?: string
    keyPoints?: string[]
    actionItems?: string[]
    urgency?: 'low' | 'medium' | 'high'
    category?: 'meeting' | 'administrative' | 'commercial' | 'personal' | 'notification' | 'other'
    originalContent?: string
  }
}

export interface OriginalMessage {
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
  }
}

/**
 * Enhances a message with AI-processed content
 * Replaces the raw content with cleaned content and adds AI insights to platformData
 */
export async function enhanceMessage(message: OriginalMessage): Promise<EnhancedMessage> {
  try {
    // Only process email messages for now
    if (message.platform.toLowerCase() !== 'email') {
      return message as EnhancedMessage
    }

    const processed = await processEmailContent(message.content)
    
    return {
      ...message,
      content: processed.cleanedContent, // Replace with cleaned content
      platformData: {
        ...message.platformData,
        // Add AI insights
        aiSummary: processed.summary,
        keyPoints: processed.keyPoints,
        actionItems: processed.actionItems,
        urgency: processed.urgency,
        category: processed.category,
        originalContent: processed.originalContent
      }
    }
  } catch (error) {
    console.error('Failed to enhance message:', error)
    // Return original message if processing fails
    return message as EnhancedMessage
  }
}

/**
 * Enhances multiple messages in batches
 */
export async function enhanceMessages(messages: OriginalMessage[]): Promise<EnhancedMessage[]> {
  // Process in smaller batches to avoid overwhelming the API
  const batchSize = 3
  const enhanced: EnhancedMessage[] = []
  
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize)
    const batchPromises = batch.map(enhanceMessage)
    const batchResults = await Promise.allSettled(batchPromises)
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        enhanced.push(result.value)
      } else {
        console.error(`Failed to enhance message ${batch[index].id}:`, result.reason)
        enhanced.push(batch[index] as EnhancedMessage)
      }
    })
    
    // Small delay between batches to be respectful to the API
    if (i + batchSize < messages.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  return enhanced
} 