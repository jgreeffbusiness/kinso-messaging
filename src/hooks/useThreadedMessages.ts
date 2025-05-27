import { useMemo } from 'react'
import { ThreadAnalysis } from '@/lib/thread-processor'

export interface PlatformData {
  subject?: string
  direction?: 'inbound' | 'outbound'
  from?: string
  to?: string[]
  cc?: string[]
  labels?: string[]
  threadId?: string
  aiSummary?: string
  keyPoints?: string[]
  actionItems?: string[]
  urgency?: 'low' | 'medium' | 'high' | 'urgent'
  category?: 'meeting' | 'administrative' | 'commercial' | 'personal' | 'notification' | 'other'
  originalContent?: string
  isThreadSummary?: boolean
  analysis?: ThreadAnalysis | null
  messageCount?: number
}

export interface Message {
  id: string
  platform: string
  content: string
  timestamp: Date
  platformData: PlatformData
  contact: {
    id: string
    fullName: string
    email: string | null
    platformData?: Record<string, any>
  } | null
  readAt?: Date | null
}

export interface EnhancedMessage extends Message {
  threadCount?: number
  threadMessages?: Message[]
  actualSender?: {
    name: string
    email: string
  }
  displayName: string
  priorityScore: number
}

interface PriorityScoreFactors {
  isAwaitingUserResponse: boolean;
  urgency?: 'low' | 'medium' | 'high' | 'urgent';
  isUnread: boolean;
  currentStatus?: 'awaiting_user_response' | 'awaiting_contact_response' | 'concluded' | 'ongoing' | 'ongoing_stale';
  messageTimestamp: Date;
}

function calculatePriorityScore(factors: PriorityScoreFactors): number {
  let score = 0;
  const now = new Date().getTime();
  const messageAgeInDays = (now - new Date(factors.messageTimestamp).getTime()) / (1000 * 60 * 60 * 24);

  let urgencyBoost = 0;
  if (factors.currentStatus === 'awaiting_user_response') {
    if (messageAgeInDays <= 30) {
        urgencyBoost += 1000;
    } else if (messageAgeInDays <= 90) {
        urgencyBoost += 500;
    }
  }

  switch (factors.urgency) {
    case 'urgent':
      urgencyBoost += 500;
      break;
    case 'high':
      urgencyBoost += 250;
      break;
    case 'medium':
      urgencyBoost += 50;
      break;
    default:
      break;
  }

  if (messageAgeInDays > 90) {
    urgencyBoost *= 0.1; 
  } else if (messageAgeInDays > 30) {
    urgencyBoost *= 0.25;
  } else if (messageAgeInDays > 7) {
    urgencyBoost *= 0.5;
  }
  score += urgencyBoost;
  
  if (factors.isUnread && factors.currentStatus !== 'awaiting_user_response') {
    if (urgencyBoost < 250) { 
      score += Math.max(0, 20 - messageAgeInDays); 
    }
  }

  if (factors.currentStatus === 'concluded' || factors.currentStatus === 'ongoing_stale') {
    score -= 2000;
  }
  
  if (factors.currentStatus !== 'concluded' && factors.currentStatus !== 'ongoing_stale' && messageAgeInDays > 180) { 
      score -= 500;
  }

  return score;
}

