'use client'

import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { cn } from '@lib/utils'
import { useChat } from '@/providers/ChatProvider'
import { MicrophoneButton } from '@components/MicrophoneButton'
import { 
  Brain, 
  Sparkles,
  Loader2,
  Mail,
  Paperclip,
  Volume2
} from 'lucide-react'
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

// Add the RetrievedSourceItem type here or import it if it's in a shared types file
// For now, defining it here based on assistant-handler's output structure
interface RetrievedSourceItem { 
  id: string; 
  source_type: string; 
  platform?: string; 
  subject?: string; 
  timestamp?: string; 
  preview: string; 
}

// Update AiAssistantApiResponse to include the new field we expect from the backend
interface AiAssistantApiResponse {
  message: string; 
  details?: AiAssistantContext | Record<string, unknown>; 
  followUpQuestion?: string; 
  actionToFulfill?: { type: string; data: Record<string, unknown>; };
  retrieved_sources?: RetrievedSourceItem[]; // Added this field
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
    const userId = "cmb5meg9d003iy5edwbbn7yd4"; // Example, ensure this is correctly obtained if needed by persistMessage or history

    const userTempId = addMessage({ content: currentInput, role: 'user' });
    const currentConversationHistory = [...chatMessages, 
      {id: userTempId, content: currentInput, role: 'user', createdAt: new Date().toISOString()}]
        .map(msg => ({ role: msg.role, content: msg.content }));
    
    persistMessage('user', currentInput, userTempId);

    const contextToSend = aiConversationContext; 
    setInputValue('');
    setAiConversationContext(null); 
    setAiIsResponding(true);

    let apiResponseData: AiAssistantApiResponse | null = null;

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
      apiResponseData = await response.json() as AiAssistantApiResponse;
      
      console.log('[RightPanel handleChatSubmit] Full apiResponseData from backend:', JSON.stringify(apiResponseData, null, 2));

