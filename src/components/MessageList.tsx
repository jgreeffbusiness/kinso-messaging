'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { 
  Mail, 
  Hash,
  MessageCircle, 
  ChevronRight,
  ExternalLink
} from 'lucide-react'
import { cn } from '@lib/utils'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'

type MessageListProps = {
  messages: any[]
  showContact?: boolean
  onMessageClick: (messageId: string) => void
}

export default function MessageList({ messages, onMessageClick, showContact }: MessageListProps) {
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)
  
  // Get platform icon based on platform name
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
  
  // Get platform color based on platform name
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
  
  const toggleExpanded = (messageId: string) => {
    setExpandedMessageId(prevId => prevId === messageId ? null : messageId)
  }

  return (
    <div className="space-y-4">
      {messages.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          No messages yet
        </div>
      ) : (
        messages.map(message => (
          <div 
            key={message.id} 
            className={cn(
              "border rounded-lg overflow-hidden transition-all",
              expandedMessageId === message.id ? "shadow-md" : "hover:bg-accent/50 cursor-pointer"
            )}
          >
            {/* Message Header - Always visible */}
            <div 
              className="p-4 flex items-start gap-3"
              onClick={() => toggleExpanded(message.id)}
            >
              <div className="flex-shrink-0 mt-1">
                {getPlatformIcon(message.platform)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <Badge 
                    variant="outline" 
                    className={cn("font-normal", getPlatformColor(message.platform))}
                  >
                    {message.platform}
                  </Badge>
                  {showContact && message.contact && (
                    <div className="text-xs font-medium mt-1">
                      {message.contact.fullName}
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
                  </span>
                </div>
                
                <p className="text-sm line-clamp-2 break-words">
                  {message.content}
                </p>
                
                {message.summary && !expandedMessageId && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {message.summary.summaryText}
                  </p>
                )}
              </div>
              
              <ChevronRight className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                expandedMessageId === message.id && "rotate-90"
              )} />
            </div>
            
            {/* Expanded Content */}
            {expandedMessageId === message.id && (
              <div className="px-4 pb-4 border-t pt-3 bg-muted/50">
                {/* Full message content */}
                <div className="mb-4 text-sm whitespace-pre-wrap">
                  {message.content}
                </div>
                
                {/* Summary if available */}
                {message.summary && (
                  <div className="mb-4 p-3 bg-background rounded-md border">
                    <p className="text-xs font-medium mb-1">AI Summary</p>
                    <p className="text-sm">{message.summary.summaryText}</p>
                  </div>
                )}
                
                {/* Action buttons */}
                <div className="flex justify-between mt-4">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => onMessageClick(message.id)}
                  >
                    Reply
                  </Button>
                  
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() => window.open('#', '_blank')}
                  >
                    View in {message.platform}
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}