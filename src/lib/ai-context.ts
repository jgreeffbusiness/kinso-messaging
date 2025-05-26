import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export interface AIContext {
  threadId: string
  summary: string
  keyInsights: string[]
  suggestedActions: SuggestedAction[]
  contactInsights: ContactInsight[]
  threadType: 'meeting' | 'follow-up' | 'connect' | 'admin' | 'other'
  urgency: 'low' | 'medium' | 'high'
  sentiment: 'positive' | 'neutral' | 'negative'
  userRole: 'participant' | 'connector' | 'observer' | 'organizer' | 'recipient'
}

export interface SuggestedAction {
  id: string
  type: 'calendar' | 'reminder' | 'reply' | 'note' | 'task' | 'no-action'
  title: string
  description: string
  confidence: number
  data?: Record<string, unknown>
}

export interface ContactInsight {
  contactName: string
  relationship: string
  lastInteraction?: Date
  totalMessages: number
  context: string
}

export interface ThreadData {
  id: string
  subject: string
  messages: Array<{
    id: string
    content: string
    timestamp: Date
    from: string
    platformData?: Record<string, unknown>
    contact?: {
      id: string
      fullName: string
      email: string | null
    }
  }>
}

export async function generateAIContext(threadData: ThreadData): Promise<AIContext> {
  try {
    const messages = threadData.messages
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    
    // Get current date for time awareness
    const now = new Date()
    const latestMessage = messages[messages.length - 1]
    const daysSinceLatest = Math.floor((now.getTime() - new Date(latestMessage.timestamp).getTime()) / (1000 * 60 * 60 * 24))
    
    const conversation = messages.map(msg => 
      `${msg.contact?.fullName || 'Unknown'} (${new Date(msg.timestamp).toLocaleDateString()}): ${msg.content}`
    ).join('\n\n')

    const prompt = `
Analyze this email thread and provide intelligent context. This thread may include introductions, follow-ups, and multi-participant conversations.

CURRENT DATE: ${now.toLocaleDateString()}
THREAD: ${threadData.subject}
LATEST MESSAGE: ${daysSinceLatest} days ago
CONVERSATION:
${conversation}

CRITICAL SENDER IDENTIFICATION: 
- When you see "Person A (via Person B)", Person A is the actual sender/speaker, NOT Person B
- "via" means sent through someone else's system/account, but Person A is still the one speaking
- Look for the FIRST name before "(via" to identify the real speaker
- Example: "Leesha Doecke (via Braith Leung)" = Leesha is speaking, not Braith

CONVERSATION FLOW ANALYSIS:
- Identify if this is an introduction thread (someone connecting two people)
- Track conversation progression: introduction → acknowledgment → coordination → outcome
- Note when participants shift from being introduced to talking directly with each other
- Capture meeting planning, scheduling, or collaboration that emerges
- Identify the original purpose/context of the introduction

TIME & RELEVANCE ANALYSIS:
- Events/meetings in the past (before ${now.toLocaleDateString()}) should NOT generate action items
- Conversations older than 7 days typically don't need urgent action unless explicitly pending
- Consider if the thread has naturally concluded or if action is still needed
- Look for explicit requests directed at the user vs general conversation

USER ROLE & ACTION CRITERIA:
- ONLY suggest actions if the user is DIRECTLY involved and needs to DO something specific
- DO NOT suggest "monitoring" - that's passive and not actionable
- DO NOT suggest actions for past events or concluded conversations
- DO NOT suggest replies unless the user was directly asked a question or their input is clearly needed
- DO NOT suggest actions just because a conversation exists

STRICT ACTION GUIDELINES:
- "reply" ONLY if user was directly asked a question or their response is clearly expected
- "calendar" ONLY for future events the user needs to attend/schedule
- "reminder" ONLY for specific deadlines or commitments the user made
- "task" ONLY for concrete work items assigned to the user
- "note" for genuinely important information to remember (rare)
- "no-action" if nothing actionable for the user (common and preferred)

Please provide a JSON response with:
1. summary: Rich 2-3 sentence summary capturing the FULL CONVERSATION FLOW and context
2. keyInsights: Array of 2-3 key insights about the relationship, progress, or important developments
3. threadType: meeting|follow-up|connect|admin|other
4. urgency: low|medium|high (consider time relevance)
5. sentiment: positive|neutral|negative
6. userRole: participant|connector|observer|organizer|recipient
7. suggestedActions: Array of 0-2 GENUINELY ACTIONABLE items (often empty) with:
   - type: calendar|reminder|reply|note|task|no-action
   - title: Short action title
   - description: What this action would do
   - confidence: 0-1 confidence score

SUMMARY GUIDELINES:
- For introduction threads: "User introduced [Person A] to [Person B] for [purpose]. They are now [current status/activity]."
- For meeting coordination: "Following [initial context], participants are coordinating [meeting/event] for [date/purpose]."
- For follow-ups: "[Original context] has progressed to [current state]. [Key developments]."
- For concluded/past items: "User [did action]. [Outcome/current status]. No further action needed."

For threadType:
- "connect" = introductions/networking (even if they're now coordinating)
- "admin" = HR, payroll, administrative tasks  
- "meeting" = scheduled events/calls (when that's the PRIMARY purpose)

For userRole:
- "connector" = made introductions, now observing the relationship develop
- "participant" = actively involved in discussion/coordination
- "observer" = monitoring but not participating
- "organizer" = coordinating/managing the process
- "recipient" = receiving information

CRITICAL: Be extremely conservative with action suggestions. Most email threads (80%+) should result in NO actions or just "no-action". Only suggest actions when there's a clear, specific, time-sensitive task that requires the user's direct involvement.

Examples of what NOT to suggest actions for:
- Past meetings or events
- Conversations where others are coordinating without needing user input
- General updates or information sharing
- Introductions where the user's job is done
- Concluded negotiations or decisions
- Social pleasantries or acknowledgments

Focus on the user's ACTUAL role and whether they genuinely need to DO something specific and actionable.
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a highly intelligent email assistant that only suggests actions when truly necessary. Most email threads do not require action. Be conservative and practical. Always respond with valid JSON only, no markdown formatting.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2, // Lower temperature for more consistent, conservative responses
      max_tokens: 800,
      top_p: 0.9
    })

    let responseContent = response.choices[0].message.content || '{}'
    
    // Handle markdown-wrapped JSON responses
    if (responseContent.includes('```json')) {
      responseContent = responseContent.replace(/```json\s*/, '').replace(/\s*```$/, '')
    } else if (responseContent.includes('```')) {
      responseContent = responseContent.replace(/```\s*/, '').replace(/\s*```$/, '')
    }

    let aiResponse
    try {
      aiResponse = JSON.parse(responseContent)
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseContent)
      throw new Error(`Invalid JSON response from AI: ${parseError}`)
    }
    
    // Post-process actions to be even more conservative
    const filteredActions = (aiResponse.suggestedActions || [])
      .filter((action: Partial<SuggestedAction>) => {
        // Remove low-confidence actions
        if ((action.confidence || 0) < 0.6) return false
        
        // Remove actions for old conversations unless explicitly urgent
        if (daysSinceLatest > 7 && aiResponse.urgency !== 'high') return false
        
        return true
      })
      .slice(0, 2) // Maximum 2 actions
    
    // If no specific actions, add no-action to be explicit
    if (filteredActions.length === 0) {
      filteredActions.push({
        id: 'no-action',
        type: 'no-action',
        title: 'No Action Required',
        description: 'This thread doesn\'t require any action from you',
        confidence: 0.9
      })
    }
    
    // Generate contact insights
    const contactInsights = generateContactInsights(messages)
    
    return {
      threadId: threadData.id,
      summary: aiResponse.summary || 'Unable to generate summary',
      keyInsights: aiResponse.keyInsights || [],
      suggestedActions: filteredActions.map((action: Partial<SuggestedAction>, index: number) => ({
        id: `action-${index}`,
        ...action
      })),
      contactInsights,
      threadType: aiResponse.threadType || 'other',
      urgency: aiResponse.urgency || 'low',
      sentiment: aiResponse.sentiment || 'neutral',
      userRole: aiResponse.userRole || 'participant'
    }
  } catch (error) {
    console.error('AI Context generation failed:', error)
    
    // Fallback context - conservative
    return {
      threadId: threadData.id,
      summary: `Thread about: ${threadData.subject}`,
      keyInsights: ['Multiple participants in conversation'],
      suggestedActions: [
        {
          id: 'no-action',
          type: 'no-action',
          title: 'No Action Required',
          description: 'Unable to analyze - no action suggested',
          confidence: 0.5
        }
      ],
      contactInsights: generateContactInsights(threadData.messages),
      threadType: 'other',
      urgency: 'low',
      sentiment: 'neutral',
      userRole: 'participant'
    }
  }
}

function generateContactInsights(messages: ThreadData['messages']): ContactInsight[] {
  const contactMap = new Map<string, ContactInsight>()
  
  messages.forEach(msg => {
    if (msg.contact) {
      const existing = contactMap.get(msg.contact.id)
      if (existing) {
        existing.totalMessages++
        existing.lastInteraction = new Date(Math.max(
          existing.lastInteraction?.getTime() || 0,
          new Date(msg.timestamp).getTime()
        ))
      } else {
        contactMap.set(msg.contact.id, {
          contactName: msg.contact.fullName,
          relationship: 'Contact', // Could be enhanced with more analysis
          lastInteraction: new Date(msg.timestamp),
          totalMessages: 1,
          context: `Recent conversation participant`
        })
      }
    }
  })
  
  return Array.from(contactMap.values()).slice(0, 3) // Top 3 contacts
} 