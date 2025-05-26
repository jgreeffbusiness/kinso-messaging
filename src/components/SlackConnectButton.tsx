'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, MessageSquare, Check, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface SlackConnectButtonProps {
  isConnected?: boolean
  slackTeamName?: string
  onConnectionChange?: () => void
}

export function SlackConnectButton({ 
  isConnected = false, 
  slackTeamName,
  onConnectionChange 
}: SlackConnectButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleConnect = async () => {
    try {
      setLoading(true)
      
      // Redirect to our Slack OAuth endpoint
      window.location.href = '/api/auth/slack'
    } catch (error) {
      console.error('Slack connection error:', error)
      toast.error('Failed to initiate Slack connection')
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      setLoading(true)
      
      // Call API to disconnect Slack
      const response = await fetch('/api/auth/slack/disconnect', {
        method: 'POST',
      })
      
      if (!response.ok) {
        throw new Error('Failed to disconnect Slack')
      }
      
      toast.success('Slack disconnected successfully')
      onConnectionChange?.()
    } catch (error) {
      console.error('Slack disconnection error:', error)
      toast.error('Failed to disconnect Slack')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-purple-600" />
          Slack Integration
        </CardTitle>
        <CardDescription>
          Connect your Slack workspace to sync direct messages and conversations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Status:</span>
              {isConnected ? (
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
            {isConnected && slackTeamName && (
              <p className="text-sm text-muted-foreground">
                Connected to: <span className="font-medium">{slackTeamName}</span>
              </p>
            )}
          </div>
          
          {isConnected ? (
            <Button 
              variant="outline" 
              onClick={handleDisconnect}
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Disconnect
            </Button>
          ) : (
            <Button 
              onClick={handleConnect}
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Connect Slack
            </Button>
          )}
        </div>
        
        {isConnected && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Features Available:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Sync direct messages from your workspace</li>
              <li>• AI-powered message insights and summaries</li>
              <li>• Unified reply system (coming soon)</li>
              <li>• Cross-platform contact matching</li>
            </ul>
          </div>
        )}
        
        {!isConnected && (
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