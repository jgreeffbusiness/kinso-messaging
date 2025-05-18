'use client'

import { useRouter } from 'next/navigation'
import { loginWithGoogle } from '@hooks/useFirebaseLogin'

export default function GoogleLoginButton() {
  const router = useRouter()

  const handleSignIn = async () => {
    try {
      await loginWithGoogle()
      router.push('/stream') 
    } catch (error) {
      console.error('Google login failed:', error)
    }
  }

  return (
    <button
      onClick={handleSignIn}
      className="bg-white border rounded px-4 py-2 shadow flex items-center gap-2 hover:bg-gray-50"
    >
      <span className="text-sm font-medium">Sign in with Google</span>
    </button>
  )
}
