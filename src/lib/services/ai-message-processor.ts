import { MessageStatus, MessageAction, AIInsight } from '../types/message-status'
import { prisma } from '@/server/db'

interface MessageMetadata {
  platform: string
  threadId?: string
  sender?: {
    id: string
    name: string
    email?: string
  }
  [key: string]: unknown
}

export class AIMessageProcessor {
  
  /**
   * Process a message with AI to determine status and generate actions
   */
  async processMessage(messageId: string, content: string, metadata: MessageMetadata): Promise<{
    status: MessageStatus
    aiInsight: AIInsight
    suggestedActions: MessageAction[]
  }> {
    
    console.log(`Processing message ${messageId} with AI`)
    
    // AI Analysis (simplified - would use actual AI service)
    const aiInsight = await this.analyzeMessage(content, metadata)
    
    // Determine status based on AI analysis
    const status = this.determineMessageStatus(aiInsight)
    
    // Generate suggested actions
    const suggestedActions = await this.generateActions(messageId, aiInsight)
    
    return {
      status,
      aiInsight,
      suggestedActions
    }
  }

  /**
   * AI analysis of message content
   */
  private async analyzeMessage(content: string, metadata: MessageMetadata): Promise<AIInsight> {
    // This would integrate with your AI service (OpenAI, Claude, etc.)
    // For now, implementing rule-based logic as a starting point
    
    const keyPoints = this.extractKeyPoints(content)
    const urgency = this.detectUrgency(content)
    const sentiment = this.analyzeSentiment(content)
    const actionableItems = this.findActionableItems(content)
    
    // Use metadata for enhanced analysis in future
    console.log(`Analyzing message from platform: ${metadata.platform}`)
    
    return {
      messageId: '', // Will be set by caller
      summary: this.generateSummary(content),
      keyPoints,
      urgency,
      sentiment,
      actionableItems,
      suggestedActions: [], // Will be generated separately
      confidence: 0.85, // Placeholder confidence score
      processedAt: new Date()
    }
  }

  /**
   * Determine message status based on AI analysis
   */
  private determineMessageStatus(insight: AIInsight): MessageStatus {
    // High urgency or actionable items -> needs attention
    if (insight.urgency === 'high' || insight.actionableItems.length > 0) {
      return 'needs_attention'
    }
    
    // Medium urgency -> AI processed but may need follow-up
    if (insight.urgency === 'medium') {
      return 'ai_processed'
    }
    
    // Low urgency, no actions -> reference
    return 'reference'
  }

  /**
   * Generate AI-suggested actions based on message analysis
   */
  private async generateActions(messageId: string, insight: AIInsight): Promise<MessageAction[]> {
    const actions: Omit<MessageAction, 'id' | 'createdAt'>[] = []
    
    // Generate actions based on content analysis
    if (insight.actionableItems.some(item => item.includes('meeting') || item.includes('schedule'))) {
      actions.push({
        messageId,
        type: 'schedule_meeting',
        title: 'Schedule Meeting',
        description: 'AI detected meeting request or scheduling need',
        priority: insight.urgency === 'high' ? 'high' : 'medium',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        status: 'pending',
        aiGenerated: true
      })
    }
    
    if (insight.actionableItems.some(item => item.includes('respond') || item.includes('reply'))) {
      actions.push({
        messageId,
        type: 'respond',
        title: 'Respond Required',
        description: 'AI detected this message requires a response',
        priority: insight.urgency === 'high' ? 'high' : 'medium',
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days
        status: 'pending',
        aiGenerated: true
      })
    }
    
    if (insight.urgency === 'low' && insight.actionableItems.length === 0) {
      actions.push({
        messageId,
        type: 'archive',
        title: 'Archive Message',
        description: 'AI suggests archiving - low priority, no actions needed',
        priority: 'low',
        status: 'pending',
        aiGenerated: true
      })
    }
    
    // Create actual action records
    const createdActions: MessageAction[] = []
    for (const actionData of actions) {
      const action: MessageAction = {
        ...actionData,
        id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date()
      }
      createdActions.push(action)
    }
    
    return createdActions
  }

  /**
   * Extract key points from message content
   */
  private extractKeyPoints(content: string): string[] {
    // Simple keyword extraction - would use NLP in production
    const points: string[] = []
    
    if (content.includes('deadline') || content.includes('urgent')) {
      points.push('Contains deadline or urgency indicators')
    }
    
    if (content.includes('meeting') || content.includes('call')) {
      points.push('Meeting or call mentioned')
    }
    
    if (content.includes('project') || content.includes('task')) {
      points.push('Project or task related')
    }
    
    return points
  }

  /**
   * Detect urgency level
   */
  private detectUrgency(content: string): 'high' | 'medium' | 'low' {
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'critical', 'emergency']
    const mediumKeywords = ['soon', 'priority', 'important', 'deadline']
    
    const lowerContent = content.toLowerCase()
    
    if (urgentKeywords.some(keyword => lowerContent.includes(keyword))) {
      return 'high'
    }
    
    if (mediumKeywords.some(keyword => lowerContent.includes(keyword))) {
      return 'medium'
    }
    
    return 'low'
  }

  /**
   * Analyze sentiment
   */
  private analyzeSentiment(content: string): 'positive' | 'neutral' | 'negative' {
    // Simple sentiment analysis - would use proper NLP
    const positiveWords = ['thank', 'great', 'excellent', 'good', 'happy']
    const negativeWords = ['problem', 'issue', 'concern', 'disappointed', 'urgent']
    
    const lowerContent = content.toLowerCase()
    const positiveCount = positiveWords.filter(word => lowerContent.includes(word)).length
    const negativeCount = negativeWords.filter(word => lowerContent.includes(word)).length
    
    if (positiveCount > negativeCount) return 'positive'
    if (negativeCount > positiveCount) return 'negative'
    return 'neutral'
  }

  /**
   * Find actionable items
   */
  private findActionableItems(content: string): string[] {
    const actionables: string[] = []
    const lowerContent = content.toLowerCase()
    
    if (lowerContent.includes('please') && (lowerContent.includes('reply') || lowerContent.includes('respond'))) {
      actionables.push('Response requested')
    }
    
    if (lowerContent.includes('schedule') || lowerContent.includes('meeting')) {
      actionables.push('Scheduling required')
    }
    
    if (lowerContent.includes('review') || lowerContent.includes('feedback')) {
      actionables.push('Review or feedback needed')
    }
    
    return actionables
  }

  /**
   * Generate summary
   */
  private generateSummary(content: string): string {
    // Simple summary - would use AI summarization
    const sentences = content.split('.').filter(s => s.trim().length > 0)
    if (sentences.length <= 2) return content
    
    return sentences.slice(0, 2).join('.') + '...'
  }

  /**
   * Update message status and save AI insights
   */
  async updateMessageWithAI(
    messageId: string, 
    status: MessageStatus, 
    aiInsight: AIInsight, 
    actions: MessageAction[]
  ): Promise<void> {
    try {
      // Update message with AI data
      await prisma.message.update({
        where: { id: messageId },
        data: {
          platformData: {
            // Preserve existing platform data and add AI data
            aiStatus: status,
            aiInsight: aiInsight,
            actions: actions,
            lastAIProcessed: new Date()
          }
        }
      })
      
      console.log(`Updated message ${messageId} with AI processing results`)
    } catch (error) {
      console.error(`Failed to update message ${messageId} with AI data:`, error)
      throw error
    }
  }
}

// Singleton instance
export const aiMessageProcessor = new AIMessageProcessor() 