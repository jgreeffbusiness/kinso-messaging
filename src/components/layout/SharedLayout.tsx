'use client'

import { ReactNode } from 'react'
import { Sidebar } from '../Sidebar'
import { Header } from './Header'
import { RightPanel } from './RightPanel'

export default function SharedLayout({ 
  children 
}: { 
  children: ReactNode
}) {
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
          
          {/* AI Assistant panel */}
          <RightPanel />
        </div>
      </div>
    </div>
  )
}