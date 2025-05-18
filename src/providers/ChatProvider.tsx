'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

type Message = {
  id: number
  content: string
  sender: 'user' | 'assistant'
  createdAt: string
}

type ChatContextType = {
  inputValue: string
  setInputValue: (value: string) => void
  messages: Message[]
  addMessage: (message: Omit<Message, 'id'>) => void
  // No open/close methods needed
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      content: "How can I help you today?",
      sender: "assistant",
      createdAt: new Date().toISOString()
    }
  ])
  
  const addMessage = (message: Omit<Message, 'id'>) => {
    setMessages(prev => [...prev, { ...message, id: Date.now() }])
    
    // Later you can add actual AI integration here:
    // if (message.sender === 'user') {
    //   fetchAIResponse(message.content).then(response => {
    //     addMessage({
    //       content: response,
    //       sender: 'assistant',
    //       createdAt: new Date().toISOString()
    //     })
    //   })
    // }
  }

  return (
    <ChatContext.Provider value={{
      inputValue,
      setInputValue,
      messages,
      addMessage
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