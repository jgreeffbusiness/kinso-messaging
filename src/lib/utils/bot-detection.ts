/**
 * Bot and automated account detection utility
 * Filters out bots, system accounts, and automated services from contact imports
 */

export interface BotDetectionResult {
  isBot: boolean
  reasons: string[]
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Contact interface for bot detection
 * Compatible with PlatformContact - id and name are required
 */
interface BotDetectionContact {
  id: string
  name: string
  email?: string
  handle?: string
  platformSpecific?: {
    isBot?: boolean
    deleted?: boolean
    [key: string]: unknown
  }
}

/**
 * Common patterns for automated email addresses
 */
const AUTOMATED_EMAIL_PATTERNS = [
  // No-reply patterns
  /^(no-?reply|noreply)@/i,
  /^(do-?not-?reply|donotreply)@/i,
  
  // System/admin patterns
  /^(admin|administrator|system|root|postmaster)@/i,
  /^(support|help|info|contact)@/i,
  /^(notifications?|alerts?)@/i,
  /^(automated?|auto)@/i,
  /^(service|services)@/i,
  /^(mailer|daemon|bounce)@/i,
  
  // Marketing/newsletter patterns
  /^(marketing|newsletter|news)@/i,
  /^(campaign|promo|promotion)@/i,
  /^(updates?|announcements?)@/i,
  
  // Security patterns
  /^(security|abuse|spam)@/i,
  /^(phishing|fraud|safety)@/i,
  
  // Integration patterns
  /^(api|webhook|integration)@/i,
  /^(slack|teams|discord|zoom)@/i,
  /^(github|gitlab|jira|trello)@/i,
  
  // Generic patterns
  /^(test|testing|demo)@/i,
  /^(null|void|dummy)@/i,
]

/**
 * Common patterns for bot names and handles
 */
const BOT_NAME_PATTERNS = [
  // Direct bot indicators
  /bot$/i,
  /^.*bot.*/i,
  /automation/i,
  /automated/i,
  
  // Service names
  /^(slack|teams|discord|zoom)/i,
  /^(github|gitlab|jira|trello)/i,
  /^(google|microsoft|apple)/i,
  /^(calendar|reminder|notification)/i,
  
  // System patterns
  /^(system|admin|root)/i,
  /^(service|daemon|process)/i,
  /integration$/i,
  /webhook$/i,
  
  // AI assistants
  /^(assistant|ai|gpt|claude)/i,
  /^(chatbot|chat.?bot)/i,
]

/**
 * Known service domains that typically host bots
 */
const BOT_DOMAINS = [
  // Email service providers (for system emails)
  'notifications.service.slack.com',
  'noreply.github.com',
  'no-reply.accounts.google.com',
  'noreply.medium.com',
  'notifications.google.com',
  'mail-noreply.google.com',
  
  // Automation platforms
  'zapier.com',
  'ifttt.com',
  'automate.io',
  
  // Common no-reply domains
  'noreply.com',
  'donotreply.com',
  'no-reply.com',
]

/**
 * Main bot detection function
 */
export function detectBot(contact: BotDetectionContact): BotDetectionResult {
  const reasons: string[] = []
  let confidence: 'high' | 'medium' | 'low' = 'low'
  
  // High confidence: Platform explicitly marks as bot
  if (contact.platformSpecific?.isBot === true) {
    reasons.push('Platform marked as bot')
    confidence = 'high'
  }
  
  // High confidence: Deleted/deactivated accounts
  if (contact.platformSpecific?.deleted === true) {
    reasons.push('Account is deleted/deactivated')
    confidence = 'high'
  }
  
  // High confidence: Email patterns
  if (contact.email) {
    // Check against automated email patterns
    for (const pattern of AUTOMATED_EMAIL_PATTERNS) {
      if (pattern.test(contact.email)) {
        reasons.push(`Automated email pattern: ${contact.email}`)
        confidence = 'high'
        break
      }
    }
    
    // Check against known bot domains
    const emailDomain = contact.email.split('@')[1]?.toLowerCase()
    if (emailDomain && BOT_DOMAINS.includes(emailDomain)) {
      reasons.push(`Known bot domain: ${emailDomain}`)
      confidence = 'high'
    }
  }
  
  // Medium confidence: Name patterns
  if (contact.name) {
    for (const pattern of BOT_NAME_PATTERNS) {
      if (pattern.test(contact.name)) {
        reasons.push(`Bot name pattern: ${contact.name}`)
        if (confidence === 'low') confidence = 'medium'
        break
      }
    }
  }
  
  // Medium confidence: Handle patterns
  if (contact.handle) {
    for (const pattern of BOT_NAME_PATTERNS) {
      if (pattern.test(contact.handle)) {
        reasons.push(`Bot handle pattern: ${contact.handle}`)
        if (confidence === 'low') confidence = 'medium'
        break
      }
    }
  }
  
  // Low confidence: Missing name (common for system accounts)
  if (!contact.name || contact.name.trim() === '' || contact.name === 'Unknown User') {
    reasons.push('Missing or generic name')
    // Keep confidence as low since this alone isn't definitive
  }
  
  const isBot = reasons.length > 0 && (confidence === 'high' || confidence === 'medium')
  
  return {
    isBot,
    reasons,
    confidence
  }
}

/**
 * Utility to check if a contact should be filtered out
 * Uses conservative filtering - only filters high confidence bots
 */
export function shouldFilterContact(contact: BotDetectionContact): boolean {
  const detection = detectBot(contact)
  
  // Only filter high confidence bots to avoid false positives
  return detection.isBot && detection.confidence === 'high'
}

/**
 * Batch filter contacts, returning only real users
 * Preserves all original properties of the input contacts
 */
export function filterRealContacts<T extends BotDetectionContact>(
  contacts: T[]
): { realContacts: T[], filteredBots: Array<T & { botDetection: BotDetectionResult }> } {
  const realContacts: T[] = []
  const filteredBots: Array<T & { botDetection: BotDetectionResult }> = []
  
  for (const contact of contacts) {
    const detection = detectBot(contact)
    
    if (shouldFilterContact(contact)) {
      filteredBots.push({ ...contact, botDetection: detection })
    } else {
      realContacts.push(contact)
    }
  }
  
  return { realContacts, filteredBots }
} 