'use client'

import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Badge } from '@components/ui/badge'
import { cn } from '@lib/utils'
import { useChat } from '@/providers/ChatProvider'
import { useActiveFocus } from '@/providers/ActiveFocusProvider'
import { useAIContext } from '@hooks/useAIContext'
import useMessages from '@hooks/useMessages'
import { Message as ThreadMessageItem } from '@hooks/useThreadedMessages'
import { 
  Brain, 
  Calendar, 
  Clock, 
  MessageSquare, 
  StickyNote, 
  CheckSquare,
  Sparkles,
  Eye,
  CheckCircle,
  AlertTriangle,
  Loader2
} from 'lucide-react'
import { SuggestedAction, ThreadAnalysis } from '@/lib/thread-processor'
import { toast } from 'sonner'

// Interface for response from /api/ai/command-handler
// interface CommandHandlerResponse { /* ... */ }

// Interface for response from /api/ai/chat-handler (assuming it returns a 'reply')
// interface ChatHandlerResponse { /* ... */ }

// Interface for what AI Assistant API expects and returns for context
interface AiAssistantContext {
  current_intent?: 'ADD_CONTACT' | 'DRAFT_EMAIL' | string; // Allow for other intents
  name?: string;
  email?: string;
  phone?: string;
  recipient?: string;
  subject?: string;
  bodyHint?: string;
  [key: string]: unknown; // Changed from any to unknown
}

interface AiAssistantApiResponse {
  message: string; // This is the reply_to_user
  details?: AiAssistantContext | Record<string, unknown>; // This can hold the intent_context for next turn or fulfillment data
  followUpQuestion?: string; // If present, indicates API is asking for more info
  actionToFulfill?: { type: string; data: Record<string, unknown>; };
  error?: string;
}

