/**
 * Utility to help prevent duplicate messages during Gmail sync
 * by checking threadId and timestamp combinations
 */

export interface MessageIdentifier {
  threadId?: string
  subject?: string
  timestamp: Date
  contactId: string
  platformMessageId: string
}

/**
 * Generate a unique key for message deduplication
 */
export function generateMessageKey(identifier: MessageIdentifier): string {
  const threadKey = identifier.threadId || `subject-${identifier.subject || 'no-subject'}`
  const timeKey = identifier.timestamp.toISOString().split('T')[0] // Just the date part
  return `${threadKey}-${identifier.contactId}-${timeKey}`
}

/**
 * Check if messages are likely duplicates based on content similarity
 */
export function areMessagesSimilar(content1: string, content2: string, threshold = 0.8): boolean {
  // Simple similarity check - compare first 200 characters
  const snippet1 = content1.substring(0, 200).toLowerCase().trim()
  const snippet2 = content2.substring(0, 200).toLowerCase().trim()
  
  if (snippet1 === snippet2) return true
  
  // Calculate similarity ratio
  const longer = snippet1.length > snippet2.length ? snippet1 : snippet2
  const shorter = snippet1.length <= snippet2.length ? snippet1 : snippet2
  
  if (longer.length === 0) return true
  
  const editDistance = levenshteinDistance(shorter, longer)
  const similarity = (longer.length - editDistance) / longer.length
  
  return similarity >= threshold
}

/**
 * Simple Levenshtein distance calculation for string similarity
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null))
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      )
    }
  }
  
  return matrix[str2.length][str1.length]
}

/**
 * Filter out duplicate messages from a list
 */
export function removeDuplicateMessages<T extends { 
  id: string
  content: string
  timestamp: Date | string
  platformData?: { threadId?: string; subject?: string }
  contactId?: string
}>(messages: T[]): T[] {
  const seen = new Set<string>()
  const seenContent = new Map<string, T>()
  const unique: T[] = []
  
  for (const message of messages) {
    const timestamp = typeof message.timestamp === 'string' 
      ? new Date(message.timestamp) 
      : message.timestamp
      
    const identifier: MessageIdentifier = {
      threadId: message.platformData?.threadId,
      subject: message.platformData?.subject,
      timestamp,
      contactId: message.contactId || '',
      platformMessageId: message.id
    }
    
    const key = generateMessageKey(identifier)
    
    if (seen.has(key)) {
      continue // Skip duplicate
    }
    
    // Check content similarity with recent messages
    let isDuplicate = false
    for (const [, existingMessage] of seenContent) {
      if (areMessagesSimilar(message.content, existingMessage.content)) {
        isDuplicate = true
        break
      }
    }
    
    if (!isDuplicate) {
      seen.add(key)
      seenContent.set(key, message)
      unique.push(message)
      
      // Keep only recent 50 messages in memory for comparison
      if (seenContent.size > 50) {
        const oldestKey = seenContent.keys().next().value
        if (oldestKey) {
          seenContent.delete(oldestKey)
        }
      }
    }
  }
  
  return unique
} 