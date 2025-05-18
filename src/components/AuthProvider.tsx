'use client'

import { createContext, useContext, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@lib/firebase'
import { useAuthStore, User } from '@store/useAuthStore'

export const AuthContext = createContext<{
  user: User | null
  loading: boolean
}>({ user: null, loading: true })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading, setLoading } = useAuthStore()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true)
      
      if (firebaseUser) {
        try {
          // Fetch user data from our API
          const response = await fetch('/api/user/me')
          
          if (response.ok) {
            const { user: dbUser } = await response.json()

            useAuthStore.getState().setUser(dbUser)
          } else {
            // Handle error or user not in DB
            useAuthStore.getState().logout()
          }
        } catch (error) {
          console.error('Failed to fetch user:', error)
          useAuthStore.getState().setError('Failed to load user data')
        }
      } else {
        // Not logged in
        useAuthStore.getState().logout()
      }
      
      setLoading(false)
    })
    
    return () => unsubscribe()
  }, [setLoading])
  
  return (
    <AuthContext.Provider value={{ user, loading: isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}