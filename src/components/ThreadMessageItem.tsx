'use client'

import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Reply, Calendar, User, Users } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface ThreadGroup {
  threadId: string
  subject: string
  latestMessage: {
    id: string
    platform: string
    content: string
    timestamp: Date
    platformData: any
  }
  messageCount: number
  participants: Array<{
    id: string
    name: string
    email: string | null
  }>
  timestamp: Date
  isFromMe: boolean
}

interface ThreadMessageItemProps {
  thread: ThreadGroup
  onReply?: (threadId: string) => void
  onViewThread?: (threadId: string) => void
}

export function ThreadMessageItem({ 
  thread, 
  onReply, 
  onViewThread 
}: ThreadMessageItemProps) {
  const { latestMessage, participants, messageCount, isFromMe } = thread

  // Get platform badge styling
  const getPlatformBadge = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'email':
      case 'gmail':
        return { variant: 'outline' as const, text: 'gmail', icon: '📧' }
      case 'slack':
        return { variant: 'secondary' as const, text: 'slack', icon: '💬' }
      case 'whatsapp':
        return { variant: 'default' as const, text: 'whatsapp', icon: '📱' }
      default:
        return { variant: 'outline' as const, text: platform, icon: '💌' }
    }
  }

  // Get urgency styling
  const getUrgencyBadge = (urgency?: string) => {
    if (!urgency || urgency === 'low') return null
    
    switch (urgency) {
      case 'high':
        return { variant: 'destructive' as const, text: 'Urgent' }
      case 'medium':
        return { variant: 'secondary' as const, text: 'Important' }
      default:
        return null
    }
  }

  const platformBadge = getPlatformBadge(latestMessage.platform)
  const urgencyBadge = getUrgencyBadge(latestMessage.platformData?.urgency)
  const isMeeting = latestMessage.platformData?.category === 'meeting'

  // Format participants display
  const primaryParticipant = participants[0]
  const additionalCount = participants.length - 1

  const getInitials = (name: string) => {
    return name.split(' ').map(part => part[0]).join('').toUpperCase().substring(0, 2)
  }

  return (
    <Card className="mb-4 hover:shadow-md transition-shadow cursor-pointer">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-1">
            {/* Avatar */}
            <Avatar className="h-10 w-10">
              <AvatarFallback className="text-sm">
                {primaryParticipant ? getInitials(primaryParticipant.name) : '?'}
              </AvatarFallback>
            </Avatar>

            {/* Thread Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium text-sm truncate">
                  {thread.subject}
                </h3>
                {messageCount > 1 && (
                  <Badge variant="secondary" className="text-xs">
                    {messageCount} messages
                  </Badge>
                )}
              </div>

              {/* Participants */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {participants.length === 1 ? (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {primaryParticipant.name}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {primaryParticipant.name}
                    {additionalCount > 0 && (
                      <span>+ {additionalCount} other{additionalCount === 1 ? '' : 's'}</span>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Timestamp and Direction */}
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-1">
                {formatDistanceToNow(thread.timestamp, { addSuffix: true })}
              </div>
              <div className="text-xs">
                {isFromMe ? (
                  <span className="text-blue-600">→ Sent</span>
                ) : (
                  <span className="text-green-600">← Received</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 mt-2">
          <Badge {...platformBadge}>
            <span className="mr-1">{platformBadge.icon}</span>
            {platformBadge.text}
          </Badge>
          
          {urgencyBadge && (
            <Badge {...urgencyBadge}>
              {urgencyBadge.text}
            </Badge>
          )}
          
          {isMeeting && (
            <Badge variant="outline" className="text-purple-700 border-purple-200">
              <Calendar className="h-3 w-3 mr-1" />
              Meeting
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Message Content */}
        <div className="bg-gray-50 rounded-lg p-3 mb-3">
          <p className="text-sm leading-relaxed line-clamp-3">
            {latestMessage.content}
          </p>
        </div>

        {/* AI Insights */}
        {latestMessage.platformData?.keyPoints && latestMessage.platformData.keyPoints.length > 0 && (
          <div className="mb-3">
            <h4 className="text-xs font-medium text-muted-foreground mb-1">Key Points:</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              {latestMessage.platformData.keyPoints.slice(0, 2).map((point: string, index: number) => (
                <li key={index} className="flex items-start gap-1">
                  <span className="text-gray-400 mt-0.5">•</span>
                  <span className="line-clamp-1">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReply?.(thread.threadId)}
            className="gap-1"
          >
            <Reply className="h-3 w-3" />
            Reply
          </Button>
          
          {messageCount > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewThread?.(thread.threadId)}
              className="gap-1"
            >
              View Thread ({messageCount})
            </Button>
          )}
        </div>

        {/* Participant Details (collapsible) */}
        {participants.length > 1 && (
          <details className="mt-3">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              View all participants ({participants.length})
            </summary>
            <div className="mt-2 space-y-1">
              {participants.map((participant) => (
                <div key={participant.id} className="text-xs text-muted-foreground flex items-center gap-2">
                  <Avatar className="h-4 w-4">
                    <AvatarFallback className="text-xs">
                      {getInitials(participant.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span>{participant.name}</span>
                  {participant.email && (
                    <span className="text-gray-400">({participant.email})</span>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
} 