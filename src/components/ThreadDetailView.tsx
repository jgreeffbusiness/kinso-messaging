'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { 
  X, 
  Mail, 
  MessageSquare, 
  Phone, 
  CheckCircle, 
  Clock,
  Send,
  Paperclip,
  MoreHorizontal,
  ChevronDown,
  ExternalLink,
  Sparkles
} from 'lucide-react'
import { cn } from '@lib/utils'

interface ThreadMessage {
  id: string
  platform: 'gmail' | 'slack' | 'whatsapp'
  content: string
  timestamp: Date
  sender: {
    name: string
    email?: string
    avatar?: string
  }
  direction: 'inbound' | 'outbound'
  platformData?: {
    subject?: string
    from?: string
    to?: string[]
    cc?: string[]
    threadId?: string
  }
}

interface ThreadDetailProps {
  thread: {
    id: string
    subject: string
    sender: string
    platform: 'gmail' | 'slack' | 'whatsapp'
    timestamp: Date
    aiSummary?: string
    actionItems?: string[]
    keyInsights?: string[]
    confidence?: number
  }
  messages: ThreadMessage[]
  onClose: () => void
  onReply: (content: string, platform: string) => void
}

export default function ThreadDetailView({ thread, messages, onClose, onReply }: ThreadDetailProps) {
  const [replyContent, setReplyContent] = useState('')
  const [selectedReplyPlatform, setSelectedReplyPlatform] = useState(thread.platform)
  const [showOriginalContent, setShowOriginalContent] = useState(false)
  const [aiDraftMode, setAiDraftMode] = useState(false)

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'gmail': return <Mail className="h-4 w-4" />
      case 'slack': return <MessageSquare className="h-4 w-4" />
      case 'whatsapp': return <Phone className="h-4 w-4" />
      default: return <Mail className="h-4 w-4" />
    }
  }

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'gmail': return 'bg-red-100 text-red-700 border-red-200'
      case 'slack': return 'bg-purple-100 text-purple-700 border-purple-200'
      case 'whatsapp': return 'bg-green-100 text-green-700 border-green-200'
      default: return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const handleSendReply = () => {
    if (replyContent.trim()) {
      onReply(replyContent, selectedReplyPlatform)
      setReplyContent('')
    }
  }

  const generateAIDraft = () => {
    setAiDraftMode(true)
    // Simulate AI draft generation
    setTimeout(() => {
      setReplyContent("Thanks for organizing this meeting. I'll review the requirements beforehand and come prepared with questions. Looking forward to the discussion!")
      setAiDraftMode(false)
    }, 1500)
  }

  // Sort messages chronologically
  const sortedMessages = [...messages].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-6 border-b">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              <div className={cn("p-2 rounded-full", getPlatformColor(thread.platform))}>
                {getPlatformIcon(thread.platform)}
              </div>
              <div className="flex-1">
                <h1 className="text-xl font-semibold mb-1">{thread.subject}</h1>
                <p className="text-sm text-gray-600">
                  From: {thread.sender} • {formatDistanceToNow(thread.timestamp, { addSuffix: true })}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className={cn("text-xs", getPlatformColor(thread.platform))}>
                    {thread.platform}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {messages.length} messages
                  </Badge>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* AI Summary Section */}
        {thread.aiSummary && (
          <div className="flex-shrink-0 p-6 bg-blue-50 border-b">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-full">
                <Sparkles className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-medium text-sm text-blue-900">AI Summary</h3>
                  {thread.confidence && (
                    <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700">
                      {thread.confidence}% confidence
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-blue-800">{thread.aiSummary}</p>
                
                {/* Key Insights */}
                {thread.keyInsights && thread.keyInsights.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-medium text-blue-700 mb-2">Key Insights:</h4>
                    <ul className="text-xs text-blue-600 space-y-1">
                      {thread.keyInsights.map((insight, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <CheckCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span>{insight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Action Items */}
                {thread.actionItems && thread.actionItems.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-medium text-orange-700 mb-2">Suggested Actions:</h4>
                    <div className="space-y-2">
                      {thread.actionItems.map((action, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input type="checkbox" className="rounded text-orange-600" />
                          <span className="text-xs text-orange-600">{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {sortedMessages.map((message, index) => (
              <div key={message.id} className="flex gap-3">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {message.sender.avatar ? (
                    <img 
                      src={message.sender.avatar} 
                      alt={message.sender.name}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                      <span className="text-xs font-medium text-gray-600">
                        {message.sender.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Message Content */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{message.sender.name}</span>
                    <div className={cn("px-1.5 py-0.5 rounded text-xs", getPlatformColor(message.platform))}>
                      {getPlatformIcon(message.platform)}
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatDistanceToNow(message.timestamp, { addSuffix: true })}
                    </span>
                    {message.direction === 'outbound' && (
                      <Badge variant="outline" className="text-xs">sent</Badge>
                    )}
                  </div>
                  
                  {/* Message bubble */}
                  <div className={cn(
                    "p-3 rounded-lg max-w-2xl",
                    message.direction === 'outbound' 
                      ? "bg-blue-500 text-white ml-4" 
                      : "bg-gray-100"
                  )}>
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>

                  {/* Message metadata */}
                  {message.platformData?.subject && index === 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Subject: {message.platformData.subject}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* View Original Content Toggle */}
          <div className="mt-6 pt-4 border-t">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowOriginalContent(!showOriginalContent)}
              className="flex items-center gap-2"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", showOriginalContent && "rotate-180")} />
              View Original Content
            </Button>
            
            {showOriginalContent && (
              <Card className="mt-3 p-4 bg-gray-50">
                <h4 className="font-medium text-sm mb-2">Raw Email Content</h4>
                <div className="text-xs text-gray-600 space-y-2">
                  <div><strong>From:</strong> {messages[0]?.platformData?.from}</div>
                  <div><strong>To:</strong> {messages[0]?.platformData?.to?.join(', ')}</div>
                  {messages[0]?.platformData?.cc && messages[0]?.platformData?.cc.length > 0 && (
                    <div><strong>CC:</strong> {messages[0]?.platformData?.cc.join(', ')}</div>
                  )}
                  <div className="pt-2 border-t">
                    <pre className="whitespace-pre-wrap text-xs">{messages[0]?.content}</pre>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Reply Composition Area */}
        <div className="flex-shrink-0 p-6 border-t bg-gray-50">
          <div className="space-y-3">
            {/* Platform Selection & Actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Reply via:</span>
                <div className="flex gap-1">
                  {['gmail', 'slack', 'whatsapp'].map(platform => (
                    <Button
                      key={platform}
                      variant={selectedReplyPlatform === platform ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedReplyPlatform(platform as 'gmail' | 'slack' | 'whatsapp')}
                      className="flex items-center gap-1"
                    >
                      {getPlatformIcon(platform)}
                      <span className="capitalize">{platform}</span>
                    </Button>
                  ))}
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={generateAIDraft}
                  disabled={aiDraftMode}
                  className="flex items-center gap-1"
                >
                  {aiDraftMode ? (
                    <Clock className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  AI Draft
                </Button>
                <Button variant="outline" size="sm">
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Composition Area */}
            <div className="relative">
              <Textarea
                placeholder={`Type your reply... (via ${selectedReplyPlatform})`}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                className="min-h-[100px] pr-12"
              />
              <Button
                size="sm"
                onClick={handleSendReply}
                disabled={!replyContent.trim()}
                className="absolute bottom-3 right-3"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2 text-sm">
              <Button variant="ghost" size="sm">Schedule Send</Button>
              <Button variant="ghost" size="sm">Save Draft</Button>
              <Button variant="ghost" size="sm" className="flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                Open in {selectedReplyPlatform}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 