'use client'

import { auth } from '@lib/firebase'
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { useAuthStore } from '@store/useAuthStore'

export async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider()
    provider.addScope('https://www.googleapis.com/auth/contacts.readonly')
    
    // Set loading state
    useAuthStore.getState().setLoading(true)
    useAuthStore.getState().clearError()
    
    // Sign in with Firebase
    const result = await signInWithPopup(auth, provider)
    
    // Get Firebase ID token
    const idToken = await result.user.getIdToken()
    
    // Call backend to validate token and create session
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Login failed')
    }
    
    if (!data.success || !data.user) {
      throw new Error('Invalid response from server')
    }
    
    // Set user in store
    useAuthStore.getState().setUser(data.user)
    
    console.log(data.message || 'Login successful')
    
    return data.user
  } catch (err) {
    console.error('Login failed:', err)
    const errorMessage = err instanceof Error ? err.message : 'Login failed'
    useAuthStore.getState().setError(errorMessage)
    throw err
  } finally {
    useAuthStore.getState().setLoading(false)
  }
}
