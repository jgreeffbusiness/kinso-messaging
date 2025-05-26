import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface ThreadMessage {
  id: string
  from: string
  to: string[]
  subject: string
  content: string
  timestamp: Date
  direction: 'inbound' | 'outbound'
  isFromUser: boolean
}

interface ThreadAnalysis {
  threadSummary: string
  keyTopics: string[]
  currentStatus: 'awaiting_user_response' | 'awaiting_contact_response' | 'concluded' | 'ongoing'
  unreadHighlights: string[]
  actionItems: string[]
  urgency: 'low' | 'medium' | 'high' | 'urgent'
  relationship: 'professional' | 'personal' | 'support' | 'sales' | 'networking'
  nextSteps: string[]
  lastUserMessage: string | null
  unresponded: {
    hasUnrespondedMessages: boolean
    unrespondedCount: number
    latestUnresponded: string | null
    daysSinceLastUserReply: number
  }
}

export async function analyzeEmailThread(
  messages: ThreadMessage[], 
  userEmail: string,
  contactName: string
): Promise<ThreadAnalysis> {
  
  // Sort messages chronologically
  const sortedMessages = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  
  // Identify user participation
  const userMessages = sortedMessages.filter(msg => msg.isFromUser)
  const lastMessage = sortedMessages[sortedMessages.length - 1]
  const lastUserMessage = userMessages[userMessages.length - 1]
  
  // Calculate unresponded metrics
  const unrespondedMessages = []
  let lastUserReplyIndex = -1
  
  // Find the last message from the user
  for (let i = sortedMessages.length - 1; i >= 0; i--) {
    if (sortedMessages[i].isFromUser) {
      lastUserReplyIndex = i
      break
    }
  }
  
  // Messages after the last user reply are unresponded
  if (lastUserReplyIndex < sortedMessages.length - 1) {
    unrespondedMessages.push(...sortedMessages.slice(lastUserReplyIndex + 1))
  }
  
  const daysSinceLastUserReply = lastUserMessage ? 
    Math.floor((Date.now() - lastUserMessage.timestamp.getTime()) / (1000 * 60 * 60 * 24)) : 0
  
  // Create thread context for AI
  const threadContext = sortedMessages.map((msg, index) => {
    const timeAgo = Math.floor((Date.now() - msg.timestamp.getTime()) / (1000 * 60 * 60 * 24))
    const sender = msg.isFromUser ? 'YOU' : contactName
    return `[${index + 1}] ${sender} (${timeAgo} days ago):\nSubject: ${msg.subject}\n${msg.content}\n---\n`
  }).join('\n')

  const prompt = `Analyze this email thread between the user and ${contactName}. Focus on understanding the conversation flow, relationship development, and contextual narrative - not just individual message content.

THREAD CONTEXT:
${threadContext}

CONVERSATION FLOW ANALYSIS:
- Identify if this started as an introduction (user connecting people)
- Track progression: introduction → acknowledgment → direct communication → coordination
- Note if participants have moved beyond introductions to working together
- Capture meeting planning, collaboration, or relationship development
- Understand if user's role has shifted from active participant to connector/observer

ANALYSIS REQUIREMENTS:
1. THREAD SUMMARY: Provide a rich narrative summary of the ENTIRE conversation journey, including:
   - Original purpose/context (if introduction, business development, etc.)
   - How the relationship has progressed
   - Current status and what's happening now
   - Key outcomes or next steps
2. KEY TOPICS: Extract the main themes throughout the conversation evolution
3. CURRENT STATUS: Determine if the thread is awaiting user response, contact response, concluded, or ongoing
4. UNREAD HIGHLIGHTS: If there are messages after the user's last reply, highlight the key developments they need to know
5. ACTION ITEMS: What specific actions or responses are needed (be realistic about user's actual role)
6. URGENCY: Rate the urgency based on content, timing, and response expectations
7. RELATIONSHIP TYPE: Categorize the relationship context and current dynamics
8. NEXT STEPS: Suggest what the user should do next based on their role in the conversation

NARRATIVE EXAMPLES:
- "User introduced [Contact] to [Person] for business development. They have since established a working relationship and are coordinating a project meeting."
- "Following user's introduction, [Contact] and [Person] are now planning a collaboration meeting for next week, with user monitoring the development."
- "User facilitated a connection between [Contact] and [Team]. The relationship has progressed to active project coordination."

UNRESPONDED CONTEXT:
- Messages since user's last reply: ${unrespondedMessages.length}
- Days since user's last reply: ${daysSinceLastUserReply}
- Last message was from: ${lastMessage.isFromUser ? 'USER' : contactName}

Return a JSON object with this structure:
{
  "threadSummary": "Rich narrative capturing full conversation arc and current state",
  "keyTopics": ["conversation themes throughout the thread"],
  "currentStatus": "awaiting_user_response|awaiting_contact_response|concluded|ongoing",
  "unreadHighlights": ["key developments since user's last message"],
  "actionItems": ["realistic actions based on user's actual role"],
  "urgency": "low|medium|high|urgent",
  "relationship": "professional|personal|support|sales|networking",
  "nextSteps": ["contextually appropriate suggestions"],
  "lastUserMessage": "string or null",
  "unresponded": {
    "hasUnrespondedMessages": boolean,
    "unrespondedCount": number,
    "latestUnresponded": "string or null",
    "daysSinceLastUserReply": number
  }
}`

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that analyzes email threads for relationship management. Focus on helping users understand conversation context, what needs attention, and suggested actions. Be concise but thorough."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    })

    const response = completion.choices[0]?.message?.content
    if (!response) {
      throw new Error('No response from OpenAI')
    }

    // Clean up markdown formatting if present
    const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    const analysis = JSON.parse(cleanedResponse) as ThreadAnalysis
    
    // Ensure unresponded data is included
    analysis.unresponded = {
      hasUnrespondedMessages: unrespondedMessages.length > 0,
      unrespondedCount: unrespondedMessages.length,
      latestUnresponded: unrespondedMessages.length > 0 ? 
        unrespondedMessages[unrespondedMessages.length - 1].content.substring(0, 200) + '...' : null,
      daysSinceLastUserReply
    }
    
    return analysis
    
  } catch (error) {
    console.error('Error in thread analysis:', error)
    
    // Return fallback analysis
    return {
      threadSummary: `Conversation thread with ${contactName} containing ${messages.length} messages. Latest message from ${lastMessage.isFromUser ? 'you' : contactName}.`,
      keyTopics: ['Email conversation'],
      currentStatus: lastMessage.isFromUser ? 'awaiting_contact_response' : 'awaiting_user_response',
      unreadHighlights: unrespondedMessages.length > 0 ? 
        [`${unrespondedMessages.length} new messages since your last reply`] : [],
      actionItems: lastMessage.isFromUser ? [] : ['Review and respond to latest message'],
      urgency: unrespondedMessages.length > 2 ? 'high' : 'medium',
      relationship: 'professional',
      nextSteps: lastMessage.isFromUser ? ['Wait for response'] : ['Review and respond'],
      lastUserMessage: lastUserMessage?.content.substring(0, 100) || null,
      unresponded: {
        hasUnrespondedMessages: unrespondedMessages.length > 0,
        unrespondedCount: unrespondedMessages.length,
        latestUnresponded: unrespondedMessages.length > 0 ? 
          unrespondedMessages[unrespondedMessages.length - 1].content.substring(0, 200) + '...' : null,
        daysSinceLastUserReply
      }
    }
  }
}

export async function processEmailThread(
  threadId: string,
  messages: ThreadMessage[],
  userEmail: string,
  contactName: string
) {
  try {
    const analysis = await analyzeEmailThread(messages, userEmail, contactName)
    
    return {
      threadId,
      analysis,
      processedAt: new Date(),
      messageCount: messages.length,
      lastActivity: messages[messages.length - 1].timestamp
    }
  } catch (error) {
    console.error('Error processing email thread:', error)
    throw error
  }
} 