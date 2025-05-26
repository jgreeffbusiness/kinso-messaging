export type MessageStatus = 
  | 'needs_attention'    // AI detected urgency/importance
  | 'action_scheduled'   // User/AI scheduled follow-up
  | 'handled'           // Action completed
  | 'ai_processed'      // AI summarized, no action needed
  | 'reference'         // Archived for future reference
  | 'new'              // Just synced, not yet processed

export type ActionType = 
  | 'respond'           // Need to reply
  | 'schedule_meeting'  // Schedule a meeting
  | 'follow_up'        // Set reminder to follow up
  | 'delegate'         // Assign to someone else
  | 'archive'          // Move to reference
  | 'escalate'         // Mark as urgent/important

export interface MessageAction {
  id: string
  messageId: string
  type: ActionType
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  dueDate?: Date
  assignedTo?: string
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed'
  aiGenerated: boolean
  createdAt: Date
  completedAt?: Date
}

export interface AIInsight {
  messageId: string
  summary: string
  keyPoints: string[]
  urgency: 'high' | 'medium' | 'low'
  sentiment: 'positive' | 'neutral' | 'negative'
  actionableItems: string[]
  suggestedActions: Omit<MessageAction, 'id' | 'messageId' | 'createdAt'>[]
  confidence: number // 0-1 confidence in AI analysis
  processedAt: Date
}

export interface EnhancedMessage {
  // ... existing message fields
  status: MessageStatus
  actions: MessageAction[]
  aiInsight?: AIInsight
  lastActionAt?: Date
  userInteracted: boolean // Did user take any action on this message
} 