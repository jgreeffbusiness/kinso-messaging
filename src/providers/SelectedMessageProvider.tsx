'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

type SelectedMessageContextType = {
  selectedMessageId: string | undefined
  setSelectedMessageId: (id: string | undefined) => void
}

const SelectedMessageContext = createContext<SelectedMessageContextType | undefined>(undefined)

export function SelectedMessageProvider({ children }: { children: ReactNode }) {
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>(undefined)

  return (
    <SelectedMessageContext.Provider value={{
      selectedMessageId,
      setSelectedMessageId
    }}>
      {children}
    </SelectedMessageContext.Provider>
  )
}

export function useSelectedMessage() {
  const context = useContext(SelectedMessageContext)
  if (context === undefined) {
    throw new Error('useSelectedMessage must be used within a SelectedMessageProvider')
  }
  return context
} 