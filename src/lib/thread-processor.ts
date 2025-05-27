import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Define SuggestedAction here or import from a shared types location
// This structure should match what AIContext and RightPanel expect for actions
export interface SuggestedAction { // Added export if it needs to be imported elsewhere
  id: string; // Or can be generated on client if not from AI
  type: 'calendar' | 'reminder' | 'reply' | 'note' | 'task' | 'no-action' | 'monitor' | 'generic'; // Added monitor & generic
  title: string;
  description: string;
  confidence: number;
  data?: Record<string, unknown>;
}

export interface ThreadMessage { // This is input to analyzeEmailThread
  id: string
  from: string
  to: string[]
  subject: string
  content: string
  timestamp: Date
  direction: 'inbound' | 'outbound'
  isFromUser: boolean
}

// This is also used by useAIContext when preparing data for the API
export interface ThreadData { // Ensure this matches what analyzeEmailThread needs for its messages
  id: string;
  subject: string;
  messages: Array<{
    id: string;
    content: string;
    timestamp: Date;
    from: string;
    to: string[]; // Make 'to' required string[] to match ThreadMessage
    subject: string; // Make 'subject' required to match ThreadMessage
    direction: 'inbound' | 'outbound'; // Make 'direction' required
    isFromUser: boolean; // Make 'isFromUser' required
  }>;
}

// This is the primary output type for AI analysis
export interface ThreadAnalysis { // Added export to make it the canonical type
  summary: string; // Renamed from threadSummary for consistency if AIContext used summary
  keyInsights: string[]; // Renamed from keyTopics
  currentStatus: 'awaiting_user_response' | 'awaiting_contact_response' | 'concluded' | 'ongoing' | 'ongoing_stale';
  unreadHighlights: string[];
  actionItems: SuggestedAction[]; // Changed from string[]
  urgency: 'low' | 'medium' | 'high' | 'urgent';
  relationship_type: 'professional' | 'personal' | 'support' | 'sales' | 'networking' | 'other'; // Renamed from 'relationship' for clarity
  nextSteps: string[];
  lastUserMessage: string | null;
  unresponded: {
    hasUnrespondedMessages: boolean;
    unrespondedCount: number;
    latestUnresponded: string | null;
    daysSinceLastUserReply: number;
  };
  // Add fields that were in AIContext if they are valuable and can be derived by this prompt
  sentiment?: 'positive' | 'neutral' | 'negative';
  userRole?: 'participant' | 'connector' | 'observer' | 'organizer' | 'recipient';
  threadType?: 'meeting' | 'follow-up' | 'connect' | 'admin' | 'other'; // From AIContext
  
  // New fields for deeper context:
  participantContext?: Array<{
    name: string;
    // email?: string; // Optional, if AI can reliably extract
    relationshipToUser?: 'spouse' | 'family' | 'colleague' | 'client' | 'partner' | 'friend' | 'assistant' | 'external_contact' | 'internal_team' | 'unknown';
    roleInThread?: 'sender' | 'recipient' | 'cc' | 'mentioned' | 'forward_recipient';
  }>;
  userIntent?: string; // e.g., "Seeking opinion from spouse", "Requesting feedback", "Delegating task", "FYI"
  forwardContext?: { // If the primary message in the thread seems to be a forward by the user
    isForward: boolean;
    forwardedTo?: string[]; // Names or emails
    originalSender?: string;
    apparentPurpose?: string; // e.g., "For review", "For awareness", "For action by recipient"
  };
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

  const currentDateISO = new Date().toISOString();