export function useThreadedMessages(messages: Message[], currentUserSlackId?: string): EnhancedMessage[] {
  return useMemo(() => {
    if (!messages || messages.length === 0) return []

    const nonSelfMessages = currentUserSlackId
      ? messages.filter(msg => {
          if (msg.platform?.startsWith('slack')) {
            const contactOfMessage = msg.contact;
            if (contactOfMessage?.platformData?.slack?.platformContactId === currentUserSlackId) {
              // console.log(`Filtering out self-message/summary for contact ${contactOfMessage.fullName} (Slack ID: ${currentUserSlackId})`);
              return false; 
            }
          }
          return true; 
        })
      : messages;

    const threadSummaries = nonSelfMessages.filter(msg => 
      msg.platform === 'thread_summary' || 
      msg.platform === 'email_thread' || 
      msg.platform === 'slack_thread_summary' ||
      msg.platformData?.isThreadSummary === true
    );
    
    const regularMessages = nonSelfMessages.filter(msg => 
      !['thread_summary', 'email_thread', 'slack_thread_summary'].includes(msg.platform) &&
      !msg.platformData?.isThreadSummary
    );

    const threadGroups = new Map<string, Message[]>();
    
    regularMessages.forEach(message => {
      if (message.platformData?.threadId) {
        const threadId = message.platformData.threadId!;
        if (!threadGroups.has(threadId)) {
          threadGroups.set(threadId, []);
        }
        threadGroups.get(threadId)!.push(message);
        return;
      }
      const contact = message.contact;
      if (!contact) {
        threadGroups.set(message.id, [message]);
        return;
      }
      const baseConversationKey = `${contact.id}_${message.platform}`;
      let matchingThreadKey: string | null = null;
      const messageTime = new Date(message.timestamp).getTime();
      const timeWindow = message.platform === 'slack' 
        ? 7 * 24 * 60 * 60 * 1000 
        : 3 * 24 * 60 * 60 * 1000;
      const windowStart = messageTime - timeWindow;
      for (const [existingKey, existingMessages] of threadGroups.entries()) {
        if (existingKey.startsWith(baseConversationKey)) {
          const hasRecentMessage = existingMessages.some(msg => 
            new Date(msg.timestamp).getTime() > windowStart
          );
          if (hasRecentMessage) {
            matchingThreadKey = existingKey;
            break;
          }
        }
      }
      if (matchingThreadKey) {
        threadGroups.get(matchingThreadKey)!.push(message);
      } else {
        const newThreadKey = `${baseConversationKey}_${messageTime}`;
        threadGroups.set(newThreadKey, [message]);
      }
    });

    const deduplicatedMessages: EnhancedMessage[] = [];
    
    threadSummaries.forEach(threadSummary => {
      const currentPlatformData = threadSummary.platformData;
      const analysisData = currentPlatformData?.analysis;
      const messageCount = currentPlatformData?.messageCount || 1;
      
      let correspondingMessages: Message[] = [];
      if (threadSummary.platform === 'slack_thread_summary') {
        correspondingMessages = regularMessages.filter(msg => 
          msg.platform === 'slack' && 
          msg.contact?.id === threadSummary.contact?.id
        ).sort((a: Message, b: Message) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      } else if (currentPlatformData?.threadId) {
        correspondingMessages = regularMessages.filter(msg => 
          msg.platformData?.threadId === currentPlatformData.threadId
        ).sort((a: Message, b: Message) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }
      
      const priorityScore = calculatePriorityScore({
        isAwaitingUserResponse: analysisData?.currentStatus === 'awaiting_user_response',
        urgency: analysisData?.urgency,
        isUnread: !threadSummary.readAt,
        currentStatus: analysisData?.currentStatus,
        messageTimestamp: threadSummary.timestamp
      });

      const finalPlatformData: PlatformData = {
        ...currentPlatformData,
        subject: currentPlatformData?.subject || `Conversation with ${threadSummary.contact?.fullName}`,
        aiSummary: analysisData?.summary || threadSummary.content,
        keyPoints: analysisData?.keyInsights || currentPlatformData?.keyPoints ||  [],
        actionItems: (analysisData?.actionItems?.map(a => a.title)) || currentPlatformData?.actionItems || [],
        urgency: analysisData?.urgency || currentPlatformData?.urgency || 'low',
        isThreadSummary: true,
        analysis: analysisData,
        messageCount: messageCount
      };

      deduplicatedMessages.push({
        ...threadSummary,
        threadCount: messageCount > 1 ? messageCount : undefined,
        threadMessages: correspondingMessages.length > 0 ? correspondingMessages : undefined,
        actualSender: undefined,
        displayName: threadSummary.contact?.fullName || 'Unknown',
        priorityScore,
        platformData: finalPlatformData
      });
    });

    threadGroups.forEach((threadMsgs, threadId) => {
      const sortedMessages = threadMsgs.sort((a: Message, b: Message) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      const latestMessage = sortedMessages[0]

      let hasThreadSummary = false
      if (latestMessage?.platform === 'slack') {
        hasThreadSummary = threadSummaries.some(summary => 
          summary.platform === 'slack_thread_summary' &&
          summary.contact?.id === latestMessage.contact?.id
        )
      } else {
        hasThreadSummary = threadSummaries.some(summary => 
          summary.platformData?.threadId === threadId
        )
      }
      
      if (hasThreadSummary) {
        return
      }
      
      const threadCount = sortedMessages.length
      const actualSender = parseActualSender(latestMessage.platformData?.from)
      const displayName = generateDisplayName(latestMessage, actualSender)
      const generateConversationSubject = (msgs: Message[], latestMsg: Message): string => {
        if (latestMsg.platformData?.subject && latestMsg.platformData.subject !== '(No subject)') {
          return latestMsg.platformData.subject!
        }
        if (msgs.length > 1) {
          const platform = latestMsg.platform
          const contactName = latestMsg.contact?.fullName || 'Unknown'
          if (platform === 'slack') {
            return `Conversation with ${contactName}`
          } else if (platform === 'email' || platform === 'gmail') {
            return `Email thread with ${contactName}`
          } else {
            return `${platform} conversation with ${contactName}`
          }
        }
        const content = latestMsg.content || ''
        if (content.length > 0) {
          const firstLine = content.split('\n')[0]
          const preview = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine
          return preview
        }
        return '(No subject)'
      }
      const conversationSubject = generateConversationSubject(sortedMessages, latestMessage)
      
      const regularMsgAnalysis = latestMessage.platformData?.analysis;
      const priorityScoreForRegular = calculatePriorityScore({
        isAwaitingUserResponse: regularMsgAnalysis?.currentStatus === 'awaiting_user_response',
        urgency: regularMsgAnalysis?.urgency || latestMessage.platformData?.urgency || 'low',
        isUnread: !latestMessage.readAt,
        currentStatus: regularMsgAnalysis?.currentStatus || 'ongoing', 
        messageTimestamp: latestMessage.timestamp
      });

      deduplicatedMessages.push({
        ...latestMessage,
        threadCount: threadCount > 1 ? threadCount : undefined,
        threadMessages: threadCount > 1 ? sortedMessages : undefined,
        actualSender,
        displayName,
        priorityScore: priorityScoreForRegular,
        platformData: {
          ...latestMessage.platformData,
          subject: conversationSubject
        }
      })
    })

    return deduplicatedMessages.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [messages, currentUserSlackId]);
}

function parseActualSender(fromField?: string): { name: string; email: string } | undefined {
  if (!fromField) return undefined
  const emailMatch = fromField.match(/<(.+?)>/)
  const nameMatch = fromField.match(/^([^<]+)/)
  if (emailMatch) {
    return {
      email: emailMatch[1].trim(),
      name: nameMatch ? nameMatch[1].trim() : emailMatch[1].trim()
    }
  }
  return {
    email: fromField.trim(),
    name: fromField.trim()
  }
}

function generateDisplayName(
  message: Message, 
  actualSender?: { name: string; email: string }
): string {
  if (!actualSender || !message.contact) {
    return message.contact?.fullName || 'Unknown'
  }
  const contactEmail = message.contact.email?.toLowerCase()
  const senderEmail = actualSender.email.toLowerCase()
  if (contactEmail === senderEmail) {
    return message.contact.fullName
  }
  return `${actualSender.name} (via ${message.contact.fullName})`
} 