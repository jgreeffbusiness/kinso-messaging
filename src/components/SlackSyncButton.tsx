'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, MessageSquare, RefreshCw, Check, AlertCircle, Clock } from 'lucide-react'
import { toast } from 'sonner'

interface SlackSyncButtonProps {
  contactId?: string
  contactName?: string
}

interface SlackStatus {
  isConnected: boolean
  isEnabled: boolean
  teamName?: string
  recentMessagesCount: number
}

export function SlackSyncButton({ contactId, contactName }: SlackSyncButtonProps) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<SlackStatus | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  useEffect(() => {
    fetchSlackStatus()
  }, [])

  const fetchSlackStatus = async () => {
    try {
      const response = await fetch('/api/slack/sync')
      if (response.ok) {
        const data = await response.json()
        setStatus(data)
      }
    } catch (error) {
      console.error('Failed to fetch Slack status:', error)
    }
  }

  const syncSlackMessages = async () => {
    try {
      setLoading(true)
      
      const response = await fetch('/api/slack/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setLastSync(new Date())
        if (contactName) {
          toast.success(`Synced ${data.newMessages} new Slack messages for ${contactName}`)
        } else {
          toast.success(`Synced ${data.newMessages} new Slack messages (${data.messagesProcessed} total processed)`)
        }
        
        if (data.errors && data.errors.length > 0) {
          console.warn('Sync completed with warnings:', data.errors)
        }
        
        // Refresh status
        await fetchSlackStatus()
      } else {
        toast.error(data.error || 'Failed to sync Slack messages')
        if (data.errors) {
          console.error('Sync errors:', data.errors)
        }
      }
    } catch (error) {
      console.error('Slack sync error:', error)
      toast.error('Failed to sync Slack messages')
    } finally {
      setLoading(false)
    }
  }

  if (!status) {
    return (
      <Card className="animate-pulse">
        <CardContent className="p-6">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </CardContent>
      </Card>
    )
  }

  if (!status.isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Slack Not Connected</h3>
          <p className="text-gray-600 mb-4">
            Connect your Slack workspace to sync direct messages and conversations.
          </p>
          <Button onClick={() => window.location.href = '/onboarding'}>
            Connect Slack
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-purple-600" />
              Slack Messages
              {contactName && ` - ${contactName}`}
            </CardTitle>
            <CardDescription>
              {status.teamName && `Connected to ${status.teamName} workspace`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default" className="bg-green-100 text-green-800">
              <Check className="h-3 w-3 mr-1" />
              Connected
            </Badge>
            {status.isEnabled && (
              <Badge variant="secondary">
                {status.recentMessagesCount} recent
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {status.isEnabled ? (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Sync Status</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    <MessageSquare className="h-3 w-3 mr-1" />
                    {status.recentMessagesCount} messages (last 7 days)
                  </Badge>
                  {lastSync && (
                    <Badge variant="outline" className="text-xs">
                      <Clock className="h-3 w-3 mr-1" />
                      Last sync: {lastSync.toLocaleTimeString()}
                    </Badge>
                  )}
                </div>
              </div>
              
              <Button 
                onClick={syncSlackMessages}
                disabled={loading}
                className="flex items-center gap-2"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {loading ? 'Syncing...' : 'Sync Now'}
              </Button>
            </div>

            <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
              <h4 className="text-sm font-medium text-purple-900 mb-2">What gets synced:</h4>
              <ul className="text-sm text-purple-700 space-y-1">
                <li>• Direct messages from your workspace</li>
                <li>• Message content and timestamps</li>
                <li>• User information for contact matching</li>
                <li>• Thread context for AI analysis</li>
              </ul>
            </div>
          </>
        ) : (
          <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <h4 className="text-sm font-medium text-yellow-900">Integration Disabled</h4>
            </div>
            <p className="text-sm text-yellow-700 mb-3">
              Slack is connected but integration is disabled. Reconnect to enable message syncing.
            </p>
            <Button 
              size="sm" 
              onClick={() => window.location.href = '/api/auth/slack'}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              Reconnect Slack
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
} 