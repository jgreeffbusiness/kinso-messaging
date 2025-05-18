'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
// No RightPanel import here - completely removed

type PanelContent = {
  type: string
  props: Record<string, any>
  title?: string
  size?: "sm" | "default" | "lg" | "xl"
  noPadding?: boolean
  noScroll?: boolean
}

interface RightPanelContextType {
  open: (content: PanelContent) => void
  close: () => void
  isOpen: boolean
  content: PanelContent | null
  setContent: (content: PanelContent | null) => void
}

const RightPanelContext = createContext<RightPanelContextType | undefined>(undefined)

export function useRightPanel() {
  const context = useContext(RightPanelContext)
  if (!context) {
    throw new Error('useRightPanel must be used within a RightPanelProvider')
  }
  return context
}

interface RightPanelProviderProps {
  children: ReactNode
}

export function RightPanelProvider({ 
  children 
}: RightPanelProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState<PanelContent | null>(null)

  const open = (newContent: PanelContent) => {
    setContent(newContent)
    setIsOpen(true)
  }

  const close = () => {
    setIsOpen(false)
  }

  return (
    <RightPanelContext.Provider value={{ 
      open, 
      close, 
      isOpen, 
      content,
      setContent
    }}>
      {children}
    </RightPanelContext.Provider>
  )
} 