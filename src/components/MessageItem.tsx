'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Mail, Hash, MessageCircle, ExternalLink } from 'lucide-react'
import { cn } from '@lib/utils'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'

interface MessageItemProps {
  message: {
    id: string
    platform: string
    content: string
    timestamp: Date
    platformData?: {
      subject?: string
      direction?: 'inbound' | 'outbound'
      from?: string
      to?: string[]
      cc?: string[]
      labels?: string[]
      threadId?: string
    }
  }
  contact: {
    id: string
    name: string
    email?: string
  }
  onReply: () => void
  showContact?: boolean
}

export function MessageItem({ message, contact, onReply, showContact = true }: MessageItemProps) {
  const [expanded, setExpanded] = useState(false)
  
  // Helper to decode HTML entities like &amp;
  const decodeHtml = (html: string) => {
    const txt = document.createElement('textarea')
    txt.innerHTML = html
    return txt.value
  }
  
  // Format the timestamp - show relative time (e.g. "2 days ago")
  const relativeTime = formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })
  
  // Get platform display name and icon
  const getPlatformDisplay = (platform: string) => {
    const platformLower = platform.toLowerCase()
    if (platformLower === 'email') return 'gmail'
    return platformLower
  }
  
  // Get platform icon
  const getPlatformIcon = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'email':
        return <Mail className="h-4 w-4" />
      case 'slack':
        return <Hash className="h-4 w-4" />
      case 'whatsapp':
        return <MessageCircle className="h-4 w-4" />
      default:
        return <MessageCircle className="h-4 w-4" />
    }
  }
  
  // Get platform color
  const getPlatformColor = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'email':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100'
      case 'slack':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-100'
      case 'whatsapp':
        return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
    }
  }
  
  // Get message direction indicator
  const getDirectionIndicator = () => {
    if (message.platformData?.direction === 'outbound') {
      return <span className="text-xs italic text-muted-foreground ml-2">sent</span>
    }
    return null
  }
  
  // Decode HTML entities in subject and content
  const subject = message.platformData?.subject ? decodeHtml(message.platformData.subject) : '(No subject)'
  const content = decodeHtml(message.content)
  
  // Truncate content for preview
  const truncatedContent = content.length > 120 ? `${content.slice(0, 120)}...` : content
  
  return (
    <div className={cn(
      "border rounded-lg overflow-hidden transition-all",
      expanded ? "shadow-md" : "hover:bg-accent/50"
    )}>
      {/* Message Header - Always visible */}
      <div 
        className="p-4 flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-shrink-0 mt-1">
          {getPlatformIcon(message.platform)}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge 
                variant="outline" 
                className={cn("font-normal", getPlatformColor(message.platform))}
              >
                {getPlatformDisplay(message.platform)}
              </Badge>
              
              {showContact && (
                <span className="text-xs font-medium">
                  {contact.name}
                </span>
              )}
              
              {getDirectionIndicator()}
              
              {message.platformData?.labels && message.platformData.labels.length > 0 && (
                message.platformData.labels.slice(0, 2).map(label => (
                  <Badge key={label} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))
              )}
            </div>
            
            <span className="text-xs text-muted-foreground">
              {relativeTime}
            </span>
          </div>
          
          <h3 className="font-semibold text-sm mb-1">{subject}</h3>
          
          <p className="text-sm line-clamp-2 break-words text-muted-foreground">
            {truncatedContent}
          </p>
        </div>
      </div>
      
      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t pt-3 bg-muted/50">
          {message.platformData?.from && (
            <div className="text-xs text-muted-foreground mb-2">
              <span className="font-medium">From:</span> {message.platformData.from}
            </div>
          )}
          
          {message.platformData?.to && message.platformData.to.length > 0 && (
            <div className="text-xs text-muted-foreground mb-2">
              <span className="font-medium">To:</span> {message.platformData.to.join(', ')}
            </div>
          )}
          
          <div className="mb-4 text-sm whitespace-pre-wrap">
            {content}
          </div>
          
          {/* Action buttons */}
          <div className="flex justify-between mt-4">
            <Button 
              variant="outline" 
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onReply()
              }}
            >
              Reply
            </Button>
            
            <Button 
              variant="ghost" 
              size="sm"
              className="gap-1 text-xs"
              onClick={(e) => {
                e.stopPropagation()
                const threadId = message.platformData?.threadId || message.id
                if (message.platform.toLowerCase() === 'email') {
                  window.open(`https://mail.google.com/mail/u/0/#search/${threadId}`, '_blank')
                } else {
                  window.open('#', '_blank')
                }
              }}
            >
              View in {getPlatformDisplay(message.platform)}
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
} 