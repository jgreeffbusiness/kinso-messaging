interface Message {
  id: string
  content: string
  timestamp: Date
  sender: {
    id: string
    name: string
  }
  platform: string
}

interface ConversationThread {
  id: string
  title: string
  summary: string
  messages: Message[]
  startTime: Date
  endTime: Date
  participants: string[]
  topic: string
  actionItems?: string[]
  userParticipated: boolean
}

export class ConversationThreadingService {
  
  /**
   * Intelligently chunk messages into conversation threads
   */
  async createConversationThreads(
    messages: Message[], 
    currentUserId: string
  ): Promise<ConversationThread[]> {
    
    // Sort messages chronologically
    const sortedMessages = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    
    const threads: ConversationThread[] = []
    let currentThread: Message[] = []
    let lastMessageTime: Date | null = null
    
    for (const message of sortedMessages) {
      const shouldStartNewThread = await this.shouldStartNewThread(
        message, 
        currentThread, 
        lastMessageTime
      )
      
      if (shouldStartNewThread && currentThread.length > 0) {
        // Finalize current thread
        const thread = await this.finalizeThread(currentThread, currentUserId)
        if (thread) {
          threads.push(thread)
        }
        currentThread = []
      }
      
      currentThread.push(message)
      lastMessageTime = message.timestamp
    }
    
    // Don't forget the last thread
    if (currentThread.length > 0) {
      const thread = await this.finalizeThread(currentThread, currentUserId)
      if (thread) {
        threads.push(thread)
      }
    }
    
    return threads.filter(thread => this.isSignificantThread(thread))
  }
  
  /**
   * Determine if we should start a new conversation thread
   */
  private async shouldStartNewThread(
    message: Message,
    currentThread: Message[],
    lastMessageTime: Date | null
  ): Promise<boolean> {
    
    if (currentThread.length === 0) return false
    
    // Time-based chunking (4+ hour gap = new thread)
    if (lastMessageTime) {
      const hoursSinceLastMessage = (message.timestamp.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60)
      if (hoursSinceLastMessage > 4) return true
    }
    
    // AI-powered context analysis
    const contextShift = await this.analyzeContextShift(message, currentThread)
    if (contextShift.confidence > 0.7) return true
    
    // URL/file sharing often starts new topics
    if (this.containsUrlOrFile(message.content) && currentThread.length > 3) {
      return true
    }
    
    return false
  }
  
  /**
   * Analyze if message represents a significant context/topic shift
   */
  private async analyzeContextShift(
    newMessage: Message, 
    existingThread: Message[]
  ): Promise<{ confidence: number; reason: string }> {
    
    if (existingThread.length === 0) {
      return { confidence: 0, reason: 'No existing context' }
    }
    
    const recentMessages = existingThread.slice(-3).map(m => m.content).join('\n')
    
    const prompt = `
    Analyze if this new message represents a significant topic/context shift:
    
    RECENT CONVERSATION:
    ${recentMessages}
    
    NEW MESSAGE:
    ${newMessage.content}
    
    Return JSON: { "confidence": 0.0-1.0, "reason": "explanation" }
    
    Consider:
    - Topic continuity vs new subjects
    - Question/answer pairs
    - Natural conversation breaks
    - Time-sensitive vs ongoing discussions
    `
    
    try {
      // This would call your AI service
      const response = await this.callAI(prompt)
      return JSON.parse(response)
    } catch (error) {
      console.error('Context shift analysis failed:', error)
      return { confidence: 0, reason: 'Analysis failed' }
    }
  }
  
  /**
   * Create a finalized conversation thread
   */
  private async finalizeThread(
    messages: Message[], 
    currentUserId: string
  ): Promise<ConversationThread | null> {
    
    if (messages.length === 0) return null
    
    // Filter out user's own messages for display (but keep for context)
    const displayMessages = messages.filter(m => m.sender.id !== currentUserId)
    const userParticipated = messages.some(m => m.sender.id === currentUserId)
    
    // Generate AI summary and title
    const { title, summary, actionItems, topic } = await this.generateThreadSummary(
      messages, 
      userParticipated
    )
    
    return {
      id: `thread_${messages[0].id}_${messages[messages.length - 1].id}`,
      title,
      summary,
      messages: displayMessages, // Only show other people's messages
      startTime: messages[0].timestamp,
      endTime: messages[messages.length - 1].timestamp,
      participants: [...new Set(messages.map(m => m.sender.name))],
      topic,
      actionItems,
      userParticipated
    }
  }
  
  /**
   * Generate AI-powered thread summary
   */
  private async generateThreadSummary(
    messages: Message[], 
    userParticipated: boolean
  ): Promise<{
    title: string
    summary: string  
    actionItems: string[]
    topic: string
  }> {
    
    const messageContent = messages.map(m => 
      `${m.sender.name}: ${m.content}`
    ).join('\n')
    
    const prompt = `
    Analyze this conversation thread and provide:
    
    CONVERSATION:
    ${messageContent}
    
    USER PARTICIPATED: ${userParticipated ? 'Yes' : 'No'}
    
    Return JSON with:
    {
      "title": "Brief descriptive title (max 50 chars)",
      "summary": "2-3 sentence summary of the conversation", 
      "actionItems": ["any action items or follow-ups"],
      "topic": "main topic/category"
    }
    
    ${userParticipated ? 'Note: Include user participation context in summary.' : ''}
    `
    
    try {
      const response = await this.callAI(prompt)
      return JSON.parse(response)
    } catch (error) {
      console.error('Thread summary generation failed:', error)
      return {
        title: messages[0].content.substring(0, 50) + '...',
        summary: 'Conversation thread',
        actionItems: [],
        topic: 'General'
      }
    }
  }
  
  /**
   * Check if thread is significant enough to show
   */
  private isSignificantThread(thread: ConversationThread): boolean {
    // Don't show threads with only user's messages
    if (thread.messages.length === 0) return false
    
    // Don't show very short threads unless they have action items
    if (thread.messages.length === 1 && (thread.actionItems?.length || 0) === 0) {
      return false
    }
    
    return true
  }
  
  private containsUrlOrFile(content: string): boolean {
    return /https?:\/\//.test(content) || /\.(pdf|doc|xlsx|jpg|png)$/i.test(content)
  }
  
  private async callAI(prompt: string): Promise<string> {
    // TODO: Implement your AI service call here
    // For now, return a placeholder to avoid unused variable warning
    console.log('AI prompt:', prompt.substring(0, 100) + '...')
    throw new Error('AI service not implemented')
  }
}

export const conversationThreadingService = new ConversationThreadingService() 