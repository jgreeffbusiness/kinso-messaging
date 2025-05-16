'use client'

import { auth } from '@/lib/firebase'
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { useAuthStore } from '@/store/useAuthStore'

export async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider()
    provider.addScope('https://www.googleapis.com/auth/contacts.readonly')
    
    // Set loading state
    useAuthStore.getState().setLoading(true)
    
    // Sign in with Firebase
    const result = await signInWithPopup(auth, provider)
    const credential = GoogleAuthProvider.credentialFromResult(result)
    const accessToken = credential?.accessToken
    
    // Get Firebase ID token
    const idToken = await result.user.getIdToken()
    
    // Call backend to validate token and create session
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    })
    
    if (!response.ok) {
      throw new Error('Login failed')
    }
    
    const { user } = await response.json()
    
    useAuthStore.getState().setUser(user)

    return user
  } catch (err) {
    console.error('Login failed:', err)
    useAuthStore.getState().setError(err instanceof Error ? err.message : 'Login failed')
    throw err
  }
}
