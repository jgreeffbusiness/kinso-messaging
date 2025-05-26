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
      platformData?: {
        subject?: string
        direction?: 'inbound' | 'outbound'
        from?: string
        to?: string[]
        cc?: string[]
        labels?: string[]
        threadId?: string
        aiSummary?: string
        keyPoints?: string[]
        actionItems?: string[]
        urgency?: 'low' | 'medium' | 'high'
        category?: 'meeting' | 'administrative' | 'commercial' | 'personal' | 'notification' | 'other'
        originalContent?: string
      }
      contact: {
        id: string
        fullName: string
        email: string | null
      } | null
    }>
    platformData?: {
      subject?: string
      direction?: 'inbound' | 'outbound'
      from?: string
      to?: string[]
      cc?: string[]
      labels?: string[]
      threadId?: string
      // Enhanced AI fields
      aiSummary?: string
      keyPoints?: string[]
      actionItems?: string[]
      urgency?: 'low' | 'medium' | 'high'
      category?: 'meeting' | 'administrative' | 'commercial' | 'personal' | 'notification' | 'other'
      originalContent?: string
      isThreadSummary?: boolean
      analysis?: {
        keyTopics?: string[]
        keyInsights?: string[]
        actionItems?: string[]
        urgency?: 'low' | 'medium' | 'high'
        [key: string]: unknown
      }
      [key: string]: unknown
    }
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
  
  // Check if this message has been AI enhanced
  const isAIEnhanced = !!(message.platformData?.aiSummary)
  
  // Check if this is a thread summary message with rich analysis
  const isThreadSummary = (message.platformData as any)?.isThreadSummary === true
  const threadAnalysis = (message.platformData as any)?.analysis
  
  // For multi-threaded conversations, prefer thread analysis over individual message summary
  const getDisplayContent = () => {
    // If this is a thread summary message, use the rich thread content
    if (isThreadSummary && threadAnalysis) {
      return {
        summary: message.content, // This contains the rich narrative
        keyPoints: threadAnalysis.keyTopics || threadAnalysis.keyInsights || (message.platformData as any)?.keyPoints || [],
        actionItems: threadAnalysis.actionItems || (message.platformData as any)?.actionItems || [],
        urgency: threadAnalysis.urgency || (message.platformData as any)?.urgency || 'low'
      }
    }
    
    // For multi-threaded conversations without thread analysis, try to use thread context
    if (message.threadCount && message.threadCount > 1 && message.threadMessages) {
      // Look for thread analysis in the related messages
      const threadSummaryMsg = message.threadMessages.find(msg => 
        (msg.platformData as any)?.isThreadSummary === true
      )
      
      if (threadSummaryMsg && (threadSummaryMsg.platformData as any)?.analysis) {
        const analysis = (threadSummaryMsg.platformData as any).analysis
        return {
          summary: threadSummaryMsg.content,
          keyPoints: analysis.keyTopics || [],
          actionItems: analysis.actionItems || [],
          urgency: analysis.urgency || 'low'
        }
      }
    }
    
    // Fallback to individual message AI summary
    return {
      summary: message.platformData?.aiSummary || (
        message.content.length > 150 ? `${message.content.slice(0, 150)}...` : message.content
      ),
      keyPoints: message.platformData?.keyPoints || [],
      actionItems: message.platformData?.actionItems || [],
      urgency: message.platformData?.urgency || 'low'
    }
  }
  
  const displayContent = getDisplayContent()
  
  // Determine message status for styling
  const isUnread = !message.readAt
  const isHighPriority = displayContent.urgency === 'high'
  
  // Filter out "no-action" items and empty actions when determining if there are real action items
  const realActionItems = displayContent.actionItems.filter((action: string) => 
    action && 
    action.toLowerCase() !== 'no action required' && 
    action.toLowerCase() !== 'no action needed' &&
    !action.toLowerCase().includes('no action')
  )
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
          badge: 'bg-red-100 text-red-800 border-red-200',
          border: 'border-l-red-500',
          bg: 'bg-red-50'
        }
      case 'slack':
        return {
          iconBg: 'bg-purple-100 text-purple-600',
          badge: 'bg-purple-100 text-purple-800 border-purple-200',
          border: 'border-l-purple-500',
          bg: 'bg-purple-50'
        }
      case 'whatsapp':
        return {
          iconBg: 'bg-green-100 text-green-600',
          badge: 'bg-green-100 text-green-800 border-green-200',
          border: 'border-l-green-500',
          bg: 'bg-green-50'
        }
      default:
        return {
          iconBg: 'bg-gray-100 text-gray-600',
          badge: 'bg-gray-100 text-gray-800 border-gray-200',
          border: 'border-l-gray-500',
          bg: 'bg-gray-50'
        }
    }
  }

  const platformStyling = getPlatformStyling(message.platform)
  
  const subject = message.platformData?.subject || '(No subject)'
  
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
        
        {/* Platform icon with status */}
        <div className="flex-shrink-0 flex items-center gap-2">
          <div className={cn("p-1.5 rounded-full", platformStyling.iconBg)}>
            {getPlatformIcon(message.platform)}
          </div>
          {/* Removed redundant status icons - just show unread indicator if needed */}
          {isUnread && (
            <div className={`h-2 w-2 rounded-full ${
              getPlatformDisplay(message.platform) === 'gmail' ? 'bg-red-500' : 
              getPlatformDisplay(message.platform) === 'slack' ? 'bg-purple-500' : 'bg-green-500'
            }`} />
          )}
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
              
              {/* Priority and AI badges */}
              {isHighPriority && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  High Priority
                </Badge>
              )}
              
              {message.platformData?.category === 'meeting' && (
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
            {displayContent.summary}
          </p>

          {/* AI Insights bar (if available and not expanded) */}
          {!expanded && isAIEnhanced && displayContent.actionItems.length > 0 && (
            <div className="inline-flex items-center gap-2 text-xs bg-amber-50 rounded-lg p-2 mt-2 border border-amber-200 w-auto">
              <Zap className="h-3 w-3 text-amber-600" />
              <span className="text-amber-700 font-medium">AI detected:</span>
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                {displayContent.actionItems.length} actions needed
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
          {isAIEnhanced && (displayContent.keyPoints.length > 0 || displayContent.actionItems.length > 0) && (
            <div className="mb-4 space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
              {/* Key Points */}
              {displayContent.keyPoints.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Key Points
                  </h4>
                  <ul className="text-sm text-slate-600 space-y-1">
                    {displayContent.keyPoints.map((point: string, index: number) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full mt-1.5 flex-shrink-0"></span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Action Items */}
              {displayContent.actionItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-amber-700 mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                    Action Items
                  </h4>
                  <ul className="text-sm text-amber-700 space-y-1">
                    {displayContent.actionItems.map((action: string, index: number) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mt-1.5 flex-shrink-0"></span>
                        <span className="font-medium">{action}</span>
                      </li>
                    ))}
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
                  ? `View Full Thread (${message.threadCount} messages)`
                  : 'View Original Content'
                }
              </summary>
              <div className="mt-3 space-y-3 max-h-96 overflow-y-auto">
                {message.threadCount && message.threadCount > 1 && message.threadMessages ? (
                  // Show chronological thread conversation
                  message.threadMessages
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) // Oldest first for conversation flow
                    .map((threadMsg, index) => {
                      const isLatest = index === message.threadMessages!.length - 1
                      return (
                        <div key={threadMsg.id} className="border-l-2 border-gray-300 pl-3 pb-3">
                          <div className="text-xs text-gray-500 mb-1">
                            <strong>{threadMsg.contact?.fullName || 'Unknown'}</strong> • {' '}
                            {formatDistanceToNow(new Date(threadMsg.timestamp), { addSuffix: true })}
                            {isLatest && ' (latest)'}
                          </div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded p-2 border">
                            {threadMsg.platformData?.aiSummary || threadMsg.content}
                          </div>
                        </div>
                      )
                    })
                ) : (
                  // Show original content
                  <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded p-3 border">
                    {message.platformData?.originalContent || message.content}
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