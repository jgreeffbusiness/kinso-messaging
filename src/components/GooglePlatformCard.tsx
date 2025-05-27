'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Mail, RefreshCw, Check, AlertCircle, Clock } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { toast } from 'sonner'

interface GooglePlatformCardProps {
  onConnectionChange?: () => void
}

interface PlatformSpecificStatus {
  connected: boolean;
  needsAction?: boolean;
  message?: string;
  enabledServices?: string[]; 
}

interface ComponentPlatformStatuses {
  google?: PlatformSpecificStatus;
  slack?: PlatformSpecificStatus;
}

export function GooglePlatformCard({ onConnectionChange }: GooglePlatformCardProps) {
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [googleStatus, setGoogleStatus] = useState<PlatformSpecificStatus | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const user = useAuthStore(state => state.user)

  useEffect(() => {
    fetchPlatformConnectionStatuses()
  }, [user])

  const fetchPlatformConnectionStatuses = async () => {
    setConnectionLoading(true)
    try {
      const response = await fetch('/api/user/platform-status')
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch platform statuses')
      }
      const data: ComponentPlatformStatuses = await response.json()
      if (data.google) {
        setGoogleStatus(data.google)
      } else {
        setGoogleStatus({ connected: false, needsAction: true, message: 'Status unavailable.' })
      }
    } catch (error) {
      console.error('Failed to fetch Google platform status:', error)
      toast.error('Could not load Google connection status.')
      setGoogleStatus({ connected: false, needsAction: true, message: 'Error loading status.' })
    }
    setConnectionLoading(false)
  }

  const isEffectivelyConnected = googleStatus?.connected && !googleStatus?.needsAction

  const getDisplayedEnabledServices = () => {
    const integrations = user?.googleIntegrations
    const services = []
    
    if (integrations?.contacts) services.push('Contacts')
    if (integrations?.gmail) services.push('Gmail')
    if (integrations?.calendar) services.push('Calendar')
    
    return services
  }

  const displayedEnabledServices = getDisplayedEnabledServices()

  const handleConnect = () => {
    setConnectionLoading(true)
    window.location.href = '/api/auth/google/connect'
  }

  const handleDisconnect = async () => {
    setConnectionLoading(true)
    try {
      const response = await fetch('/api/auth/google/disconnect', {
        method: 'POST',
      })
      
      if (!response.ok) {
        throw new Error('Failed to disconnect Google')
      }
      
      toast.success('Google disconnected successfully')
      await fetchPlatformConnectionStatuses()
      onConnectionChange?.()
    } catch (error) {
      console.error('Google disconnection error:', error)
      toast.error('Failed to disconnect Google')
    } finally {
      setConnectionLoading(false)
    }
  }

  const handleSync = async () => {
    if (!isEffectivelyConnected) {
      toast.error("Google is not connected. Please connect first.")
      return
    }
    setSyncLoading(true)
    try {
      const response = await fetch('/api/google/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          syncContacts: true,
          syncEmails: true
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setLastSync(new Date())
          toast.success(`Synced ${data.contactsAdded || 0} contacts and ${data.emailsAssociated || 0} emails`)
          await fetchPlatformConnectionStatuses()
        } else {
          toast.error(data.error || 'Failed to sync Google data')
        }
      } else {
        toast.error('Failed to sync Google data: Server error')
      }
    } catch (error) {
      toast.error('Failed to sync Google data: Network error')
    } finally {
      setSyncLoading(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Google Workspace
          </CardTitle>
          <CardDescription>
            Connect your Google account to sync contacts, emails, and calendar.
            {googleStatus?.message && !isEffectivelyConnected && (
              <span className={`block text-xs mt-1 ${googleStatus.needsAction ? 'text-yellow-600' : 'text-muted-foreground' }`}>
                {googleStatus.needsAction && <AlertCircle className="h-3 w-3 mr-1 inline-block"/>} 
                Status: {googleStatus.message}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Connection:</span>
                {isEffectivelyConnected ? (
                  <Badge variant="default" className="bg-green-100 text-green-800">
                    <Check className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Not Connected
                  </Badge>
                )}
              </div>
              {isEffectivelyConnected && displayedEnabledServices.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Enabled for: {displayedEnabledServices.join(', ')}
                </p>
              )}
            </div>
            
            <div>
              {!isEffectivelyConnected ? (
                <Button onClick={handleConnect} disabled={connectionLoading}>
                  {connectionLoading && !syncLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Connect Google
                </Button>
              ) : (
                <Button variant="destructive" onClick={handleDisconnect} disabled={connectionLoading}>
                  {connectionLoading && !syncLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Disconnect
                </Button>
              )}
            </div>
          </div>

          {isEffectivelyConnected && (
            <>
              <hr />
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Sync Data</p>
                  {lastSync && <p className="text-xs text-muted-foreground">Last synced: {new Date(lastSync).toLocaleString()}</p>}
                  {!lastSync && <p className="text-xs text-muted-foreground">Not synced yet.</p>}
                </div>
                <Button onClick={handleSync} disabled={syncLoading || connectionLoading} variant="outline">
                  {syncLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4"/>}
                  Sync Now
                </Button>
              </div>
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <h4 className="text-sm font-medium text-blue-900 mb-2">Enabled Services for Sync:</h4>
                {displayedEnabledServices.length > 0 ? (
                  <ul className="text-sm text-blue-700 space-y-1">
                    {displayedEnabledServices.map(service => <li key={service}>• {service}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-blue-700">No specific services seem to be enabled for integration via your user profile. Connection might be active but specific features (like contacts or gmail sync) may need to be configured or are determined by initial scopes.</p>
                )}
              </div>
            </>
          )}
          
          {!isEffectivelyConnected && (
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-800">
                <strong>What you&apos;ll get:</strong> Access to your Gmail, contacts, 
                and calendar data for comprehensive communication insights (based on granted permissions).
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
} 