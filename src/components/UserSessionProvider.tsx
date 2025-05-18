'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@store/useAuthStore'
import { auth } from '@lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'

export function UserSessionProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading, setError, logout } = useAuthStore()
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (!firebaseUser) {
          logout()
          return
        }
        
        // Fetch current user from API
        const response = await fetch('/api/user/me')
        
        if (!response.ok) {
          // Handle unauthenticated on the server or other error
          if (response.status === 401) {
            logout()
            return
          }
          throw new Error('Failed to fetch user session')
        }
        
        const { user } = await response.json()
        setUser(user)
      } catch (err) {
        console.error('Session error:', err)
        setError(err instanceof Error ? err.message : 'Session error')
      } finally {
        setLoading(false)
      }
    })
    
    return () => unsubscribe()
  }, [setUser, setLoading, setError, logout])
  
  return <>{children}</>
} 