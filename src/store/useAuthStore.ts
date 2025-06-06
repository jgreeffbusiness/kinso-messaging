import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type User = {
  id: string
  authId: string
  email: string
  name: string
  photoUrl?: string
  isNewUser?: boolean
  hasGoogleIntegration?: boolean
  hasSlackIntegration?: boolean
  googleAccessToken?: string
  googleTokenExpiry?: Date
  googleRefreshToken?: string
  googleIntegrations?: {
    contacts: boolean
    gmail: boolean
    calendar: boolean
  }
  slackUserId?: string;
}

interface AuthState {
  user: User | null
  isLoading: boolean
  error: string | null
  isAuthenticated: boolean
  _hasHydrated: boolean
}

interface AuthActions {
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  logout: () => Promise<void>
  clearError: () => void
  setHasHydrated: (hasHydrated: boolean) => void
}

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      // State
      user: null,
      isLoading: true, // Start with loading=true to prevent premature redirects
      error: null,
      isAuthenticated: false,
      _hasHydrated: false,

      // Actions
      setUser: (user) => set({ 
        user, 
        isAuthenticated: !!user,
        error: null // Clear any previous errors when setting user
      }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      clearError: () => set({ error: null }),

      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),

      logout: async () => {
        try {
          set({ isLoading: true })
          
          // Call logout API
          const response = await fetch('/api/auth/logout', {
            method: 'POST',
          })
          
          if (!response.ok) {
            throw new Error('Logout failed')
          }
          
          // Clear user state
          set({ 
            user: null, 
            isAuthenticated: false, 
            isLoading: false,
            error: null
          })
          
          console.log('🚪 User logged out successfully')
        } catch (error) {
          console.error('Logout error:', error)
          set({ 
            error: 'Failed to logout',
            isLoading: false
          })
          // Still clear user state even if API call fails
          set({ 
            user: null, 
            isAuthenticated: false
          })
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ 
        user: state.user,
        isAuthenticated: state.isAuthenticated
      }), // Only persist user and auth status, not loading/error states
      onRehydrateStorage: () => (state) => {
        // Just mark as hydrated, don't mess with loading states
        state?.setHasHydrated(true)
      },
    }
  )
) 