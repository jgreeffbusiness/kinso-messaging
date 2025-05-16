'use client'

import { ReactNode, useState } from 'react'
import { Sidebar } from '../Sidebar'
import { Header } from './Header'
import { RightPanel } from './RightPanel'
import { useRightPanel } from '@/providers/RightPanelProvider'
import { GlobalChat } from '@/components/GlobalChat'

export default function SharedLayout({ 
  children,
  showContactPanel = false,
  contactData = null
}: { 
  children: ReactNode,
  showContactPanel?: boolean,
  contactData?: any
}) {

  const { content } = useRightPanel()
  
  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Left nav bar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-col flex-1 h-full overflow-hidden">
        <Header />
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6 bg-background">
            {children}
          </main>
          
          {/* Always-visible right panel */}
          <RightPanel
            showContactInfo={showContactPanel || !!content?.props?.contact}
            contactData={contactData || content?.props}
          />

          <GlobalChat />
        </div>
      </div>
    </div>
  )
}