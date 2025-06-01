'use client'

import { useState, useRef } from 'react'
import { Button } from './ui/button'
import { Mic, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export interface MicrophoneButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
}

export function MicrophoneButton({ onTranscript, disabled }: MicrophoneButtonProps) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  const handleClick = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('Speech recognition not supported in this browser')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join(' ')
      onTranscript(transcript)
    }
    recognition.onerror = () => {
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  return (
    <Button type="button" variant="ghost" size="icon" onClick={handleClick} disabled={disabled}>
      {listening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
    </Button>
  )
}

export default MicrophoneButton
