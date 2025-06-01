'use client'

import { useAuth } from '@hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Spinner } from '@components/ui/Spinner'
import { RightPanelProvider } from '@providers/RightPanelProvider'
import { Toaster } from '@components/ui/sonner'
import VoiceOrb from '@components/VoiceOrb'

interface ProtectedLayoutProps {
  children: React.ReactNode
}

export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) return null

  return (
    <RightPanelProvider>
      {children}
      <VoiceOrb />
      <Toaster position="top-right" />
    </RightPanelProvider>
  )
}