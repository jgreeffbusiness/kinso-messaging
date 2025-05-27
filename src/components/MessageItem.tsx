'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { 
  Mail, 
  Hash, 
  MessageCircle, 
  CheckCircle, 
  AlertTriangle, 
  ChevronDown, 
  ChevronRight,
  Zap,
  Calendar
} from 'lucide-react'
import { cn } from '@lib/utils'
import { Badge } from '@components/ui/badge'
import { SuggestedAction, ThreadAnalysis } from '@/lib/thread-processor'
import { PlatformData as MessagePlatformData } from '@hooks/useThreadedMessages'

interface MessageItemProps {
  message: {
    id: string
    platform: string
    content: string
    timestamp: Date
    threadCount?: number
    threadMessages?: Array<{
      id: string
      platform: string
      content: string
      timestamp: Date
      platformData?: MessagePlatformData
      contact: {
        id: string
        fullName: string
        email: string | null
      } | null
    }>
    platformData?: MessagePlatformData
    readAt?: Date | null
  }
  contact: {
    id: string
    name: string
    email?: string
  }
  showContact?: boolean
}

export function MessageItem({ message, contact, showContact = true }: MessageItemProps) {
  const [expanded, setExpanded] = useState(false)
  
  // Format the timestamp - show relative time (e.g. "2 days ago")
  const relativeTime = formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })
  
  // Explicitly typed variables from message.platformData
  const currentMessagePlatformData: MessagePlatformData | undefined = message.platformData;
  const analysisFromPlatformData: ThreadAnalysis | null | undefined = currentMessagePlatformData?.analysis;
  
  // Check if this message has been AI enhanced
  const isAIEnhanced = !!(analysisFromPlatformData || currentMessagePlatformData?.aiSummary)
  
  // Check if this is a thread summary message with rich analysis
  const isThreadSummary = !!currentMessagePlatformData?.isThreadSummary
  
  // Define display values directly based on conditions
  const displaySummary: string = 
    isThreadSummary && analysisFromPlatformData?.summary ? analysisFromPlatformData.summary :
    currentMessagePlatformData?.aiSummary ? currentMessagePlatformData.aiSummary :
    (message.content.length > 150 ? `${message.content.slice(0, 150)}...` : message.content);

  const displayKeyPoints: string[] = 
    isThreadSummary && analysisFromPlatformData?.keyInsights ? analysisFromPlatformData.keyInsights :
    currentMessagePlatformData?.keyPoints || [];

  // actionItems can be SuggestedAction[] or string[], filter logic will handle it
  const displayActionItems: (SuggestedAction[] | string[]) = 
    isThreadSummary && analysisFromPlatformData?.actionItems ? analysisFromPlatformData.actionItems : // SuggestedAction[]
    currentMessagePlatformData?.actionItems || []; // string[]

  const displayUrgency: 'low' | 'medium' | 'high' | 'urgent' = 
    (isThreadSummary && analysisFromPlatformData?.urgency) ? analysisFromPlatformData.urgency :
    currentMessagePlatformData?.urgency || 'low';
  
  // Determine message status for styling
  const isUnread = !message.readAt
  // Refined isHighPriority to include 'urgent'
  const isUrgent = displayUrgency === 'urgent'
  const isHighPriority = displayUrgency === 'high' || isUrgent // Urgent implies high priority
  
  // Filter out "no-action" items and empty actions when determining if there are real action items
  const realActionItems = displayActionItems.filter((action: string | SuggestedAction) => {
    const title = typeof action === 'string' ? action : action.title
    return title && title.toLowerCase() !== 'no action required' && title.toLowerCase() !== 'no action needed' && !title.toLowerCase().includes('no action')
  })
  const hasActionItems = realActionItems.length > 0
  
  // Get platform display name and icon
  const getPlatformDisplay = (platform: string) => {
    const platformLower = platform.toLowerCase()
    if (platformLower === 'email' || platformLower === 'gmail') return 'gmail'
    return platformLower
  }
  
  // Get platform icon
  const getPlatformIcon = (platform: string) => {
    const displayPlatform = getPlatformDisplay(platform)
    switch (displayPlatform) {
      case 'gmail':
        return <Mail className="h-4 w-4" />
      case 'slack':
        return <Hash className="h-4 w-4" />
      case 'whatsapp':
        return <MessageCircle className="h-4 w-4" />
      default:
        return <MessageCircle className="h-4 w-4" />
    }
  }
  
  // Get platform-specific styling
  const getPlatformStyling = (platform: string) => {
    const displayPlatform = getPlatformDisplay(platform)
    switch (displayPlatform) {
      case 'gmail':
        return {
          iconBg: 'bg-red-100 text-red-600',
          badge: 'bg-red-50 text-red-700 border-red-100',
          border: 'border-l-red-400',
          bg: 'bg-white',
          unreadDot: 'bg-red-500'
        }
      case 'slack':
        return {
          iconBg: 'bg-purple-100 text-purple-600',
          badge: 'bg-purple-50 text-purple-700 border-purple-100',
          border: 'border-l-purple-400',
          bg: 'bg-white',
          unreadDot: 'bg-purple-500'
        }
      case 'whatsapp':
        return {
          iconBg: 'bg-green-100 text-green-600',
          badge: 'bg-green-50 text-green-700 border-green-100',
          border: 'border-l-green-400',
          bg: 'bg-white',
          unreadDot: 'bg-green-500'
        }
      default:
        return {
          iconBg: 'bg-gray-100 text-gray-600',
          badge: 'bg-gray-50 text-gray-700 border-gray-100',
          border: 'border-l-gray-400',
          bg: 'bg-white',
          unreadDot: 'bg-gray-500'
        }
    }
  }

  const platformStyling = getPlatformStyling(message.platform)
  
  const subject = currentMessagePlatformData?.subject || '(No subject)'
  
  // Check if we should show original content section
  const hasOriginalOrThread = isAIEnhanced || (message.threadCount && message.threadCount > 1)
  
  return (
    <div 
      className={cn(
        "border rounded-lg overflow-hidden transition-all duration-200 hover:shadow-md border-l-4",
        expanded ? "shadow-md" : "hover:shadow-sm",
        // Platform-specific left border - always show, stronger for unread/priority
        (isUnread || isHighPriority) 
          ? `${platformStyling.border} ${platformStyling.bg}` 
          : `border-l-gray-200 bg-white`
      )}
    >
      {/* Message Header - Always visible */}
      <div 
        className={cn(
          "p-4 flex items-start gap-3 cursor-pointer transition-colors",
          "hover:bg-gray-50"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand/Collapse indicator */}
        <div className="flex-shrink-0 mt-0.5 text-gray-400">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
        
        {/* Platform icon with status dot container */}
        <div className="flex-shrink-0 relative mr-2">
          <div className={cn("p-1.5 rounded-full", platformStyling.iconBg)}>
            {getPlatformIcon(message.platform)}
          </div>
          {/* Unread Dot REMOVED */}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge 
                variant="outline" 
                className={cn("font-normal text-xs", platformStyling.badge)}
              >
                {getPlatformDisplay(message.platform)}
              </Badge>
              
              {showContact && (
                <span className="text-sm font-medium text-gray-900">
                  {contact.name}
                </span>
              )}

              {/* "NEEDS YOUR ATTENTION" Badge REMOVED */}
              
              {currentMessagePlatformData?.category === 'meeting' && (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                  <Calendar className="h-3 w-3 mr-1" />
                  Meeting
                </Badge>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {/* Thread count indicator */}
              {message.threadCount && message.threadCount > 1 && (
                <Badge variant="secondary" className="text-xs">
                  {message.threadCount} messages
                </Badge>
              )}
              
              {/* Removed hover actions - defer all actions to AI assistant */}
              
              <span className="text-xs text-muted-foreground">
                {relativeTime}
              </span>
            </div>
          </div>
          
          {/* Subject */}
          <h3 className="font-semibold text-sm mb-1 text-gray-900">{subject}</h3>
          
          {/* Preview content - focus on AI summary */}
          <p className="text-sm text-gray-600 line-clamp-3 mb-2">
            {displaySummary}
          </p>

          {/* AI Insights bar (if available and not expanded) */}
          {!expanded && isAIEnhanced && hasActionItems && (
            <div className="inline-flex items-center gap-2 text-xs bg-amber-50 rounded-lg p-2 mt-2 border border-amber-200 w-auto">
              <Zap className="h-3 w-3 text-amber-600" />
              <span className="text-amber-700 font-medium">AI detected:</span>
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                {realActionItems.length} {realActionItems.length === 1 ? 'action' : 'actions'} needed
              </Badge>
            </div>
          )}

          {/* Quick action chips for high priority */}
          {!expanded && isHighPriority && hasActionItems && (
            <div className="flex gap-2 mt-2">
              <div className="text-xs text-amber-600 font-medium">
                High priority • Use AI assistant for actions →
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t pt-4 bg-muted/30">
          {/* AI Insights - Show key points and action items directly */}
          {isAIEnhanced && (displayKeyPoints.length > 0 || realActionItems.length > 0) && (
            <div className="mb-4 space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
              {/* Key Points */}
              {displayKeyPoints.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Key Points
                  </h4>
                  <ul className="text-sm text-slate-600 space-y-1">
                    {displayKeyPoints.map((point: string, index: number) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full mt-1.5 flex-shrink-0"></span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Action Items */}
              {realActionItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-amber-700 mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                    Action Items
                  </h4>
                  <ul className="text-sm text-amber-700 space-y-1">
                    {displayActionItems.map((actionOrObject: string | SuggestedAction, index: number) => {
                      const actionTitle = typeof actionOrObject === 'string' ? actionOrObject : actionOrObject.title;
                      const actionKey = typeof actionOrObject === 'string' ? `str-action-${index}` : (actionOrObject.id || `sa-action-${index}`);
                      // Filter out "no action" type items directly in the map for cleaner rendering
                      if (typeof actionOrObject !== 'string' && actionOrObject.type === 'no-action') return null;
                      if (actionTitle.toLowerCase() === 'no action required' || actionTitle.toLowerCase() === 'no action needed' || actionTitle.toLowerCase().includes('no action')) return null;
                      return (
                        <li key={actionKey} className="flex items-start gap-2">
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mt-1.5 flex-shrink-0"></span>
                          <span className="font-medium">{actionTitle}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
          
          {/* Removed action buttons - all actions now handled by AI assistant */}
          
          {/* Original content/Thread section */}
          {hasOriginalOrThread && (
            <details className="mt-4 bg-gray-50 rounded-lg p-3 border">
              <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-800">
                {message.threadCount && message.threadCount > 1 
                  ? `View Thread Details (${message.threadCount} messages total)`
                  : 'View Original Content'
                }
              </summary>
              <div className="mt-3 space-y-3 max-h-96 overflow-y-auto">
                {message.threadCount && message.threadCount > 1 ? (
                  message.threadMessages && message.threadMessages.length > 0 ? (
                    // Show chronological thread conversation for small threads
                    message.threadMessages
                      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) // Oldest first for conversation flow
                      .map((threadMsg, index) => {
                        const isLatest = index === message.threadMessages!.length - 1;
                        // const threadMsgPlatformData = threadMsg.platformData as MessagePlatformData | undefined; // Not needed if only showing content
                        return (
                          <div key={threadMsg.id} className="border-l-2 border-gray-300 pl-3 pb-3">
                            <div className="text-xs text-gray-500 mb-1">
                              <strong>{threadMsg.contact?.fullName || (threadMsg.platformData as MessagePlatformData)?.from || 'Unknown'}</strong> • {' '}
                              {formatDistanceToNow(new Date(threadMsg.timestamp), { addSuffix: true })}
                              {isLatest && ' (latest)'}
                            </div>
                            <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded p-2 border">
                              {threadMsg.content} {/* <<< Ensure this ONLY shows raw content */}
                            </div>
                          </div>
                        );
                      })
                  ) : (
                    // Large thread with AI summary only
                    <div className="text-sm text-gray-600 bg-blue-50 rounded p-3 border border-blue-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Mail className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-800">Large Thread ({message.threadCount} messages)</span>
                      </div>
                      <p className="text-blue-700">
                        This is a large email thread with {message.threadCount} messages. 
                        The AI has analyzed the entire conversation and provided the summary above.
                      </p>
                      {analysisFromPlatformData && (
                        <div className="mt-2 text-xs text-blue-600">
                          ✨ AI has processed the full thread for key insights and action items
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  // Show original content for single messages
                  <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded p-3 border">
                    {currentMessagePlatformData?.originalContent || message.content}
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
} 

export default MessageItem