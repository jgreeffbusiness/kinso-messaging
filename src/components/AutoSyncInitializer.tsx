'use client'

import { useEffect } from 'react'

export function AutoSyncInitializer() {
  useEffect(() => {
    // Initialize auto-sync for all users on app startup
    const initializeAutoSync = async () => {
      try {
        const response = await fetch('/api/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        
        if (response.ok) {
          const data = await response.json()
          console.log('Auto-sync initialized:', data.message)
        } else {
          console.warn('Auto-sync initialization failed:', response.statusText)
        }
      } catch (error) {
        console.error('Failed to initialize auto-sync:', error)
      }
    }

    // Run initialization after a short delay to let the app load
    const timer = setTimeout(() => {
      initializeAutoSync()
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  // This component doesn't render anything - it just runs initialization
  return null
} 