  // IMPORTANT: The prompt needs to be updated to request `actionItems` as an array of SuggestedAction objects.
  const prompt = `You are a high-functioning executive assistant for a user whose email is ${userEmail}. Analyzing a conversation primarily with ${contactName}. Today's date is ${currentDateISO}.

CONVERSATION DATA (YOU are ${userEmail}):
${threadContext}

ANALYSIS REQUIREMENTS:
Extract specific, actionable information. Ensure all date assessments consider ${currentDateISO}.

1.  PARTICIPANT CONTEXT (participantContext): Array of objects for key people. For each:
    - name: string (their name)
    - relationshipToUser: spouse|family|colleague|client|partner|friend|assistant|external_contact|internal_team|unknown (their relationship to *${userEmail}* if discernible from context or names like Abby Greeff if user is Jacques Greeff).
    - roleInThread: sender|recipient|cc|mentioned|forward_recipient (their role in the thread).

2.  USER INTENT (userIntent): What was the primary goal or intent of ${userEmail} in initiating or significantly participating in this thread? (e.g., "Seeking opinion from spouse on investment proposal", "Requesting urgent feedback from ${contactName}", "Delegating task to team member", "FYI to stakeholders", "Making an introduction between ${contactName} and X").

3.  FORWARD CONTEXT (forwardContext): If the main message from ${userEmail} appears to be a forward, provide: { isForward: boolean, forwardedTo?: string[], originalSender?: string, apparentPurpose?: string (e.g., "For review by ${contactName}") }. Default to { isForward: false } if not clearly a forward by the user.

4.  EXECUTIVE SUMMARY (summary): 1-2 sentences, "${contactName} (or User) wants/needs X..." incorporating userIntent and key participants.
    - Specifics: numbers, dates (vs ${currentDateISO}), amounts, locations.

5.  KEY INSIGHTS (keyInsights): Array of 2-3 key insights about relationship, progress, or important developments, considering participantContext and userIntent.

6.  CURRENT STATUS (currentStatus): (awaiting_user_response|awaiting_contact_response|concluded|ongoing|ongoing_stale)
    - Consider relevance to ${currentDateISO}. If past relevance/deadline, lean to 'concluded' or 'ongoing_stale'.

7.  ACTION ITEMS (actionItems): Array of 0-2 SuggestedAction objects: { id: string, type: 'calendar'|...'| 'monitor', title: string, description: string, confidence: number (0-1) }.
    - VERY CONSERVATIVE. Only if ${userEmail} must act. Based on userIntent and currentStatus.

8.  URGENCY (urgency): (urgent|high|medium|low). Base on content AND relevance to ${currentDateISO}.

9.  RELATIONSHIP TYPE (relationship_type): professional|personal|support|sales|networking|other (Overall type with ${contactName}).

10. NEXT STEPS (nextSteps): Array of 1-2 broader strategic next steps for ${userEmail}.

11. SENTIMENT (sentiment): positive|neutral|negative (Overall sentiment of ${contactName} towards ${userEmail}/topic).

12. USER ROLE IN THREAD (userRole): participant|connector|observer|organizer|recipient (Role of ${userEmail} in this thread).

13. THREAD CATEGORY (threadType): meeting|follow-up|connect|admin|other.

JSON STRUCTURE (Return ONLY this JSON object):
{
  "participantContext": [ { "name": "Jane Doe", "relationshipToUser": "client", "roleInThread": "recipient" } ],
  "userIntent": "...",
  "forwardContext": { "isForward": false },
  "summary": "...",
  "keyInsights": ["..."],
  "currentStatus": "...",
  "actionItems": [ { "id": "action1", "type": "reply", "title": "...", "description": "...", "confidence": 0.8 } ],
  "urgency": "...",
  "relationship_type": "...",
  "nextSteps": ["..."],
  "sentiment": "...",
  "userRole": "...",
  "threadType": "...",
  "lastUserMessage": "${lastUserMessage?.content.substring(0, 200) || null}",
  "unresponded": {
    "hasUnrespondedMessages": ${unrespondedMessages.length > 0},
    "unrespondedCount": ${unrespondedMessages.length},
    "latestUnresponded": ${unrespondedMessages.length > 0 ? JSON.stringify(unrespondedMessages[unrespondedMessages.length - 1].content.substring(0, 200) + '...') : 'null'},
    "daysSinceLastUserReply": ${daysSinceLastUserReply}
  }
}`

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that analyzes email threads for relationship management. Focus on helping users understand conversation context, what needs attention, and suggested actions. Be concise but thorough. Respond with valid JSON only, no markdown formatting."
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
    
