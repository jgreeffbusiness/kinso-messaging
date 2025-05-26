'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, MessageSquare, RefreshCw, Check, AlertCircle, Clock } from 'lucide-react'
import { toast } from 'sonner'

interface SlackPlatformCardProps {
  onConnectionChange?: () => void
}

interface SlackStatus {
  isConnected: boolean
  isEnabled: boolean
  teamName?: string
  recentMessagesCount: number
}

export function SlackPlatformCard({ onConnectionChange }: SlackPlatformCardProps) {
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
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

  const handleConnect = async () => {
    try {
      setConnectionLoading(true)
      window.location.href = '/api/auth/slack'
    } catch (error) {
      console.error('Slack connection error:', error)
      toast.error('Failed to initiate Slack connection')
      setConnectionLoading(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      setConnectionLoading(true)
      
      const response = await fetch('/api/auth/slack/disconnect', {
        method: 'POST',
      })
      
      if (!response.ok) {
        throw new Error('Failed to disconnect Slack')
      }
      
      toast.success('Slack disconnected successfully')
      onConnectionChange?.()
      await fetchSlackStatus()
    } catch (error) {
      console.error('Slack disconnection error:', error)
      toast.error('Failed to disconnect Slack')
    } finally {
      setConnectionLoading(false)
    }
  }

  const handleSync = async () => {
    try {
      setSyncLoading(true)
      
      const response = await fetch('/api/slack/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      
      const data = await response.json()
      
      if (data.success) {
        setLastSync(new Date())
        toast.success(`Synced ${data.newMessages} new Slack messages (${data.messagesProcessed} total processed)`)
        
        if (data.errors && data.errors.length > 0) {
          console.warn('Sync completed with warnings:', data.errors)
        }
        
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
      setSyncLoading(false)
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-purple-600" />
          Slack Workspace
        </CardTitle>
        <CardDescription>
          Connect your Slack workspace to sync direct messages and conversations
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Connection Status */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Status:</span>
              {status.isConnected ? (
                <Badge variant="default" className="bg-green-100 text-green-800">
                  <Check className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Not Connected
                </Badge>
              )}
            </div>
            {status.isConnected && status.teamName && (
              <p className="text-sm text-muted-foreground">
                Connected to: <span className="font-medium">{status.teamName}</span>
              </p>
            )}
          </div>
          
          {status.isConnected ? (
            <Button 
              variant="outline" 
              onClick={handleDisconnect}
              disabled={connectionLoading}
              size="sm"
            >
              {connectionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Disconnect
            </Button>
          ) : (
            <Button 
              onClick={handleConnect}
              disabled={connectionLoading}
              className="bg-purple-600 hover:bg-purple-700"
              size="sm"
            >
              {connectionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Connect Slack
            </Button>
          )}
        </div>

        {/* Sync Section - Only show when connected */}
        {status.isConnected && status.isEnabled && (
          <>
            <hr className="border-gray-200" />
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Message Sync</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      <MessageSquare className="h-3 w-3 mr-1" />
                      {status.recentMessagesCount} messages (last 7 days)
                    </Badge>
                    {lastSync && (
                      <Badge variant="outline" className="text-xs">
                        <Clock className="h-3 w-3 mr-1" />
                        {lastSync.toLocaleTimeString()}
                      </Badge>
                    )}
                  </div>
                </div>
                
                <Button 
                  onClick={handleSync}
                  disabled={syncLoading}
                  size="sm"
                  className="flex items-center gap-2"
                >
                  {syncLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {syncLoading ? 'Syncing...' : 'Sync Now'}
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
            </div>
          </>
        )}

        {/* Features Available - Show when connected */}
        {status.isConnected && (
          <>
            <hr className="border-gray-200" />
            
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Features Available:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Sync direct messages from your workspace</li>
                <li>• AI-powered message insights and summaries</li>
                <li>• Unified reply system (coming soon)</li>
                <li>• Cross-platform contact matching</li>
              </ul>
            </div>
          </>
        )}

        {/* Integration Disabled Warning */}
        {status.isConnected && !status.isEnabled && (
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
        
        {/* What you'll get - Show when not connected */}
        {!status.isConnected && (
          <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
            <p className="text-sm text-purple-800">
              <strong>What you&apos;ll get:</strong> Access to your direct messages, 
              contact synchronization, and AI-powered insights across platforms.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
} 