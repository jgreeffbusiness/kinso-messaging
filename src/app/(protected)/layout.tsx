'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { RightPanelProvider } from '@/providers/RightPanelProvider'
import { ContactPanel } from '@/components/panels/ContactPanel'
import { Toaster } from '@/components/ui/sonner'

interface ProtectedLayoutProps {
  children: React.ReactNode
}

// Register all panel components here
const panelComponents = {
  'contact': ContactPanel,
  // Add more panel components as needed
}

export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const { user, loading, error } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-red-500">
          Authentication error. Please try again later.
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <RightPanelProvider components={panelComponents}>
      {children}
      <Toaster position="top-right" />
    </RightPanelProvider>
  )
}