'use client'

import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Badge } from '@components/ui/badge'
import { Separator } from '@components/ui/separator'
import { cn } from '@lib/utils'
import { useChat } from '@/providers/ChatProvider'
import { useSelectedMessage } from '@/providers/SelectedMessageProvider'
import { useAIContext } from '@hooks/useAIContext'
import useMessages from '@hooks/useMessages'
import { 
  Brain, 
  Calendar, 
  Clock, 
  MessageSquare, 
  StickyNote, 
  CheckSquare,
  Sparkles,
  Eye,
  CheckCircle
} from 'lucide-react'
import { SuggestedAction } from '@/lib/ai-context'
import { toast } from 'sonner'

export function RightPanel() {
  const { 
    inputValue, 
    setInputValue, 
    messages, 
    addMessage
  } = useChat()

  const { selectedMessageId } = useSelectedMessage()
  const { messages: allMessages } = useMessages()
  
  // AI Context for selected message - cast messages to handle type compatibility
  const { context: aiContext, loading: aiLoading } = useAIContext({
    selectedMessageId,
    messages: (allMessages || []) as any[]
  })

  // Handle AI suggested actions
  const handleAIAction = (action: SuggestedAction) => {
    switch (action.type) {
      case 'reply':
        addMessage({
          content: `I'll help you draft a reply for: "${action.title}"`,
          sender: 'assistant',
          createdAt: new Date().toISOString()
        })
        break
      case 'calendar':
        toast.info('Calendar integration coming soon!')
        break
      case 'reminder':
        toast.info('Reminder feature coming soon!')
        break
      case 'note':
        addMessage({
          content: `Note added: ${action.description}`,
          sender: 'assistant', 
          createdAt: new Date().toISOString()
        })
        break
      case 'task':
        addMessage({
          content: `Task created: ${action.title}`,
          sender: 'assistant',
          createdAt: new Date().toISOString()
        })
        break
      case 'monitor':
        addMessage({
          content: `I'll monitor this thread for you. You'll be notified if you're directly addressed.`,
          sender: 'assistant',
          createdAt: new Date().toISOString()
        })
        break
      case 'no-action':
        addMessage({
          content: `No action needed right now. ${action.description}`,
          sender: 'assistant',
          createdAt: new Date().toISOString()
        })
        break
      default:
        addMessage({
          content: `${action.title} - I'll help you with this!`,
          sender: 'assistant',
          createdAt: new Date().toISOString()
        })
    }
  }

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'calendar': return <Calendar className="h-4 w-4" />
      case 'reminder': return <Clock className="h-4 w-4" />
      case 'reply': return <MessageSquare className="h-4 w-4" />
      case 'note': return <StickyNote className="h-4 w-4" />
      case 'task': return <CheckSquare className="h-4 w-4" />
      case 'monitor': return <Eye className="h-4 w-4" />
      case 'no-action': return <CheckCircle className="h-4 w-4" />
      default: return <Sparkles className="h-4 w-4" />
    }
  }

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200'
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low': return 'bg-green-100 text-green-800 border-green-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  return (
    <div className="border-l w-80 flex flex-col bg-background">
      <div className="flex items-center p-4 border-b">
        <h3 className="font-medium flex items-center gap-2">
          <Brain className="h-5 w-5 text-blue-600" />
          AI Assistant
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {/* AI Context Section - Only show when message is selected */}
        {selectedMessageId && (
          <div className="p-4 border-b bg-gray-50/50">
            {aiLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Analyzing thread...
                </div>
              </div>
            ) : aiContext ? (
              <div className="space-y-3">
                {/* Context Overview */}
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <Badge variant="outline" className={cn("text-xs", getUrgencyColor(aiContext.urgency))}>
                    {aiContext.urgency} priority
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {aiContext.threadType}
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                    {aiContext.userRole}
                  </Badge>
                </div>

                {/* Thread Summary */}
                <div>
                  <h4 className="text-sm font-medium mb-2">Summary</h4>
                  <p className="text-xs text-gray-700 leading-relaxed">
                    {aiContext.summary}
                  </p>
                </div>

                {/* Key Insights */}
                {aiContext.keyInsights.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Key Insights</h4>
                    <ul className="space-y-1">
                      {aiContext.keyInsights.slice(0, 2).map((insight, index) => (
                        <li key={index} className="text-xs text-gray-600 flex items-start gap-2">
                          <span className="w-1 h-1 bg-blue-500 rounded-full mt-1.5 flex-shrink-0"></span>
                          <span>{insight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggested Actions */}
                <div>
                  <h4 className="text-sm font-medium mb-2">Suggested Actions</h4>
                  <div className="space-y-1">
                    {aiContext.suggestedActions.slice(0, 3).map((action) => (
                      <Button
                        key={action.id}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start gap-2 h-auto p-2 text-xs"
                        onClick={() => handleAIAction(action)}
                      >
                        <div className="flex items-center gap-2 w-full">
                          {getActionIcon(action.type)}
                          <span className="flex-1 text-left truncate min-w-0">{action.title}</span>
                          <Badge variant="secondary" className="text-xs flex-shrink-0 ml-1">
                            {Math.round(action.confidence * 100)}%
                          </Badge>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p>Select a message to see AI insights</p>
              </div>
            )}
          </div>
        )}

        {/* Chat Messages */}
        <div className="space-y-4 p-4">
          {messages.map(message => (
            <div 
              key={message.id} 
              className={cn(
                "p-3 rounded-lg break-words",
                message.sender === "assistant" ? "bg-muted" : "bg-primary text-primary-foreground ml-8"
              )}
            >
              <p className="text-sm">{message.content}</p>
            </div>
          ))}
        </div>
      </div>
      
      <div className="p-3 border-t mt-auto">
        <div className="flex gap-2">
          <Input 
            placeholder="Ask anything..." 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!inputValue.trim()) return;
                
                addMessage({
                  content: inputValue,
                  sender: "user",
                  createdAt: new Date().toISOString()
                });
                
                setInputValue('');
              }
            }}
          />
          <Button 
            size="sm" 
            onClick={() => {
              if (!inputValue.trim()) return;
              
              addMessage({
                content: inputValue,
                sender: "user",
                createdAt: new Date().toISOString()
              });
              
              setInputValue('');
            }}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  )
} 