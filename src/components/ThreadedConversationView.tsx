'use client'

import React, { useState } from 'react'

interface ConversationThread {
  id: string
  title: string
  summary: string
  messages: Array<{
    id: string
    content: string
    timestamp: Date
    sender: {
      id: string
      name: string
    }
    platform: string
  }>
  startTime: Date
  endTime: Date
  participants: string[]
  topic: string
  actionItems?: string[]
  userParticipated: boolean
}

interface ThreadedConversationViewProps {
  threads: ConversationThread[]
  loading?: boolean
}

export function ThreadedConversationView({ threads, loading }: ThreadedConversationViewProps) {
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  
  const toggleThread = (threadId: string) => {
    const newExpanded = new Set(expandedThreads)
    if (newExpanded.has(threadId)) {
      newExpanded.delete(threadId)
    } else {
      newExpanded.add(threadId)
    }
    setExpandedThreads(newExpanded)
  }
  
  const formatRelativeTime = (date: Date) => {
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`
    
    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays < 7) return `${diffInDays}d ago`
    
    return date.toLocaleDateString()
  }
  
  const getPlatformIcon = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'slack':
        return <span className="text-purple-500">#</span>
      case 'email':
        return <span className="text-blue-500">@</span>
      default:
        return <span className="text-gray-500">💬</span>
    }
  }
  
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-lg border p-4">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    )
  }
  
  if (threads.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-4xl mb-2 opacity-50">💬</div>
        <p>No conversation threads found</p>
      </div>
    )
  }
  
  return (
    <div className="space-y-4">
      {threads.map((thread) => (
        <div key={thread.id} className="bg-white rounded-lg border shadow-sm hover:shadow-md transition-shadow">
          {/* Thread Header */}
          <div 
            className="p-4 cursor-pointer border-b border-gray-100 hover:bg-gray-50"
            onClick={() => toggleThread(thread.id)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-400 text-sm">
                    {expandedThreads.has(thread.id) ? '▼' : '▶'}
                  </span>
                  {getPlatformIcon(thread.messages[0]?.platform)}
                  <h3 className="font-medium text-gray-900">{thread.title}</h3>
                  {thread.userParticipated && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      👤 You participated
                    </span>
                  )}
                </div>
                
                <p className="text-sm text-gray-600 mb-2">{thread.summary}</p>
                
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    🕒 {formatRelativeTime(thread.endTime)}
                  </span>
                  <span>{thread.participants.join(', ')}</span>
                  <span>{thread.messages.length} messages</span>
                </div>
              </div>
              
              {/* Action Items Badge */}
              {thread.actionItems && thread.actionItems.length > 0 && (
                <div className="ml-4">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                    {thread.actionItems.length} action{thread.actionItems.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>
          </div>
          
          {/* Expanded Thread Content */}
          {expandedThreads.has(thread.id) && (
            <div className="p-4 pt-0">
              {/* Action Items */}
              {thread.actionItems && thread.actionItems.length > 0 && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <h4 className="font-medium text-amber-900 mb-2">Action Items:</h4>
                  <ul className="space-y-1 text-sm text-amber-800">
                    {thread.actionItems.map((item, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="text-amber-600">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Messages */}
              <div className="space-y-3">
                {thread.messages.map((message) => (
                  <div key={message.id} className="flex gap-3">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                        {message.sender.name.charAt(0).toUpperCase()}
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900">{message.sender.name}</span>
                        <span className="text-xs text-gray-500">
                          {message.timestamp.toLocaleTimeString([], { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </span>
                        {getPlatformIcon(message.platform)}
                      </div>
                      
                      <div className="text-sm text-gray-700 break-words">
                        {/* Handle different content types */}
                        {message.content.startsWith('http') ? (
                          <a 
                            href={message.content} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            {message.content}
                          </a>
                        ) : (
                          <span className="whitespace-pre-wrap">{message.content}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Thread Metadata */}
              <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
                <div className="flex justify-between items-center">
                  <span>
                    Conversation from {thread.startTime.toLocaleDateString()} to {thread.endTime.toLocaleDateString()}
                  </span>
                  <span className="px-2 py-1 bg-gray-100 rounded-full">
                    {thread.topic}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
} 