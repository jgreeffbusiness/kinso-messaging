'use client'

import React, { createContext, useContext, useState, ReactNode, Dispatch, SetStateAction, useCallback, useEffect } from 'react'
import { toast } from 'sonner'

// Assuming CommandHandlerResponse details structure (can be imported or refined)
// This defines what part of CommandHandlerResponse.details we store in context
interface AiConversationContextData {
  intentContext?: string;
  contactName?: string;
  [key: string]: unknown; // Changed from any to unknown for better type safety
}

// Define the structure for items in the retrieved_sources array
export type RetrievedSourceItem = {
  id: string;          // Original Message ID or entity ID
  source_type: string; // e.g., 'platform_messages', 'contact', 'note'
  platform?: string;    // e.g., 'email', 'slack'
  subject?: string;     // e.g., email subject
  timestamp?: string;   // ISO date string
  preview: string;     // The content chunk or a summary preview
  name?: string;        // For contacts: full name
  // Add other common fields or make a union type if structures vary wildly
};

// Update Message type to include retrieved_sources
export type Message = {
  id: string; 
  content: string;
  role: 'user' | 'assistant'; 
  createdAt: string;
  retrieved_sources?: RetrievedSourceItem[]; // Optional array of source items
  // Potentially add other fields from AiAssistantApiResponse like 'details' if needed for UI
  // For example: details?: AiAssistantContext | Record<string, unknown>;
};

export type ChatContextType = {
  inputValue: string
  setInputValue: Dispatch<SetStateAction<string>>
  messages: Message[]
  // Update addMessage to accept the full Message type (excluding id, createdAt, but including new optional fields)
  addMessage: (message: Omit<Message, 'id' | 'createdAt'> & { tempId?: string, createdAt?: string }) => string; 
  updateMessageId: (temporaryId: string, newId: string) => void; 
  aiIsResponding: boolean
  setAiIsResponding: Dispatch<SetStateAction<boolean>>
  aiConversationContext: AiConversationContextData | null
  setAiConversationContext: Dispatch<SetStateAction<AiConversationContextData | null>>
  clearChat: () => void
  isLoadingHistory: boolean
}

const CHAT_HISTORY_LOCAL_STORAGE_KEY = 'kinso-ai-chat-history'

const ChatContext = createContext<ChatContextType | undefined>(undefined)

const initialAssistantMessage = (): Message => ({
  id: `temp-${Date.now()}`,
  content: "How can I help you today?",
  role: "assistant",
  createdAt: new Date().toISOString()
  // No retrieved_sources for initial message
})

export function ChatProvider({ children }: { children: ReactNode }) {
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [aiIsResponding, setAiIsResponding] = useState(false)
  const [aiConversationContext, setAiConversationContext] = useState<AiConversationContextData | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  
  // Load initial chat history from backend
  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoadingHistory(true)
      try {
        const response = await fetch('/api/ai/chat-messages?limit=50') // Adjust limit as needed
        if (!response.ok) {
          const errData = await response.json()
          throw new Error(errData.error || 'Failed to fetch chat history')
        }
        const data = await response.json()
        // Type msg as Omit<Message, 'id'> & { id: string | number } to handle potential number IDs from older storage
        // or more strictly as the expected API response structure (ChatMessageForClient implies id is string)
        const fetchedMessages = (data.messages || []).map((msg: {id: string | number, content: string, role: 'user' | 'assistant', createdAt: string }) => ({
          ...msg,
          id: String(msg.id) // Ensure ID is always string for internal state
        }))
        if (fetchedMessages.length > 0) {
          setMessages(fetchedMessages)
        } else {
          setMessages([initialAssistantMessage()]) // Start with initial if history is empty
        }
      } catch (error) {
        console.error("Error loading chat history from backend:", error)
        toast.error("Could not load chat history.")
        // Fallback to local storage or just initial message if backend fails
        try {
          const storedMessages = localStorage.getItem(CHAT_HISTORY_LOCAL_STORAGE_KEY)
          if (storedMessages) {
            const parsedMessages = JSON.parse(storedMessages) as Message[]
            if (Array.isArray(parsedMessages) && parsedMessages.length > 0 && parsedMessages[0]?.id && parsedMessages[0]?.content) {
              setMessages(parsedMessages.map(m => ({...m, id: String(m.id)}))) // Ensure string IDs
              setIsLoadingHistory(false)
              return
            }
          }
        } catch (localError) { console.error("Error loading from localStorage fallback:", localError) }
        setMessages([initialAssistantMessage()])
      }
      setIsLoadingHistory(false)
    }
    fetchHistory()
  }, []) // Run once on mount

  // Save messages to localStorage as a fallback or for quick offline view (optional)
  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoadingHistory && messages.length > 0) { // Only save if not loading and messages exist
      try {
        localStorage.setItem(CHAT_HISTORY_LOCAL_STORAGE_KEY, JSON.stringify(messages))
      } catch (error) { console.error("Error saving chat history to localStorage:", error) }
    }
  }, [messages, isLoadingHistory])

  const addMessage = useCallback((messageInput: Omit<Message, 'id' | 'createdAt'> & { tempId?: string, createdAt?: string }): string => {
    // Destructure all potential fields from messageInput, including the new ones
    const { role, content, retrieved_sources, tempId, createdAt } = messageInput;
    const temporaryId = tempId || `temp-${Date.now()}-${Math.random()}`;
    
    const newMessage: Message = {
      id: temporaryId,
      role,
      content,
      createdAt: createdAt || new Date().toISOString(),
      // Add retrieved_sources if it exists in messageInput
      ...(retrieved_sources && { retrieved_sources }),
    };
    console.log("[ChatProvider] Adding message:", JSON.stringify(newMessage));
    setMessages(prev => [...prev, newMessage]);
    return temporaryId; 
  }, []);

  const updateMessageId = useCallback((temporaryId: string, newId: string) => {
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg.id === temporaryId ? { ...msg, id: newId } : msg
      )
    )
  }, [])

  const clearChat = useCallback(() => {
    // TODO: Optionally call an API to clear chat history on the backend too
    const newInitialMsg = initialAssistantMessage()
    setMessages([newInitialMsg])
    setInputValue('')
    setAiConversationContext(null)
    setAiIsResponding(false)
    if (typeof window !== 'undefined') localStorage.removeItem(CHAT_HISTORY_LOCAL_STORAGE_KEY)
  }, [])

  return (
    <ChatContext.Provider value={{
      inputValue,
      setInputValue,
      messages,
      addMessage,
      updateMessageId,
      aiIsResponding,
      setAiIsResponding,
      aiConversationContext,
      setAiConversationContext,
      clearChat,
      isLoadingHistory
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const context = useContext(ChatContext)
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
} 