      if (!response.ok || apiResponseData.error) {
        throw new Error(apiResponseData.error || 'AI assistant request failed');
      }
    } catch (error: unknown) {
      console.error("AI Assistant API error:", error);
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred with the AI.";
      apiResponseData = { message: errorMessage, error: errorMessage };
    }

    if (apiResponseData) {
      console.log('[RightPanel handleChatSubmit] Data being passed to addMessage - content:', apiResponseData.message);
      console.log('[RightPanel handleChatSubmit] Data being passed to addMessage - retrieved_sources:', JSON.stringify(apiResponseData.retrieved_sources, null, 2));

      addMessage({
        content: apiResponseData.message, 
        role: 'assistant',
        retrieved_sources: apiResponseData.retrieved_sources,
      });
      persistMessage('assistant', apiResponseData.message, undefined);
      
      if (apiResponseData.followUpQuestion && apiResponseData.details) {
        setAiConversationContext(apiResponseData.details as AiAssistantContext);
      } else {
        console.log("[RightPanel] API does not expect follow-up. Context will be cleared/remain null.");
      }

      if (apiResponseData.actionToFulfill?.type === 'DRAFT_EMAIL') {
        const recipient = apiResponseData.actionToFulfill.data.recipient as string || '';
        const subject = apiResponseData.actionToFulfill.data.subject as string || '';
        const bodyHint = apiResponseData.actionToFulfill.data.bodyHint as string || '';
        const mailto = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyHint + '\n\n(Drafted by AI Assistant)')}`;
        toast.info("Your email draft is ready.", {
          description: `To: ${recipient}`,
          action: { label: "Open Email Client", onClick: () => window.open(mailto, '_blank') }
        });
      }
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
      
      <div className="flex-1 overflow-y-auto p-4 space-y-1 flex flex-col">
        {isLoadingHistory ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="ml-2 text-muted-foreground">Loading chat history...</p>
          </div>
        ) : (
          chatMessages.map(message => {
            // Logic to determine primary source and other sources
            let primarySource: RetrievedSourceItem | null = null;
            let otherSources: RetrievedSourceItem[] = [];
            let identifiedSubjectFromAi: string | null = null;

            if (message.role === 'assistant' && message.retrieved_sources && message.retrieved_sources.length > 0) {
              const subjectHintMatch = message.content.match(/email (?:titled|subject) ['"](.+?)['"]/i);
              identifiedSubjectFromAi = subjectHintMatch ? subjectHintMatch[1] : null;

              if (identifiedSubjectFromAi) {
                primarySource = message.retrieved_sources.find(
                  src => src.subject && src.subject.toLowerCase().includes(identifiedSubjectFromAi!.toLowerCase())
                ) || message.retrieved_sources[0] || null; // Fallback to first if specific subject not found
              } else {
                primarySource = message.retrieved_sources[0] || null; // Default to the first source if no subject hint
              }

              if (primarySource) {
                otherSources = message.retrieved_sources.filter(src => src.id !== primarySource!.id);
              } else {
                otherSources = [...message.retrieved_sources]; // Should not happen if primarySource logic is sound
              }
            }
            return (
              <div
                key={message.id}
                className={cn(
                  "p-3 rounded-lg break-words text-sm shadow-sm max-w-[90%] mb-3",
                  message.role === "assistant"
                    ? "bg-slate-100 text-slate-800 self-start"
                    : "bg-sky-100 text-sky-800 self-end"
                )}
              >
                <div className="flex items-start gap-2">
                  <p className="whitespace-pre-wrap flex-1">{message.content}</p>
                  {message.role === 'assistant' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => speechSynthesis.speak(new SpeechSynthesisUtterance(message.content))}
                    >
                      <Volume2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                
                {primarySource && (
                  <div className="mt-3 pt-3 border-t border-slate-300 space-y-2">
                    <h4 className="text-xs font-bold text-slate-700">Referenced Source:</h4>
                    <div key={`${message.id}-primarysource`} className="p-2 border border-slate-300 rounded-md bg-white shadow-md">
                      <div className="flex items-center gap-2 mb-1">
                        {primarySource.platform === 'email' && <Mail className="h-4 w-4 text-slate-500 flex-shrink-0" />}
                        {(!primarySource.platform || primarySource.platform !== 'email') && <Paperclip className="h-4 w-4 text-slate-500 flex-shrink-0" />}
                        <span className="text-xs font-medium text-slate-700 truncate" title={primarySource.subject || 'Source'}>
                          {primarySource.subject || `Source (${primarySource.platform || primarySource.source_type})`}
                        </span>
                      </div>
                      {primarySource.timestamp && (
                        <p className="text-xs text-slate-500 mb-1">
                          {new Date(primarySource.timestamp).toLocaleDateString()} {new Date(primarySource.timestamp).toLocaleTimeString()}
                        </p>
                      )}
                      <p className="text-xs text-slate-600 line-clamp-3 mb-1" title={primarySource.preview}>
                        {primarySource.preview}
                      </p>
                      <Button 
                        variant="link" size="sm" className="p-0 h-auto text-xs text-blue-600 hover:text-blue-800"
                        onClick={() => { toast.info(`TODO: Show details for ${primarySource.subject || primarySource.id}`); console.log("View Details for primary source:", primarySource); }}
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                )}
                {otherSources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-200 space-y-2">
                    <h4 className="text-xs font-semibold text-slate-600">Other Potentially Relevant Items:</h4>
                    {otherSources.map((source, index) => (
                      <div key={`${message.id}-othersource-${index}`} className="p-2 border border-slate-200 rounded-md bg-white hover:shadow-sm transition-shadow">
                        <div className="flex items-center gap-2 mb-1">
                           {source.platform === 'email' && <Mail className="h-4 w-4 text-slate-500 flex-shrink-0" />}
                           {(!source.platform || source.platform !== 'email') && <Paperclip className="h-4 w-4 text-slate-500 flex-shrink-0" />}
                           <span className="text-xs font-medium text-slate-700 truncate" title={source.subject || 'Source'}>
                             {source.subject || `Source (${source.platform || source.source_type})`}
                           </span>
                         </div>
                        {source.timestamp && <p className="text-xs text-slate-500 mb-1">{new Date(source.timestamp).toLocaleDateString()}</p>}
                        <p className="text-xs text-slate-600 line-clamp-2 mb-1" title={source.preview}>{source.preview}</p>
                        <Button 
                          variant="link" size="sm" className="p-0 h-auto text-xs text-blue-600 hover:text-blue-800"
                          onClick={() => { toast.info(`TODO: Show details for ${source.subject || source.id}`); console.log("View Details for other source:", source); }}
                        >
                          View Details
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
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
          <MicrophoneButton onTranscript={(text) => setInputValue(text)} disabled={aiIsResponding} />
          <Button type="submit" disabled={aiIsResponding || !inputValue.trim()}>Send</Button>
        </form>
      </div>
    </div>
  )
} 