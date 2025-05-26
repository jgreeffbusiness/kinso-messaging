import { useState, useCallback } from 'react'
import { EnhancedMessage, OriginalMessage } from '@/lib/message-enhancer'

interface UseMessageEnhancerReturn {
  enhanceMessage: (message: OriginalMessage) => Promise<EnhancedMessage | null>
  isEnhancing: boolean
  error: string | null
}

export function useMessageEnhancer(): UseMessageEnhancerReturn {
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enhanceMessage = useCallback(async (message: OriginalMessage): Promise<EnhancedMessage | null> => {
    setIsEnhancing(true)
    setError(null)

    try {
      const response = await fetch('/api/messages/enhance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      })

      if (!response.ok) {
        throw new Error('Failed to enhance message')
      }

      const result = await response.json()
      return result.data
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      return null
    } finally {
      setIsEnhancing(false)
    }
  }, [])

  return {
    enhanceMessage,
    isEnhancing,
    error,
  }
} 