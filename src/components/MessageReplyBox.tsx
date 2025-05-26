'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Send, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

interface MessageReplyBoxProps {
  messageId: string
  platform: 'slack' | 'gmail'
  contactName: string
  originalContent: string
  isOpen: boolean
  onClose: () => void
  onSent?: () => void
}

export function MessageReplyBox({ 
  messageId, 
  platform, 
  contactName, 
  originalContent,
  isOpen,
  onClose,
  onSent 
}: MessageReplyBoxProps) {
  const [replyText, setReplyText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendStatus, setSendStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  if (!isOpen) return null

  const handleSend = async () => {
    if (!replyText.trim()) return

    setIsSending(true)
    setSendStatus('idle')
    setErrorMessage('')

    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform,
          type: 'reply',
          originalMessageId: messageId,
          content: replyText.trim()
        })
      })

      const result = await response.json()

      if (result.success) {
        setSendStatus('success')
        setReplyText('')
        
        // Close the reply box after a brief success display
        setTimeout(() => {
          onClose()
          onSent?.()
        }, 1500)
      } else {
        setSendStatus('error')
        setErrorMessage(result.error || 'Failed to send reply')
      }
    } catch (error) {
      setSendStatus('error')
      setErrorMessage('Network error - please try again')
      console.error('Reply send error:', error)
    } finally {
      setIsSending(false)
    }
  }

  const getPlatformIcon = () => {
    switch (platform) {
      case 'slack':
        return '💬'
      case 'gmail':
        return '📧'
      default:
        return '💌'
    }
  }

  const getPlatformName = () => {
    switch (platform) {
      case 'slack':
        return 'Slack'
      case 'gmail':
        return 'Gmail'
      default:
        return platform
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">{getPlatformIcon()}</span>
              Reply via {getPlatformName()}
              <Badge variant="outline">{contactName}</Badge>
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isSending}
            >
              ✕
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Original Message Context */}
          <div className="p-3 bg-muted rounded-lg border-l-4 border-l-blue-500">
            <p className="text-sm text-muted-foreground mb-1">Replying to:</p>
            <p className="text-sm line-clamp-3">{originalContent}</p>
          </div>

          {/* Reply Text Area */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Your Reply:</label>
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`Write your reply... (will be sent via ${getPlatformName()})`}
              rows={6}
              disabled={isSending}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This reply will be sent through {getPlatformName()} and appear in the original conversation thread.
            </p>
          </div>

          {/* Status Messages */}
          {sendStatus === 'success' && (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Reply sent successfully via {getPlatformName()}! 🎉
              </AlertDescription>
            </Alert>
          )}

          {sendStatus === 'error' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSending}
          >
            Cancel
          </Button>
          
          <Button
            onClick={handleSend}
            disabled={!replyText.trim() || isSending}
            className="min-w-[120px]"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send via {getPlatformName()}
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
} 