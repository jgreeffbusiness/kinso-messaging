'use client'

import { useRef, useState } from 'react'
import { Mic, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useChat } from '@providers/ChatProvider'
import { cn } from '@lib/utils'

// Basic structure mirrored from RightPanel's types
interface AiAssistantContext {
  current_intent?: string
  [key: string]: unknown
}

interface RetrievedSourceItem {
  id: string
  source_type: string
  platform?: string
  subject?: string
  timestamp?: string
  preview: string
}

interface AiAssistantApiResponse {
  message: string
  details?: AiAssistantContext | Record<string, unknown>
  followUpQuestion?: string
  actionToFulfill?: { type: string; data: Record<string, unknown> }
  retrieved_sources?: RetrievedSourceItem[]
  error?: string
}

export function VoiceOrb({ className }: { className?: string }) {
  const {
    messages,
    addMessage,
    updateMessageId,
    aiConversationContext,
    setAiConversationContext,
    aiIsResponding,
    setAiIsResponding,
  } = useChat()

  const recognitionRef = useRef<any>(null)
  const [listening, setListening] = useState(false)

  const persistMessage = async (
    role: 'user' | 'assistant',
    content: string,
    tempIdToUpdate?: string
  ) => {
    try {
      const response = await fetch('/api/ai/chat-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content }),
      })
      if (response.ok) {
        const savedMsgData = await response.json()
        if (savedMsgData.success && savedMsgData.message && tempIdToUpdate) {
          updateMessageId(tempIdToUpdate, savedMsgData.message.id)
        }
      }
    } catch (error) {
      console.error('Network error saving message:', error)
    }
  }

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const userTempId = addMessage({ content: trimmed, role: 'user' })
    const history = [
      ...messages,
      {
        id: userTempId,
        content: trimmed,
        role: 'user' as const,
        createdAt: new Date().toISOString(),
      },
    ].map((m) => ({ role: m.role, content: m.content }))
    persistMessage('user', trimmed, userTempId)

    const contextToSend = aiConversationContext
    setAiConversationContext(null)
    setAiIsResponding(true)

    let apiResponseData: AiAssistantApiResponse | null = null
    try {
      const response = await fetch('/api/ai/assistant-handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: trimmed,
          conversationHistory: history,
          currentIntentContext: contextToSend,
        }),
      })
      apiResponseData = (await response.json()) as AiAssistantApiResponse
      if (!response.ok || apiResponseData.error) {
        throw new Error(apiResponseData.error || 'AI assistant request failed')
      }
    } catch (err) {
      console.error('AI assistant error:', err)
      const msg = err instanceof Error ? err.message : 'Error communicating with AI'
      apiResponseData = { message: msg, error: msg }
    }

    if (apiResponseData) {
      addMessage({
        content: apiResponseData.message,
        role: 'assistant',
        retrieved_sources: apiResponseData.retrieved_sources,
      })
      persistMessage('assistant', apiResponseData.message)

      if (apiResponseData.followUpQuestion && apiResponseData.details) {
        setAiConversationContext(apiResponseData.details as AiAssistantContext)
      }

      try {
        const speechRes = await fetch('/api/ai/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: apiResponseData.message }),
        })
        if (speechRes.ok) {
          const blob = await speechRes.blob()
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audio.play()
        } else {
          // Fallback to browser speech synthesis
          speechSynthesis.speak(new SpeechSynthesisUtterance(apiResponseData.message))
        }
      } catch (e) {
        speechSynthesis.speak(new SpeechSynthesisUtterance(apiResponseData.message))
      }
    }

    setAiIsResponding(false)
  }

  const startListening = () => {
    if (aiIsResponding) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('Speech recognition not supported in this browser')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join(' ')
      sendMessage(transcript)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  return (
    <button
      type="button"
      onClick={startListening}
      disabled={aiIsResponding}
      className={cn(
        'fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg',
        listening && 'bg-muted',
        className
      )}
    >
      {listening ? <Loader2 className="h-6 w-6 animate-spin" /> : <Mic className="h-6 w-6" />}
    </button>
  )
}

export default VoiceOrb
