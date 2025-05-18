'use client'

import { useState, useEffect } from 'react'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from '@lib/firebase'
import { useAuthStore } from '@store/useAuthStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Checkbox } from '@components/ui/checkbox'
import { Label } from '@components/ui/label'
import { Icons } from '@components/ui/icons'
import { AlertCircle } from 'lucide-react'

interface GoogleIntegrationDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function GoogleIntegrationDialog({ 
  isOpen, 
  onClose 
}: GoogleIntegrationDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [integrations, setIntegrations] = useState({
    contacts: true,
    gmail: true,
    calendar: false
  })
  
  const user = useAuthStore(state => state.user)
  
  // Check if user already has a valid Google token
  const hasValidGoogleToken = () => {
    if (!user?.googleAccessToken) return false
    
    const tokenExpiry = user.googleTokenExpiry 
      ? new Date(user.googleTokenExpiry) 
      : null
    
    return tokenExpiry ? tokenExpiry > new Date() : false
  }
  
  // Handle checkbox changes
  const handleCheckboxChange = (integration: keyof typeof integrations) => {
    setIntegrations({
      ...integrations,
      [integration]: !integrations[integration]
    })
  }
  
  // Get required scopes based on selections
  const getRequiredScopes = () => {
    const scopes = []
    
    if (integrations.contacts) {
      scopes.push('https://www.googleapis.com/auth/contacts.readonly')
    }
    
    if (integrations.gmail) {
      scopes.push('https://www.googleapis.com/auth/gmail.readonly')
    }
    
    if (integrations.calendar) {
      scopes.push('https://www.googleapis.com/auth/calendar.readonly')
    }
    
    return scopes
  }
  
  // Handle integration
  const handleIntegration = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      let token = user?.googleAccessToken
      
      // Only show Google popup if we don't have a valid token
      if (!hasValidGoogleToken()) {
        // Create provider with scopes
        const provider = new GoogleAuthProvider()
        
        // Add required scopes
        getRequiredScopes().forEach(scope => {
          provider.addScope(scope)
        })
        
        // Request token with scopes
        const result = await signInWithPopup(auth, provider)
        const credential = GoogleAuthProvider.credentialFromResult(result)
        token = credential?.accessToken
        
        if (!token) {
          throw new Error("Failed to get Google access token")
        }
      }
      
      // Save selected integrations and token (if new)
      const response = await fetch('/api/auth/save-google-integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token,  // This could be the existing token if already valid
          integrations
        })
      })
      
      if (!response.ok) {
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to save integrations')
        } else {
          throw new Error(`Server error: ${response.status}`)
        }
      }
      
      // Close dialog on success
      onClose()
    } catch (err) {
      console.error('Google integration failed:', err)
      setError(err instanceof Error ? err.message : 'Integration failed')
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="text-left">
          <DialogTitle>
            {hasValidGoogleToken() 
              ? "Sync Google Services" 
              : "Google Account Integration"}
          </DialogTitle>
          <DialogDescription>
            {hasValidGoogleToken()
              ? "Choose which Google services you want to sync with."
              : "Choose which Google services you want to integrate with our app."}
          </DialogDescription>
        </DialogHeader>
        
        {error && (
          <div className="flex items-center gap-2 p-3 text-sm border rounded-md bg-red-50 text-red-800 border-red-200">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        
        <div className="grid gap-4 py-4">
          <div className="flex items-start space-x-2">
            <Checkbox 
              id="contacts" 
              checked={integrations.contacts}
              onCheckedChange={() => handleCheckboxChange('contacts')}
              className="mt-1"
            />
            <Label htmlFor="contacts" className="flex flex-col items-start">
              <span>Google Contacts</span>
              <span className="text-xs text-muted-foreground">Import your contacts from Google</span>
            </Label>
          </div>
          
          <div className="flex items-start space-x-2">
            <Checkbox 
              id="gmail" 
              checked={integrations.gmail}
              onCheckedChange={() => handleCheckboxChange('gmail')}
              className="mt-1"
            />
            <Label htmlFor="gmail" className="flex flex-col items-start">
              <span>Gmail</span>
              <span className="text-xs text-muted-foreground">Access your email history with contacts</span>
            </Label>
          </div>
          
          <div className="flex items-start space-x-2">
            <Checkbox 
              id="calendar" 
              checked={integrations.calendar}
              onCheckedChange={() => handleCheckboxChange('calendar')}
              className="mt-1"
            />
            <Label htmlFor="calendar" className="flex flex-col items-start">
              <span>Google Calendar</span>
              <span className="text-xs text-muted-foreground">Sync calendar events and availability</span>
            </Label>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleIntegration} disabled={isLoading}>
            {isLoading ? (
              <>
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>{hasValidGoogleToken() ? "Sync Now" : "Integrate with Google"}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 