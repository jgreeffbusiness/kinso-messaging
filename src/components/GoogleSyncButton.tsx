'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Mail, RefreshCw, Check, Clock } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { toast } from 'sonner'

interface GoogleSyncButtonProps {
  contactId?: string
  contactName?: string
}

interface GoogleStatus {
  isConnected: boolean
  enabledServices: string[]
  recentMessagesCount: number
  contactsCount: number
}

export function GoogleSyncButton({ contactId, contactName }: GoogleSyncButtonProps) {
  const [loading, setLoading] = useState(false)
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

  const syncGoogleData = async () => {
    try {
      setLoading(true)
      
      const response = await fetch('/api/google/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contactId,
          syncContacts: true,
          syncEmails: true
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setLastSync(new Date())
        if (contactName) {
          toast.success(`Synced Google data for ${contactName}`)
        } else {
          toast.success(`Synced ${data.contactsAdded || 0} contacts and ${data.emailsAssociated || 0} emails`)
        }
        
        // Refresh status
        await fetchGoogleStatus()
      } else {
        toast.error(data.error || 'Failed to sync Google data')
      }
    } catch (error) {
      console.error('Google sync error:', error)
      toast.error('Failed to sync Google data')
    } finally {
      setLoading(false)
    }
  }

  const isConnected = () => {
    if (!user?.googleAccessToken) return false
    
    const tokenExpiry = user.googleTokenExpiry 
      ? new Date(user.googleTokenExpiry) 
      : null
    
    if (tokenExpiry && tokenExpiry < new Date()) return false
    
    return true
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

  if (!isConnected()) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Google Not Connected</h3>
          <p className="text-gray-600 mb-4">
            Connect your Google account to sync contacts and emails.
          </p>
          <Button onClick={() => window.location.href = '/settings'}>
            Connect Google
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
              <Mail className="h-5 w-5 text-blue-600" />
              Google Data
              {contactName && ` - ${contactName}`}
            </CardTitle>
            <CardDescription>
              Sync contacts, emails, and calendar data
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default" className="bg-green-100 text-green-800">
              <Check className="h-3 w-3 mr-1" />
              Connected
            </Badge>
            <Badge variant="secondary">
              {status.enabledServices.length} services
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Sync Status</p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                <Mail className="h-3 w-3 mr-1" />
                {status.recentMessagesCount} messages
              </Badge>
              <Badge variant="outline" className="text-xs">
                <Mail className="h-3 w-3 mr-1" />
                {status.contactsCount} contacts
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
            onClick={syncGoogleData}
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

        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
          <h4 className="text-sm font-medium text-blue-900 mb-2">What gets synced:</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            {status.enabledServices.includes('Contacts') && (
              <li>• Google Contacts and profile information</li>
            )}
            {status.enabledServices.includes('Gmail') && (
              <li>• Gmail conversations and message history</li>
            )}
            {status.enabledServices.includes('Calendar') && (
              <li>• Calendar events and availability</li>
            )}
            <li>• Contact matching and AI analysis</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
} 