'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { 
  RefreshCw, 
  Wifi, 
  WifiOff, 
  Clock, 
  Users, 
  MessageSquare,
  AlertCircle,
  CheckCircle2
} from 'lucide-react'

interface PlatformSyncStatus {
  platform: string
  connected: boolean
  enabled: boolean
  lastSync?: string
  contacts: number
  messages: number
  recentMessages: number
  errors: string[]
  syncing: boolean
}

interface UnifiedSyncStatus {
  autoSyncEnabled: boolean
  currentlySyncing: boolean
  lastSync?: string
  platforms: PlatformSyncStatus[]
  totalContacts: number
  totalMessages: number
  crossPlatformContacts: number
}

interface ApiPlatformData {
  platform: string
  contactsProcessed?: number
  messagesProcessed?: number
  newMessages?: number
  errors?: string[]
}

export function UnifiedSyncStatus() {
  const [syncStatus, setSyncStatus] = useState<UnifiedSyncStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSyncStatus()
    // Check status occasionally, but don't poll aggressively since we use webhooks
    const interval = setInterval(fetchSyncStatus, 10 * 60 * 1000) // Every 10 minutes
    return () => clearInterval(interval)
  }, [])

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch('/api/sync/auto')
      if (response.ok) {
        const status = await response.json()
        
        // Extract platform data from the sync result
        const platforms: PlatformSyncStatus[] = [
          {
            platform: 'slack',
            connected: true,
            enabled: true,
            lastSync: status.lastSync,
            contacts: status.platforms?.find((p: ApiPlatformData) => p.platform === 'slack')?.contactsProcessed || 0,
            messages: status.platforms?.find((p: ApiPlatformData) => p.platform === 'slack')?.messagesProcessed || 0,
            recentMessages: status.platforms?.find((p: ApiPlatformData) => p.platform === 'slack')?.newMessages || 0,
            errors: status.platforms?.find((p: ApiPlatformData) => p.platform === 'slack')?.errors || [],
            syncing: status.currentlySyncing
          },
          {
            platform: 'gmail',
            connected: true,
            enabled: true,
            lastSync: status.lastSync,
            contacts: status.platforms?.find((p: ApiPlatformData) => p.platform === 'gmail')?.contactsProcessed || 0,
            messages: status.platforms?.find((p: ApiPlatformData) => p.platform === 'gmail')?.messagesProcessed || 0,
            recentMessages: status.platforms?.find((p: ApiPlatformData) => p.platform === 'gmail')?.newMessages || 0,
            errors: status.platforms?.find((p: ApiPlatformData) => p.platform === 'gmail')?.errors || [],
            syncing: status.currentlySyncing
          }
        ]

        setSyncStatus({
          autoSyncEnabled: status.webhooksEnabled || false, // Show webhook status instead
          currentlySyncing: status.currentlySyncing,
          lastSync: status.lastSync,
          platforms,
          totalContacts: status.totalContactsProcessed || platforms.reduce((sum, p) => sum + p.contacts, 0),
          totalMessages: status.totalMessagesProcessed || platforms.reduce((sum, p) => sum + p.messages, 0),
          crossPlatformContacts: status.crossPlatformMatches || 0
        })
      }
    } catch (error) {
      console.error('Failed to fetch sync status:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleAutoSync = async (enabled: boolean) => {
    // In webhook-driven mode, this just shows the status
    // Real sync happens on page load + webhooks
    console.log(`Webhook-driven sync is always enabled. Current status: ${enabled}`)
  }

  const forceSyncNow = async () => {
    try {
      setSyncStatus(prev => prev ? { ...prev, currentlySyncing: true } : null)
      
      const response = await fetch('/api/sync/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'force' })
      })
      
      if (response.ok) {
        await fetchSyncStatus()
      }
    } catch (error) {
      console.error('Failed to force sync:', error)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!syncStatus) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-muted-foreground">
            Failed to load sync status
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {syncStatus.autoSyncEnabled ? (
                  <Wifi className="h-5 w-5 text-green-500" />
                ) : (
                  <WifiOff className="h-5 w-5 text-gray-500" />
                )}
                Unified Message Sync
              </CardTitle>
              <CardDescription>
                Automatically sync messages from all connected platforms
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {syncStatus.currentlySyncing && (
                <Badge variant="secondary" className="gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Syncing
                </Badge>
              )}
              <Switch
                checked={syncStatus.autoSyncEnabled}
                onCheckedChange={toggleAutoSync}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{syncStatus.totalContacts}</div>
              <div className="text-sm text-muted-foreground">Total Contacts</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{syncStatus.totalMessages}</div>
              <div className="text-sm text-muted-foreground">Total Messages</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{syncStatus.crossPlatformContacts}</div>
              <div className="text-sm text-muted-foreground">Cross-Platform</div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              {syncStatus.lastSync ? (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  Last sync: {new Date(syncStatus.lastSync).toLocaleString()}
                </span>
              ) : (
                'Never synced'
              )}
            </div>
            <Button 
              onClick={forceSyncNow}
              disabled={syncStatus.currentlySyncing}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncStatus.currentlySyncing ? 'animate-spin' : ''}`} />
              Sync Now
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Platform-specific status */}
      <div className="grid gap-4">
        {syncStatus.platforms.map(platform => (
          <Card key={platform.platform}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg capitalize flex items-center gap-2">
                  {platform.platform === 'slack' && '💬'}
                  {platform.platform === 'gmail' && '📧'}
                  {platform.platform}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {platform.connected ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Not Connected
                    </Badge>
                  )}
                  {platform.syncing && (
                    <Badge variant="secondary" className="gap-1">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Syncing
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>{platform.contacts} contacts</span>
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <span>{platform.messages} messages</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {platform.recentMessages} new
                  </Badge>
                </div>
              </div>
              
              {platform.errors.length > 0 && (
                <div className="mt-3 p-2 bg-destructive/10 rounded text-sm text-destructive">
                  <div className="flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    {platform.errors.length} error(s)
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
} 