'use client'

import { signOut } from 'firebase/auth'
import { auth } from '@lib/firebase'

export default function SignOutButton() {
  const handleSignOut = async () => {
    await signOut(auth)
  }

  return (
    <button onClick={handleSignOut} className="text-sm text-red-600 underline">
      Sign Out
    </button>
  )
}