export function RightPanel() {
  const { 
    inputValue, 
    setInputValue, 
    messages: chatMessages,
    addMessage,
    updateMessageId,
    aiIsResponding,
    setAiIsResponding,
    aiConversationContext,
    setAiConversationContext,
    isLoadingHistory
  } = useChat()

  const { activeItem } = useActiveFocus()
  const { messages: allMessagesFromHook } = useMessages()
  
  const { context: aiContext, loading: aiLoading, error: aiError } = useAIContext({
    activeItem: activeItem,
    allMessages: (allMessagesFromHook || []) as ThreadMessageItem[]
  })

  const handleAIAction = (action: SuggestedAction) => {
    let assistantMessage = "";
    let newInputValue = "";

    switch (action.type) {
      case 'reply':
        let contactNameToReply = "the contact";
        if (aiContext?.keyInsights && aiContext.keyInsights.length > 0) {
            // This is a placeholder - ideally aiContext would have a dedicated contactName field
            // or we parse it from action.title or aiContext.summary
        }
        if (activeItem && (activeItem.type === 'message' || activeItem.type === 'dashboard_item')) {
            contactNameToReply = activeItem.data.contact?.fullName || activeItem.data.displayName || contactNameToReply;
        }
        
        const actionTitle = action.title || "this topic";
        const actionDescription = action.description || "the points raised";
        const lastUserMsg = aiContext?.lastUserMessage ? `My last message was: "${aiContext.lastUserMessage.substring(0,100)}..."` : "";
        const unreadContext = aiContext?.unreadHighlights && aiContext.unreadHighlights.length > 0 ? `Their latest updates included: "${aiContext.unreadHighlights.join('; ').substring(0,150)}..."` : "";

        newInputValue = `Draft a reply to ${contactNameToReply} about "${actionTitle}". Focus on: ${actionDescription}. ${lastUserMsg} ${unreadContext} Key point I want to make: `;
        assistantMessage = `Okay, I've started a draft prompt for your reply regarding "${actionTitle}". Please review or add your key points below and send.`;
        setInputValue(newInputValue);
        break;
      case 'calendar': toast.info('Calendar integration coming soon!'); return;
      case 'reminder': toast.info('Reminder feature coming soon!'); return;
      case 'note': assistantMessage = `Note added: ${action.description}`; break;
      case 'task': assistantMessage = `Task created: ${action.title}`; break;
      case 'monitor': assistantMessage = `I'll monitor this thread. You'll be notified if directly addressed.`; break;
      case 'no-action': assistantMessage = `No action needed right now. ${action.description}`; break;
      case 'generic': 
      default:
        assistantMessage = `${action.title} - I'll help with this!`;
        break;
    }

    if (assistantMessage) {
        addMessage({
            content: assistantMessage,
            sender: 'assistant',
            createdAt: new Date().toISOString()
        });
    }
  }

  const getActionIcon = (type: SuggestedAction['type']) => {
    switch (type) {
      case 'calendar': return <Calendar className="h-4 w-4" />
      case 'reminder': return <Clock className="h-4 w-4" />
      case 'reply': return <MessageSquare className="h-4 w-4" />
      case 'note': return <StickyNote className="h-4 w-4" />
      case 'task': return <CheckSquare className="h-4 w-4" />
      case 'monitor': return <Eye className="h-4 w-4" />
      case 'no-action': return <CheckCircle className="h-4 w-4" />
      default: return <Sparkles className="h-4 w-4" />
    }
  }

  const getUrgencyColor = (urgency?: ThreadAnalysis['urgency']) => {
    if (!urgency) return 'bg-gray-100 text-gray-800';
    switch (urgency.toLowerCase()) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-green-100 text-green-800';
    }
  }

  const persistMessage = async (role: 'user' | 'assistant', content: string, tempIdToUpdate?: string) => {
    try {
      const response = await fetch('/api/ai/chat-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content }),
      });
      if (response.ok) {
        const savedMsgData = await response.json();
        if (savedMsgData.success && savedMsgData.message && tempIdToUpdate) {
          updateMessageId(tempIdToUpdate, savedMsgData.message.id);
        } else if (!savedMsgData.success) {
            console.warn("Failed to save message to DB:", savedMsgData.error);
            // Optionally toast a non-blocking warning for the user
        }
      } else {
        const errorData = await response.json();
        console.warn("Error response saving message to DB:", errorData.error);
      }
    } catch (error) {
      console.error("Network error saving message:", error);
      // Optionally toast a non-blocking warning
    }
  };

  const handleChatSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const currentInput = inputValue.trim();
    if (!currentInput) return;

    const userTempId = addMessage({ content: currentInput, role: 'user' });
    const currentConversationHistory = [...chatMessages, 
      {id: userTempId, content: currentInput, role: 'user', createdAt: new Date().toISOString()}]
        .map(msg => ({ role: msg.role, content: msg.content }));
    
    persistMessage('user', currentInput, userTempId);

    const contextToSend = aiConversationContext; 
    setInputValue('');
    setAiConversationContext(null); 
    setAiIsResponding(true);

    let assistantResponseText = "I'm sorry, I encountered an issue processing that.";
    let actionToFulfillOnClient: AiAssistantApiResponse['actionToFulfill'] = undefined;
    let nextIntentContext: AiAssistantContext | null = null;

    try {
      const response = await fetch('/api/ai/assistant-handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: currentInput,
          conversationHistory: currentConversationHistory,
          currentIntentContext: contextToSend
        }),
      });
      const data: AiAssistantApiResponse = await response.json();
      
      if (!response.ok || data.error) {
        throw new Error(data.error || 'AI assistant request failed');
      }
      assistantResponseText = data.message;
      actionToFulfillOnClient = data.actionToFulfill;
      if (data.followUpQuestion && data.details) {
        nextIntentContext = data.details as AiAssistantContext;
        console.log("[RightPanel] API expects follow-up. New intent_context for next turn:", nextIntentContext);
      } else {
        console.log("[RightPanel] API does not expect follow-up. Context will be cleared/remain null.");
      }

    } catch (error: unknown) {
      console.error("AI Assistant API error:", error);
      assistantResponseText = error instanceof Error ? error.message : "An unexpected error occurred with the AI.";
      nextIntentContext = null;
    }

    const assistantTempId = addMessage({ content: assistantResponseText, role: 'assistant' });
    persistMessage('assistant', assistantResponseText, assistantTempId);
    
    setAiConversationContext(nextIntentContext);
    
    if (actionToFulfillOnClient?.type === 'DRAFT_EMAIL') {
      const recipient = actionToFulfillOnClient.data.recipient as string || '';
      const subject = actionToFulfillOnClient.data.subject as string || '';
      const bodyHint = actionToFulfillOnClient.data.bodyHint as string || '';
      const mailto = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyHint + '\n\n(Drafted by AI Assistant)')}`;
      toast.info("Your email draft is ready.", {
        description: `To: ${recipient}`,
        action: { label: "Open Email Client", onClick: () => window.open(mailto, '_blank') }
      });
    }
    setAiIsResponding(false);
  };

  return (
    <div className="border-l w-96 flex flex-col bg-background h-full">
      <div className="flex items-center p-4 border-b">
        <h3 className="font-medium flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          AI Assistant
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoadingHistory ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="ml-2 text-muted-foreground">Loading chat history...</p>
          </div>
        ) : (
          chatMessages.map(message => {
            // console.log("Rendering message:", message); // DEBUG: Check message object structure and role
            return (
              <div 
                key={message.id} 
                className={cn(
                  "p-3 rounded-lg break-words text-sm shadow-sm max-w-[85%]", // Common styles
                  message.role === "assistant" 
                    ? "bg-muted self-start text-foreground" // Ensure assistant has contrasting text
                    : "bg-primary text-primary-foreground self-end" // User styles
                )}
              >
                <p>{message.content}</p>
              </div>
            );
          })
        )}
        {aiIsResponding && (
          <div className="p-3 rounded-lg break-words text-sm shadow-sm bg-muted self-start max-w-[85%]">
            <p className="text-muted-foreground italic flex items-center">
              <Sparkles size={14} className="mr-2 animate-pulse" /> AI is thinking...
            </p>
          </div>
        )}
      </div>
      
      <div className="p-3 border-t bg-background">
        <form onSubmit={handleChatSubmit} className="flex gap-2">
          <Input 
            value={inputValue} 
            onChange={(e) => setInputValue(e.target.value)} 
            placeholder="Ask AI or type your message..." 
            className="flex-1"
            disabled={aiIsResponding}
          />
          <Button type="submit" disabled={aiIsResponding || !inputValue.trim()}>Send</Button>
        </form>
      </div>
    </div>
  )
} 