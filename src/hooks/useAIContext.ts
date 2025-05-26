import { useState, useEffect, useRef } from 'react'
import { AIContext, ThreadData } from '@/lib/ai-context'

interface Message {
  id: string
  content: string
  timestamp: string | Date
  platformData?: Record<string, unknown>
  contact?: {
    id: string
    fullName: string
    email: string | null
  }
}

interface UseAIContextProps {
  selectedMessageId?: string
  messages: Message[]
}

// Cache for AI contexts to avoid re-analyzing the same threads
const contextCache = new Map<string, AIContext>()

export function useAIContext({ selectedMessageId, messages }: UseAIContextProps) {
  const [context, setContext] = useState<AIContext | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    // Clear any pending requests
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    if (!selectedMessageId || !messages.length) {
      setContext(null)
      return
    }

    // Debounce the analysis to avoid rapid-fire requests
    timeoutRef.current = setTimeout(() => {
      generateContext().catch(console.error)
    }, 300) // 300ms debounce

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [selectedMessageId, messages])

  const generateContext = async () => {
    if (!selectedMessageId || !messages.length) return

    try {
      // Find the selected message
      const selectedMessage = messages.find(msg => msg.id === selectedMessageId)
      if (!selectedMessage) {
        throw new Error('Selected message not found')
      }

      // Get thread ID from the selected message
      const threadId = String(selectedMessage.platformData?.threadId || selectedMessage.id)
      
      // Check cache first
      const cached = contextCache.get(threadId)
      if (cached) {
        setContext(cached)
        setLoading(false)
        setError(null)
        return
      }

      setLoading(true)
      setError(null)
      
      // Find all messages in the same thread
      const threadMessages = messages.filter(msg => 
        String(msg.platformData?.threadId || msg.id) === threadId
      )

      // Prepare thread data for AI analysis
      const threadData: ThreadData = {
        id: threadId,
        subject: String(selectedMessage.platformData?.subject || 'No Subject'),
        messages: threadMessages.map(msg => ({
          id: msg.id,
          content: msg.content,
          timestamp: new Date(msg.timestamp),
          from: String(msg.platformData?.from || 'Unknown'),
          platformData: msg.platformData,
          contact: msg.contact
        }))
      }

      // Call API endpoint for AI context generation
      const response = await fetch('/api/ai/context', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(threadData)
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const aiContext = await response.json()
      
      // Cache the result
      contextCache.set(threadId, aiContext)
      
      setContext(aiContext)
    } catch (err) {
      console.error('Failed to generate AI context:', err)
      setError(err instanceof Error ? err.message : 'Failed to analyze thread')
    } finally {
      setLoading(false)
    }
  }

  return {
    context,
    loading,
    error,
    refetch: () => {
      if (selectedMessageId) {
        const selectedMessage = messages.find(msg => msg.id === selectedMessageId)
        if (selectedMessage) {
          const threadId = String(selectedMessage.platformData?.threadId || selectedMessage.id)
          // Clear cache for this thread and regenerate
          contextCache.delete(threadId)
          generateContext().catch(console.error)
        }
      }
    }
  }
} 