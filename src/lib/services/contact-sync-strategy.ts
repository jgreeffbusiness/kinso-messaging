export type SyncStrategy = 'contact-first' | 'message-first' | 'hybrid'
export type ContactApprovalMode = 'auto' | 'manual' | 'smart-suggest'

export interface ContactSyncSettings {
  userId: string
  strategy: SyncStrategy
  approvalMode: ContactApprovalMode
  enableSpamFiltering: boolean
  platformSettings: {
    email: {
      strategy: SyncStrategy
      onlyFromKnownDomains: boolean
      excludeNewsletters: boolean
    }
    slack: {
      strategy: SyncStrategy
      onlyDirectMessages: boolean
      excludeBots: boolean
    }
  }
}

export interface ContactDecision {
  shouldCreate: boolean
  requiresApproval: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export class ContactSyncStrategyService {
  
  /**
   * Get default sync settings for a user (in-memory for now)
   */
  getDefaultSyncSettings(userId: string): ContactSyncSettings {
    return {
      userId,
      strategy: 'hybrid', // Best of both worlds
      approvalMode: 'smart-suggest', // Suggest but don't auto-create
      enableSpamFiltering: true,
      platformSettings: {
        email: {
          strategy: 'contact-first', // Email is more personal, keep existing approach
          onlyFromKnownDomains: false,
          excludeNewsletters: true
        },
        slack: {
          strategy: 'message-first', // Slack is more conversational, keep existing approach
          onlyDirectMessages: true,
          excludeBots: true
        }
      }
    }
  }

  /**
   * Determine if a message should create a new contact based on strategy
   */
  shouldCreateContact(
    settings: ContactSyncSettings,
    platformMessage: {
      platform: string
      sender: { name?: string; email?: string; handle?: string }
      content: string
      timestamp: Date
    }
  ): ContactDecision {
    const platformSetting = settings.platformSettings[
      platformMessage.platform as keyof typeof settings.platformSettings
    ]

    // Contact-first: Only create if we have an existing contact relationship
    if (platformSetting?.strategy === 'contact-first') {
      return {
        shouldCreate: false, // Would need to check existing contacts
        requiresApproval: false,
        confidence: 'high',
        reason: 'Contact-first strategy - would need existing contact check'
      }
    }

    // Message-first: Create contact for every new sender
    if (platformSetting?.strategy === 'message-first') {
      const spamCheck = settings.enableSpamFiltering ? 
        this.isLikelySpam(platformMessage) : 
        { isSpam: false, confidence: 'low' as const, reason: 'Spam filtering disabled' }

      if (spamCheck.isSpam) {
        return {
          shouldCreate: false,
          requiresApproval: false,
          confidence: spamCheck.confidence,
          reason: `Likely spam: ${spamCheck.reason}`
        }
      }

      return {
        shouldCreate: true,
        requiresApproval: settings.approvalMode === 'manual',
        confidence: 'high',
        reason: 'Message-first strategy - new contact from message'
      }
    }

    // Hybrid: Smart decision based on message content and sender
    const smartAnalysis = this.analyzeContactWorthiness(platformMessage)
    return {
      shouldCreate: smartAnalysis.confidence === 'high',
      requiresApproval: smartAnalysis.confidence === 'medium' || settings.approvalMode === 'manual',
      confidence: smartAnalysis.confidence,
      reason: smartAnalysis.reason
    }
  }

  /**
   * Detect likely spam messages
   */
  private isLikelySpam(message: {
    platform: string
    sender: { name?: string; email?: string; handle?: string }
    content: string
  }): {
    isSpam: boolean
    confidence: 'high' | 'medium' | 'low'
    reason: string
  } {
    const spamIndicators = []

    // Email spam indicators
    if (message.platform === 'email') {
      if (message.sender.email?.includes('noreply') || 
          message.sender.email?.includes('no-reply')) {
        spamIndicators.push('No-reply email address')
      }
      
      if (message.content.toLowerCase().includes('unsubscribe') ||
          message.content.toLowerCase().includes('newsletter')) {
        spamIndicators.push('Newsletter content')
      }
    }

    // Slack spam indicators
    if (message.platform === 'slack') {
      if (message.sender.handle?.startsWith('B')) { // Bot users
        spamIndicators.push('Bot user')
      }
      
      if (message.content.includes('has joined') || 
          message.content.includes('has left')) {
        spamIndicators.push('System message')
      }
    }

    // General spam indicators
    if (message.content.length < 10) {
      spamIndicators.push('Very short message')
    }

    const isSpam = spamIndicators.length > 0
    const confidence = spamIndicators.length >= 2 ? 'high' : 
                      spamIndicators.length === 1 ? 'medium' : 'low'

    return {
      isSpam,
      confidence,
      reason: spamIndicators.join(', ') || 'Clean message'
    }
  }

  /**
   * Analyze if a contact is worth creating based on message quality
   */
  private analyzeContactWorthiness(message: {
    platform: string
    sender: { name?: string; email?: string; handle?: string }
    content: string
    timestamp: Date
  }): {
    confidence: 'high' | 'medium' | 'low'
    reason: string
  } {
    const qualityIndicators = []
    const negativeIndicators = []

    // Positive indicators
    if (message.content.length > 50) {
      qualityIndicators.push('Substantial message content')
    }

    if (message.sender.name && message.sender.name !== 'Unknown User') {
      qualityIndicators.push('Has real name')
    }

    if (message.sender.email && !message.sender.email.includes('noreply')) {
      qualityIndicators.push('Has personal email')
    }

    // Check for personal language patterns
    const personalPatterns = ['thanks', 'please', 'question', 'help', 'meeting', 'call']
    if (personalPatterns.some(pattern => 
      message.content.toLowerCase().includes(pattern))) {
      qualityIndicators.push('Personal communication patterns')
    }

    // Negative indicators
    const spamCheck = this.isLikelySpam(message)
    if (spamCheck.isSpam) {
      negativeIndicators.push(spamCheck.reason)
    }

    // Calculate confidence
    const score = qualityIndicators.length - negativeIndicators.length
    const confidence = score >= 2 ? 'high' : score >= 0 ? 'medium' : 'low'

    return {
      confidence,
      reason: `Quality: ${qualityIndicators.join(', ')} | Issues: ${negativeIndicators.join(', ')}`
    }
  }
}

export const contactSyncStrategy = new ContactSyncStrategyService() 