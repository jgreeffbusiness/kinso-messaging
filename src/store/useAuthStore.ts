import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type User = {
  id: string
  authId: string
  email: string
  name: string
  photoUrl?: string
  googleAccessToken?: string
  googleTokenExpiry?: Date
  googleRefreshToken?: string
  googleIntegrations?: {
    contacts: boolean
    gmail: boolean
    calendar: boolean
  }
}

type AuthState = {
  user: User | null
  isLoading: boolean
  error: string | null
  
  // Actions
  setUser: (user: User | null) => void
  setLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: true,
      error: null,
      
      setUser: (user) => set({ user, isLoading: false }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error, isLoading: false }),
      logout: () => set({ user: null, error: null })
    }),
    {
      name: 'auth-store',
      // Only persist non-sensitive data
      partialize: (state) => ({ 
        user: state.user ? {
          id: state.user.id,
          name: state.user.name,
          email: state.user.email,
          photoUrl: state.user.photoUrl
        } : null 
      })
    }
  )
) 