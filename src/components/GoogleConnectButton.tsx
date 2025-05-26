'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Mail, Check, AlertCircle } from 'lucide-react'
import { GoogleIntegrationDialog } from '@/components/GoogleIntegrationDialog'
import { useAuthStore } from '@/store/useAuthStore'
import { toast } from 'sonner'

interface GoogleConnectButtonProps {
  onConnectionChange?: () => void
}

export function GoogleConnectButton({ onConnectionChange }: GoogleConnectButtonProps) {
  const [loading, setLoading] = useState(false)
  const [showIntegrationDialog, setShowIntegrationDialog] = useState(false)
  const user = useAuthStore(state => state.user)

  // Check if Google is connected and enabled
  const isConnected = () => {
    if (!user?.googleAccessToken) return false
    
    // Check if token is expired
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
      setLoading(true)
      
      // Call API to disconnect Google
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
      setLoading(false)
    }
  }

  const handleIntegrationChange = () => {
    setShowIntegrationDialog(false)
    onConnectionChange?.()
  }

  const connected = isConnected()
  const enabledServices = getEnabledServices()

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Google Integration
          </CardTitle>
          <CardDescription>
            Connect your Google account to sync contacts, emails, and calendar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Disconnect
              </Button>
            ) : (
              <Button 
                onClick={handleConnect}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Connect Google
              </Button>
            )}
          </div>
          
          {connected && (
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
          )}
          
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