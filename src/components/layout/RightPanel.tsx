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
  AlertTriangle
} from 'lucide-react'
import { SuggestedAction, ThreadAnalysis } from '@/lib/thread-processor'
import { toast } from 'sonner'

// Interface for response from /api/ai/command-handler
interface CommandHandlerResponse {
  message: string;
  details?: Record<string, unknown>;
  error?: string;
  followUpQuestion?: string; 
  actionToFulfill?: { 
    type: string; 
    data: Record<string, unknown>;
  }
}

// Interface for response from /api/ai/chat-handler (assuming it returns a 'reply')
interface ChatHandlerResponse {
  reply: string;
  error?: string;
}

export function RightPanel() {
  const { 
    inputValue, 
    setInputValue, 
    messages: chatMessages,
    addMessage,
    aiIsResponding,
    setAiIsResponding,
    aiConversationContext,
    setAiConversationContext
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

  const handleChatSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const currentInput = inputValue.trim();
    if (!currentInput) return;

    addMessage({ content: currentInput, sender: 'user', createdAt: new Date().toISOString() });
    const previousContext = aiConversationContext;
    setInputValue('');
    setAiConversationContext(null);
    setAiIsResponding(true);

    let assistantResponseText = "I'm sorry, I encountered an issue processing that.";
    let commandActionToFulfill: CommandHandlerResponse['actionToFulfill'] = undefined;
    let nextAiConversationContext: CommandHandlerResponse['details'] = undefined;

    const commandLower = currentInput.toLowerCase();
    const isLikelyCommand = previousContext?.intentContext === 'ADD_CONTACT' || 
                            commandLower.startsWith('add contact') || 
                            commandLower.startsWith('create contact') || 
                            commandLower.startsWith('send email');

    try {
      if (isLikelyCommand) {
        console.log("[RightPanel] Routing to command-handler with input:", currentInput, "and context:", previousContext);
        const response = await fetch('/api/ai/command-handler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: currentInput, context: previousContext }),
        });
        const data: CommandHandlerResponse = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data.error || 'Command handler request failed');
        }
        assistantResponseText = data.message;
        commandActionToFulfill = data.actionToFulfill;
        if (data.followUpQuestion) {
          nextAiConversationContext = data.details;
        }
      } else {
        console.log("[RightPanel] Routing to chat-handler for:", currentInput);
        const response = await fetch('/api/ai/chat-handler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userInput: currentInput,
            conversationContext: aiContext,
            activeItemType: activeItem?.type,
            activeItemData: activeItem?.type !== 'message_id_only' ? activeItem?.data : { id: activeItem?.id }
          }),
        });
        const data = await response.json() as ChatHandlerResponse;
        if (!response.ok) {
            throw new Error(data.error || 'Chat handler API request failed');
        }
        assistantResponseText = data.reply;
      }
    } catch (error: unknown) {
      console.error("AI Handler API error:", error);
      assistantResponseText = error instanceof Error ? error.message : "An unexpected error occurred with the AI.";
    }

    addMessage({ content: assistantResponseText, sender: 'assistant', createdAt: new Date().toISOString() });
    
    if (commandActionToFulfill?.type === 'DRAFT_EMAIL') {
      const recipient = commandActionToFulfill.data.recipient as string || '';
      const subject = commandActionToFulfill.data.subject as string || '';
      const bodyHint = commandActionToFulfill.data.bodyHint as string || '';
      const mailto = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyHint + '\n\n(Drafted by AI Assistant)')}`;
      toast.info("Your email draft is ready to review.", {
        description: `To: ${recipient}, Subject: ${subject}`,
        action: { label: "Open Email Client", onClick: () => window.open(mailto, '_blank') }
      });
    }

    setAiConversationContext(nextAiConversationContext || null);
    setAiIsResponding(false);
  };

  return (
    <div className="border-l w-96 flex flex-col bg-background">
      <div className="flex items-center p-4 border-b">
        <h3 className="font-medium flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          AI Assistant
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {activeItem ? (
          <div className="p-4 border-b bg-muted/50">
            {aiLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Analyzing...
                </div>
              </div>
            ) : aiError ? (
              <div className="text-center py-4 text-destructive-foreground bg-destructive/90 p-3 rounded-md">
                <AlertTriangle className="h-5 w-5 mx-auto mb-1" />
                <p className="text-xs">Error loading AI insights: {aiError}</p>
              </div>
            ) : aiContext ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <Badge variant="outline" className={cn("text-xs font-semibold px-2 py-1", getUrgencyColor(aiContext.urgency))}>
                      {aiContext.urgency?.toUpperCase() || 'N/A'}
                    </Badge>
                    {aiContext.threadType && <Badge variant="outline" className="text-xs">{aiContext.threadType.replace(/_/g, ' ')}</Badge>}
                  </div>
                  {aiContext.currentStatus && typeof aiContext.currentStatus === 'string' && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Status:</span> {aiContext.currentStatus.replace(/_/g, ' ')}
                    </p>
                  )}
                  {aiContext.unresponded?.hasUnrespondedMessages && aiContext.unresponded.unrespondedCount > 0 && (
                    <p className="text-xs text-amber-700">
                      <AlertTriangle size={12} className="inline mr-1 mb-0.5" />
                      {aiContext.unresponded.unrespondedCount} new message{aiContext.unresponded.unrespondedCount > 1 ? 's' : ''} since your last reply ({aiContext.unresponded.daysSinceLastUserReply}d ago).
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-1 text-foreground">Summary</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {aiContext.summary}
                  </p>
                </div>

                {aiContext.unresponded?.hasUnrespondedMessages && Array.isArray(aiContext.unreadHighlights) && aiContext.unreadHighlights.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-1 text-foreground">Recent Updates:</h4>
                    <ul className="space-y-1 list-disc list-inside pl-1">
                      {aiContext.unreadHighlights.slice(0, 3).map((highlight: string, index: number) => (
                        <li key={`highlight-${index}`} className="text-sm text-muted-foreground">
                          {highlight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(aiContext.keyInsights) && aiContext.keyInsights.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-1 text-foreground">Key Insights</h4>
                    <ul className="space-y-1.5">
                      {aiContext.keyInsights.slice(0, 3).map((insight: string, index: number) => (
                        <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span className="w-1.5 h-1.5 bg-primary/70 rounded-full mt-[6px] flex-shrink-0"></span>
                          <span>{insight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(aiContext.actionItems) && aiContext.actionItems.length > 0 && 
                 !(aiContext.actionItems.length === 1 && aiContext.actionItems[0]?.type === 'no-action') && (
                  <div>
                    <h4 className="text-sm font-semibold mb-1.5 text-foreground">Suggested Actions</h4>
                    <div className="space-y-2">
                      {aiContext.actionItems.slice(0, 3).map((action: SuggestedAction, index: number) => (
                        action.type === 'no-action' ? null : (
                          <Button
                            key={action.id || `action-${index}`}
                            variant="outline"
                            size="sm"
                            className="w-full justify-start gap-2 h-auto p-2 text-sm hover:bg-primary/5 hover:border-primary/30"
                            onClick={() => handleAIAction(action)}
                          >
                            {getActionIcon(action.type)}
                            <span className="flex-1 text-left truncate min-w-0 font-medium">{action.title}</span>
                            {action.confidence !== undefined && (
                              <Badge variant="secondary" className="text-xs">
                                {Math.round(action.confidence * 100)}%
                              </Badge>
                            )}
                          </Button>
                        )
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p>No AI insights for this item, or item not fully analyzed.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-center text-sm text-muted-foreground">
             Select an item from the dashboard or messages to see AI insights.
          </div>
        )}

        <div className="flex-grow flex flex-col justify-end p-4 space-y-3">
          {chatMessages.map(message => (
            <div 
              key={message.id} 
              className={cn(
                "p-3 rounded-lg break-words text-sm shadow-sm",
                message.sender === "assistant" 
                  ? "bg-muted self-start max-w-[85%]"
                  : "bg-primary text-primary-foreground self-end max-w-[85%]"
              )}
            >
              <p>{message.content}</p>
            </div>
          ))}
          {aiIsResponding && (
            <div className="p-3 rounded-lg break-words text-sm shadow-sm bg-muted self-start max-w-[85%]">
              <p className="text-muted-foreground italic flex items-center">
                <Sparkles size={14} className="mr-2 animate-pulse" /> AI is thinking...
              </p>
            </div>
          )}
        </div>
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