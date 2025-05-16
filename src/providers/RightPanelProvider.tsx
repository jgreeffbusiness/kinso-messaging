'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import { RightPanel } from '@/components/layout/RightPanel'

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
  components: Record<string, React.ComponentType<any>>
}

export function RightPanelProvider({ 
  children, 
  components 
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

  // Find the component to render based on content type
  const ContentComponent = content?.type ? components[content.type] : null

  return (
    <RightPanelContext.Provider value={{ open, close, isOpen, content }}>
      {children}
      {ContentComponent && (
        <RightPanel
          isOpen={isOpen}
          onClose={close}
          title={content?.title}
          size={content?.size}
          noPadding={content?.noPadding}
          noScroll={content?.noScroll}
        >
          <ContentComponent {...(content?.props || {})} />
        </RightPanel>
      )}
    </RightPanelContext.Provider>
  )
} 