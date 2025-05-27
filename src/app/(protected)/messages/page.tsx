'use client'

import { useState, useEffect, useMemo } from 'react'
import useMessages from '@hooks/useMessages'
import { useThreadedMessages, EnhancedMessage, Message } from '@hooks/useThreadedMessages'
import { useActiveFocus } from '@providers/ActiveFocusProvider'
import SharedLayout from '@components/layout/SharedLayout'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Badge } from '@components/ui/badge'
import { Switch } from '@components/ui/switch'
import { 
  Search, 
  Loader2, 
  CheckCircle2,
  Wifi,
  RefreshCw
} from 'lucide-react'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@components/ui/select'
import MessageItem from '@components/MessageItem'
import { useAuth } from '@/components/AuthProvider'

interface AutoSyncStatus {
  autoSyncEnabled: boolean
  currentlySyncing: boolean
  lastSync?: string
  syncStatus?: {
    platforms: Array<{
      platform: string
      messagesProcessed: number
      newMessages: number
      lastSync: string
    }>
  }
}

export default function MessagesPage() {
  const { setActiveItem, setSelectedMessageId } = useActiveFocus()
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus>({
    autoSyncEnabled: false,
    currentlySyncing: false
  })
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  
  const { 
    messages, 
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    platformFilter,
    setPlatformFilter,
    refetch,
    refreshMessages
  } = useMessages()

  const { user } = useAuth()
  const currentUserSlackId = user?.slackUserId

  const deduplicatedMessages: EnhancedMessage[] = useThreadedMessages((messages || []) as Message[], currentUserSlackId)

  // Filter messages by read/unread status
  const filteredMessages = showUnreadOnly 
    ? deduplicatedMessages.filter(m => !m.readAt)
    : deduplicatedMessages

  // Get unread count
  const unreadCount = useMemo(() => deduplicatedMessages.filter(m => !m.readAt).length, [deduplicatedMessages])

  // Fetch auto-sync status
  useEffect(() => {
    fetchAutoSyncStatus()
    const interval = setInterval(fetchAutoSyncStatus, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Check initial sync status on page load (without triggering sync)
  useEffect(() => {
    const checkInitialSyncStatus = async () => {
      try {
        console.log('Checking initial sync status...')
        
        const autoSyncResponse = await fetch('/api/sync/auto')
        if (autoSyncResponse.ok) {
          const autoStatus = await autoSyncResponse.json()
          console.log('Initial sync status:', {
            complete: autoStatus.initialSyncComplete,
            skipped: autoStatus.skipped,
            reason: autoStatus.reason
          })
          
          // Don't trigger sync - let user manually trigger if needed
          // The auto-sync endpoint will handle initial sync when called naturally
        }
      } catch (error) {
        console.error('Failed to check sync status:', error)
        // Fail silently - don't interrupt user experience
      }
    }

    // Only check status, don't trigger sync
    if (!isLoading) {
      checkInitialSyncStatus()
    }
  }, [isLoading])

  const fetchAutoSyncStatus = async () => {
    try {
      const response = await fetch('/api/sync/auto')
      if (response.ok) {
        const status = await response.json()
        setAutoSyncStatus(status)
      }
    } catch (error) {
      console.error('Failed to fetch auto-sync status:', error)
    }
  }

  // Mark messages as read/unread
  const markMessagesAsRead = async (messageIds: string[], markAsRead: boolean) => {
    try {
      const response = await fetch('/api/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds, markAsRead })
      })
      
      if (response.ok) {
        // Instead of full refetch, just invalidate the query to update from cache
        // Only refetch if data is stale
        await refetch()
      }
    } catch (_error) {
      console.error('Failed to mark messages as read:', _error)
    }
  }

  // Mark all as read
  const markAllAsRead = async () => {
    try {
      const response = await fetch('/api/messages/read', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' })
      })
      
      if (response.ok) {
        // Instead of full refetch, just invalidate the query
        await refetch()
      }
    } catch (_error) {
      console.error('Failed to mark all as read:', _error)
    }
  }

  // Analyze threads for all contacts automatically in background (only if needed)
  const analyzeAllThreads = async () => {
    try {
      // Get unique contact IDs from current messages
      const contactIds = [...new Set(
        (messages || [])
          .map(msg => msg.contact?.id)
          .filter((id): id is string => Boolean(id))
      )]

      // Only analyze if we have contacts
      if (contactIds.length === 0) return

      console.log(`Found ${contactIds.length} contacts to potentially analyze`)

      // Check which contacts need analysis by looking for existing thread summaries
      const needsAnalysis = []
      
      for (const contactId of contactIds) {
        // Get messages for this contact
        const contactMessages = (messages || []).filter(msg => msg.contact?.id === contactId)
        
        // Check if we already have thread summaries for this contact
        // Focus on platform names which are reliable indicators
        const hasThreadSummary = contactMessages.some(msg => 
          msg.platform === 'thread_summary' || 
          msg.platform === 'email_thread' || 
          msg.platform === 'slack_thread_summary'
        )
        
        // If no thread summary exists and we have multiple messages, we need to analyze
        if (!hasThreadSummary && contactMessages.length > 1) {
          needsAnalysis.push(contactId)
        }
      }

      // Only proceed if there are contacts that need analysis
      if (needsAnalysis.length === 0) {
        console.log('All threads already analyzed or no multi-message conversations found')
        return // All threads already analyzed
      }

      console.log(`Analyzing threads for ${needsAnalysis.length} contacts`)

      // Analyze threads only for contacts that need it
      const analysisPromises = needsAnalysis.map(async (contactId) => {
        try {
          const response = await fetch('/api/emails/analyze-threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId })
          })
          
          if (response.ok) {
            const data = await response.json()
            console.log(`Thread analysis for contact ${contactId}:`, data.success ? 'success' : 'failed')
            return data.success
          }
        } catch (error) {
          console.error(`Thread analysis failed for contact ${contactId}:`, error)
          return false
        }
      })

      const results = await Promise.all(analysisPromises)
      const successCount = results.filter(r => r).length
      console.log(`Thread analysis completed: ${successCount}/${needsAnalysis.length} contacts analyzed successfully`)
      
      // DON'T refetch here - this creates a dependency cycle!
      // The thread analysis API should return the new messages, or we should
      // invalidate the cache without forcing an immediate refetch
      console.log('Thread analysis complete - new thread summaries will appear on next natural refresh')
    } catch (error) {
      console.error('Thread analysis error:', error)
      // Fail silently - this is background processing
    }
  }

  // Track if we've already analyzed to prevent repeated analysis
  const [hasAnalyzed, setHasAnalyzed] = useState(false)

  // Auto-analyze threads when messages are loaded (only once)
  useEffect(() => {
    if (messages && messages.length > 0 && !hasAnalyzed) {
      // Only analyze once per page load
      const timer = setTimeout(() => {
        analyzeAllThreads().then(() => {
          setHasAnalyzed(true) // Mark as analyzed to prevent re-running
        })
      }, 3000) // Wait 3 seconds after messages load to ensure sync is done
      
      return () => clearTimeout(timer)
    }
  }, [messages, hasAnalyzed])

  // Handle message click - set as selected
  const handleMessageClick = (messageId: string) => {
    const message = deduplicatedMessages.find(m => m.id === messageId);
    if (message) {
      setActiveItem({ type: 'message', data: message });
      if (!message.readAt) {
        markMessagesAsRead([messageId], true);
      }
    }
  }

  // Manual refresh handler
  const handleRefresh = async () => {
    console.log('🔄 User requested manual refresh')
    await refreshMessages()
  }

  return (
    <SharedLayout>
      <div className="flex h-full flex-col">
        {/* Header Section */}
        <div className="flex-shrink-0 p-6 space-y-6 border-b bg-background">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Messages</h1>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="px-2 py-1">
                  {unreadCount} unread
                </Badge>
              )}
              {/* Simple sync status indicator */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {autoSyncStatus.currentlySyncing ? (
                  <div className="flex items-center gap-1 text-blue-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Syncing...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-green-600">
                    <Wifi className="h-4 w-4" />
                    <span>Up to date</span>
                  </div>
                )}
                {autoSyncStatus.lastSync && (
                  <span className="text-xs">
                    • Last sync: {new Date(autoSyncStatus.lastSync).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Manual refresh button for when webhooks deliver new messages */}
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleRefresh}
                disabled={isLoading}
                className="flex items-center gap-1"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
          
          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search messages..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All platforms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Switch
                checked={showUnreadOnly}
                onCheckedChange={setShowUnreadOnly}
              />
              <label className="text-sm">Unread only</label>
            </div>

            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={markAllAsRead}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark All Read
              </Button>
            )}
          </div>
        </div>
        
        {/* Messages List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                Error loading messages: {error.message || 'Unknown error'}
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {showUnreadOnly
                  ? 'No unread messages'
                  : searchQuery || platformFilter !== 'all' 
                  ? 'No messages match your search or filter' 
                  : 'No messages yet'}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredMessages.map(message => (
                  <div 
                    key={message.id} 
                    className="cursor-pointer"
                    onClick={() => handleMessageClick(message.id)}
                  >
                    <MessageItem 
                      message={message}
                      contact={{
                        id: message.contact?.id || '',
                        name: message.displayName,
                        email: message.contact?.email || ''
                      }}
                      showContact={true}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SharedLayout>
  )
}