    const parsedAnalysis = JSON.parse(cleanedResponse) as Partial<ThreadAnalysis>
    
    // Ensure all fields of ThreadAnalysis are present, providing defaults for optional ones
    const completeAnalysis: ThreadAnalysis = {
      summary: parsedAnalysis.summary || 'Summary not available.',
      keyInsights: parsedAnalysis.keyInsights || [],
      currentStatus: parsedAnalysis.currentStatus || 'ongoing',
      unreadHighlights: parsedAnalysis.unreadHighlights || [],
      actionItems: parsedAnalysis.actionItems || [{ id: 'default-no-action', type: 'no-action', title: 'No specific action identified', description: '', confidence: 0.5 }],
      urgency: parsedAnalysis.urgency || 'low',
      relationship_type: parsedAnalysis.relationship_type || 'other',
      nextSteps: parsedAnalysis.nextSteps || [],
      lastUserMessage: parsedAnalysis.lastUserMessage !== undefined ? parsedAnalysis.lastUserMessage : null,
      unresponded: parsedAnalysis.unresponded || { hasUnrespondedMessages: false, unrespondedCount: 0, latestUnresponded: null, daysSinceLastUserReply: 0 },
      sentiment: parsedAnalysis.sentiment || 'neutral',
      userRole: parsedAnalysis.userRole || 'participant',
      threadType: parsedAnalysis.threadType || 'other',
      participantContext: parsedAnalysis.participantContext || [],
      userIntent: parsedAnalysis.userIntent || 'Not specified',
      forwardContext: parsedAnalysis.forwardContext || { isForward: false },
    }
    
    return completeAnalysis
    
  } catch (error) {
    console.error('Error in thread analysis:', error)
    
    // Calculate messageAgeInDays for fallback logic as well
    const firstMessageTimestamp = messages.length > 0 ? messages[0].timestamp.getTime() : Date.now();
    const messageAgeInDays = Math.floor((Date.now() - firstMessageTimestamp) / (1000 * 60 * 60 * 24));

    // Fallback analysis needs to include new fields with default values
    const fallbackAnalysis: ThreadAnalysis = {
      summary: `Conversation thread with ${contactName} containing ${messages.length} messages. Latest message from ${lastMessage.isFromUser ? 'you' : contactName}.`,
      keyInsights: ['Email conversation'],
      currentStatus: lastMessage.isFromUser ? 'awaiting_contact_response' : 'awaiting_user_response',
      unreadHighlights: unrespondedMessages.length > 0 ? 
        [`${unrespondedMessages.length} new messages since your last reply`] : [],
      actionItems: [{
        id: 'fallback-no-action',
        type: 'no-action',
        title: 'Review and respond if needed',
        description: lastMessage.isFromUser ? 'Waiting for contact to reply.' : 'Consider reviewing the latest message.',
        confidence: 0.5
      }],
      urgency: unrespondedMessages.length > 2 ? 'high' : (messageAgeInDays > 30 ? 'low' : 'medium'),
      relationship_type: 'professional',
      nextSteps: lastMessage.isFromUser ? ['Wait for response'] : ['Review and respond'],
      lastUserMessage: lastUserMessage?.content.substring(0, 100) || null,
      unresponded: {
        hasUnrespondedMessages: unrespondedMessages.length > 0,
        unrespondedCount: unrespondedMessages.length,
        latestUnresponded: unrespondedMessages.length > 0 ? 
          unrespondedMessages[unrespondedMessages.length - 1].content.substring(0, 200) + '...' : null,
        daysSinceLastUserReply
      },
      sentiment: 'neutral',
      userRole: 'participant',
      threadType: 'other',
      // Defaults for new context fields
      participantContext: [{ name: contactName, relationshipToUser: 'external_contact', roleInThread: 'recipient' }],
      userIntent: 'General communication',
      forwardContext: { isForward: false }
    };

    return fallbackAnalysis
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