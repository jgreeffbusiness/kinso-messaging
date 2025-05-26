'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Mail, RefreshCw, Check, AlertCircle, Clock } from 'lucide-react'
import { GoogleIntegrationDialog } from '@/components/GoogleIntegrationDialog'
import { useAuthStore } from '@/store/useAuthStore'
import { toast } from 'sonner'

interface GooglePlatformCardProps {
  onConnectionChange?: () => void
}

interface GoogleStatus {
  isConnected: boolean
  enabledServices: string[]
  recentMessagesCount: number
  contactsCount: number
}

export function GooglePlatformCard({ onConnectionChange }: GooglePlatformCardProps) {
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [showIntegrationDialog, setShowIntegrationDialog] = useState(false)
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const user = useAuthStore(state => state.user)

  useEffect(() => {
    fetchGoogleStatus()
  }, [user])

  const fetchGoogleStatus = async () => {
    try {
      const response = await fetch('/api/google/status')
      if (response.ok) {
        const data = await response.json()
        setStatus(data)
      }
    } catch (error) {
      console.error('Failed to fetch Google status:', error)
    }
  }

  // Check if Google is connected and enabled
  const isConnected = () => {
    if (!user?.googleAccessToken) return false
    
    const tokenExpiry = user.googleTokenExpiry 
      ? new Date(user.googleTokenExpiry) 
      : null
    
    if (tokenExpiry && tokenExpiry < new Date()) return false
    
    return true
  }

  const getEnabledServices = () => {
    const integrations = user?.googleIntegrations
    const services = []
    
    if (integrations?.contacts) services.push('Contacts')
    if (integrations?.gmail) services.push('Gmail')
    if (integrations?.calendar) services.push('Calendar')
    
    return services
  }

  const handleConnect = () => {
    setShowIntegrationDialog(true)
  }

  const handleDisconnect = async () => {
    try {
      setConnectionLoading(true)
      
      const response = await fetch('/api/auth/google/disconnect', {
        method: 'POST',
      })
      
      if (!response.ok) {
        throw new Error('Failed to disconnect Google')
      }
      
      toast.success('Google disconnected successfully')
      onConnectionChange?.()
    } catch (error) {
      console.error('Google disconnection error:', error)
      toast.error('Failed to disconnect Google')
    } finally {
      setConnectionLoading(false)
    }
  }

  const handleSync = async () => {
    try {
      setSyncLoading(true)
      
      const response = await fetch('/api/google/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          syncContacts: true,
          syncEmails: true
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setLastSync(new Date())
        toast.success(`Synced ${data.contactsAdded || 0} contacts and ${data.emailsAssociated || 0} emails`)
        await fetchGoogleStatus()
      } else {
        toast.error(data.error || 'Failed to sync Google data')
      }
    } catch (error) {
      console.error('Google sync error:', error)
      toast.error('Failed to sync Google data')
    } finally {
      setSyncLoading(false)
    }
  }

  const handleIntegrationChange = () => {
    setShowIntegrationDialog(false)
    onConnectionChange?.()
    fetchGoogleStatus()
  }

  const connected = isConnected()
  const enabledServices = getEnabledServices()

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Google Workspace
          </CardTitle>
          <CardDescription>
            Connect your Google account to sync contacts, emails, and calendar
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Connection Status */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Status:</span>
                {connected ? (
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
              {connected && enabledServices.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Enabled: {enabledServices.join(', ')}
                </p>
              )}
            </div>
            
            {connected ? (
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
                className="bg-blue-600 hover:bg-blue-700"
                size="sm"
              >
                {connectionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Connect Google
              </Button>
            )}
          </div>

          {/* Sync Section - Only show when connected */}
          {connected && status && (
            <>
              <hr className="border-gray-200" />
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Data Sync</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {status.recentMessagesCount} messages
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {status.contactsCount} contacts
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

                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">What gets synced:</h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    {enabledServices.includes('Contacts') && (
                      <li>• Google Contacts and profile information</li>
                    )}
                    {enabledServices.includes('Gmail') && (
                      <li>• Gmail conversations and message history</li>
                    )}
                    {enabledServices.includes('Calendar') && (
                      <li>• Calendar events and availability</li>
                    )}
                    <li>• Contact matching and AI analysis</li>
                  </ul>
                </div>
              </div>
            </>
          )}

          {/* Features Available - Show when connected */}
          {connected && (
            <>
              <hr className="border-gray-200" />
              
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Features Available:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {enabledServices.includes('Contacts') && (
                    <li>• Import and sync Google Contacts</li>
                  )}
                  {enabledServices.includes('Gmail') && (
                    <li>• Access Gmail conversations and history</li>
                  )}
                  {enabledServices.includes('Calendar') && (
                    <li>• Sync calendar events and availability</li>
                  )}
                  <li>• AI-powered message insights and summaries</li>
                  <li>• Cross-platform contact matching</li>
                </ul>
              </div>
            </>
          )}
          
          {/* What you'll get - Show when not connected */}
          {!connected && (
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-800">
                <strong>What you&apos;ll get:</strong> Access to your Gmail, contacts, 
                and calendar data for comprehensive communication insights.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <GoogleIntegrationDialog 
        isOpen={showIntegrationDialog}
        onClose={handleIntegrationChange}
      />
    </>
  )
} 