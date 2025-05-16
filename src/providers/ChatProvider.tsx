'use client'

import { createContext, useContext, useState, ReactNode, useEffect } from 'react'

type ChatContextType = {
  isGlobalChatVisible: boolean
  showGlobalChat: () => void
  hideGlobalChat: () => void
  toggleGlobalChat: () => void
  inputValue: string
  setInputValue: (value: string) => void
  messages: any[] // Type this properly based on your needs
  addMessage: (message: any) => void
  isRightPanelVisible: boolean
  setIsRightPanelVisible: (value: boolean) => void
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isGlobalChatVisible, setIsGlobalChatVisible] = useState(false)
  const [isRightPanelVisible, setIsRightPanelVisible] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<any[]>([
    {
      id: 1,
      content: "How can I help you with your contacts today?",
      sender: "assistant",
      createdAt: new Date().toISOString()
    }
  ])

  // If RightPanel becomes visible, hide the global chat
  useEffect(() => {
    if (isRightPanelVisible) {
      setIsGlobalChatVisible(false)
    }
  }, [isRightPanelVisible])

  const showGlobalChat = () => {
    setIsGlobalChatVisible(true)
  }
  
  const hideGlobalChat = () => {
    setIsGlobalChatVisible(false)
  }
  
  const toggleGlobalChat = () => {
    setIsGlobalChatVisible(prev => !prev)
  }
  
  const addMessage = (message: any) => {
    setMessages(prev => [...prev, { ...message, id: Date.now() }])
  }

  return (
    <ChatContext.Provider value={{
      isGlobalChatVisible,
      showGlobalChat,
      hideGlobalChat,
      toggleGlobalChat,
      inputValue,
      setInputValue,
      messages,
      addMessage,
      isRightPanelVisible,
      setIsRightPanelVisible
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