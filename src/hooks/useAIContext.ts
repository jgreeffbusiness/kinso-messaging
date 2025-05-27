import { useState, useEffect, useRef, useCallback } from 'react'
import { ThreadAnalysis, ThreadData } from '@/lib/thread-processor'
import { ActiveFocusItemType } from '@/providers/ActiveFocusProvider'
import { EnhancedMessage, Message as ThreadMessageItem, PlatformData as MessagePlatformData } from '@hooks/useThreadedMessages'
import { useAuth } from '@/components/AuthProvider'

interface UseAIContextProps {
  activeItem: ActiveFocusItemType
  allMessages: ThreadMessageItem[]
}

// Cache for AI contexts to avoid re-analyzing the same threads
const contextCache = new Map<string, ThreadAnalysis>()

export function useAIContext({ activeItem, allMessages }: UseAIContextProps) {
  const { user } = useAuth()
  const userEmail = user?.email

  const [context, setContext] = useState<ThreadAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchingForItemRef = useRef<ActiveFocusItemType | null>(null)
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const generateContext = useCallback(async (currentItem: ActiveFocusItemType) => {
    if (!currentItem || !userEmail) {
      if (!userEmail) console.warn('useAIContext: User email not available for context generation.')
      if (fetchingForItemRef.current === currentItem || !activeItem) {
        setContext(null)
        setLoading(false)
        setError(null)
      }
      return
    }

    fetchingForItemRef.current = currentItem

    let messageToProcess: EnhancedMessage | ThreadMessageItem | undefined
    let threadIdToUse: string | undefined

    if (currentItem.type === 'message' || currentItem.type === 'dashboard_item') {
      messageToProcess = currentItem.data
      threadIdToUse = String((currentItem.data.platformData as MessagePlatformData)?.threadId || currentItem.data.id)
    } else if (currentItem.type === 'message_id_only') {
      messageToProcess = allMessages.find(msg => msg.id === currentItem.id)
      if (messageToProcess) {
        threadIdToUse = String((messageToProcess.platformData as MessagePlatformData)?.threadId || messageToProcess.id)
      }
    }

    if (!messageToProcess || !threadIdToUse) {
      if (fetchingForItemRef.current === currentItem) {
        setError('Could not identify message to process for AI context.')
        setContext(null)
        setLoading(false)
      }
      return
    }
    
    const finalThreadId = threadIdToUse
    const cached = contextCache.get(finalThreadId)
    if (cached) {
      if (fetchingForItemRef.current === currentItem) {
        setContext(cached)
        setLoading(false)
        setError(null)
      }
      return
    }

    if (fetchingForItemRef.current === currentItem) {
      setLoading(true)
      setError(null)
    } else {
      return
    }
    
    const threadMessages = allMessages.filter(msg => 
      String((msg.platformData as MessagePlatformData)?.threadId || msg.id) === finalThreadId
    )

    if (threadMessages.length === 0) {
      if (fetchingForItemRef.current === currentItem) {
        setError('No messages found for this thread to analyze.')
        setContext(null)
        setLoading(false)
      }
      return
    }
    
    const representativeMessageForAnalysis = messageToProcess as EnhancedMessage
    const representativePlatformData = representativeMessageForAnalysis.platformData as MessagePlatformData | undefined

    if (representativePlatformData?.analysis) {
      if (fetchingForItemRef.current === currentItem) {
        console.log('Using pre-existing analysis from activeItem for thread:', finalThreadId)
        setContext(representativePlatformData.analysis)
        contextCache.set(finalThreadId, representativePlatformData.analysis)
        setLoading(false)
      }
      return
    }

    const apiMessages: ThreadData['messages'] = threadMessages.map(msg => {
      const pData = msg.platformData as MessagePlatformData | undefined
      const fromAddress = String(pData?.from || msg.contact?.fullName || 'Unknown').toLowerCase()
      const localUserEmail = userEmail?.toLowerCase() || '@#$NOMATCH$#@'
      
      return {
        id: msg.id,
        from: String(pData?.from || msg.contact?.fullName || 'Unknown'), 
        to: pData?.to || [], 
        subject: String(pData?.subject || representativePlatformData?.subject || 'No Subject'),
        content: msg.content,
        timestamp: new Date(msg.timestamp),
        direction: fromAddress.includes(localUserEmail) ? 'outbound' : 'inbound', 
        isFromUser: fromAddress.includes(localUserEmail),
      }
    })

    const threadDataForAPI: ThreadData = {
      id: finalThreadId,
      subject: String(representativePlatformData?.subject || 'No Subject'),
      messages: apiMessages
    }

    try {
      console.log('No pre-existing analysis, calling /api/ai/context for thread:', finalThreadId)
      const contactNameForAPI = representativeMessageForAnalysis.contact?.fullName || 'Unknown Contact'
      
      const response = await fetch('/api/ai/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadData: threadDataForAPI, userEmail, contactName: contactNameForAPI })
      })

      if (fetchingForItemRef.current !== currentItem) return

      if (!response.ok) {
        const errorData = await response.text()
        throw new Error(`API error on /api/ai/context: ${response.status} - ${errorData}`)
      }

      const aiGeneratedContext = await response.json() as ThreadAnalysis
      contextCache.set(finalThreadId, aiGeneratedContext)
      if (fetchingForItemRef.current === currentItem) setContext(aiGeneratedContext)
    } catch (err) {
      console.error('Failed to generate AI context via API:', err)
      if (fetchingForItemRef.current === currentItem) setError(err instanceof Error ? err.message : 'Failed to analyze thread via API')
    } finally {
      if (fetchingForItemRef.current === currentItem) setLoading(false)
    }
  }, [allMessages, userEmail])

  useEffect(() => {
    console.log('[useAIContext] useEffect triggered. Active item:', activeItem ? activeItem.type + ":" + (activeItem.type !== 'message_id_only' ? activeItem.data.id : activeItem.id) : null)
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }
    if (!activeItem) {
      setContext(null)
      setLoading(false)
      setError(null)
      fetchingForItemRef.current = null
      return
    }

    if (fetchingForItemRef.current && 
        ((fetchingForItemRef.current.type !== 'message_id_only' && activeItem.type !== 'message_id_only' && fetchingForItemRef.current.data.id === activeItem.data.id) || 
         (fetchingForItemRef.current.type === 'message_id_only' && activeItem.type === 'message_id_only' && fetchingForItemRef.current.id === activeItem.id)) && 
        context) {
        return
    }

    debounceTimeoutRef.current = setTimeout(() => {
      generateContext(activeItem)
    }, 300)

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [activeItem, generateContext])

  return {
    context,
    loading,
    error,
    refetch: () => {
      if (activeItem) {
        let threadIdToClearCache: string | undefined
        if (activeItem.type === 'message' || activeItem.type === 'dashboard_item') {
          threadIdToClearCache = String((activeItem.data.platformData as MessagePlatformData)?.threadId || activeItem.data.id)
        } else if (activeItem.type === 'message_id_only') {
          const msg = allMessages.find(m => m.id === activeItem.id)
          threadIdToClearCache = String((msg?.platformData as MessagePlatformData)?.threadId || msg?.id)
        }
        if (threadIdToClearCache) {
          contextCache.delete(threadIdToClearCache)
          generateContext(activeItem).catch(console.error)
        }
      }
    }
  }
} 