'use client'

import { MessageItem } from '@components/MessageItem'

type MessageListProps = {
  messages: any[]
  showContact?: boolean
  onMessageClick: (messageId: string) => void
}

export default function MessageList({ messages, onMessageClick, showContact = true }: MessageListProps) {
  return (
    <div className="space-y-4">
      {messages.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          No messages yet
        </div>
      ) : (
        messages.map(message => (
          <MessageItem 
            key={message.id}
            message={{
              id: message.id,
              platform: message.platform,
              content: message.content,
              timestamp: new Date(message.timestamp),
              platformData: {
                subject: message.subject || message.title,
                direction: message.direction
              }
            }}
            contact={{
              id: message.contact?.id || '',
              name: message.contact?.fullName || 'Unknown',
              email: message.contact?.email || ''
            }}
            onReply={() => onMessageClick(message.id)}
            showContact={showContact}
          />
        ))
      )}
    </div>
  )
}