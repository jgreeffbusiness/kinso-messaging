'use client'

import { useState } from 'react'
import { Button } from '@components/ui/button'
import { Mail, Loader2 } from 'lucide-react'
import { trpc } from '@utils/trpc'
import { toast } from 'sonner'
import { useAuthStore } from '@store/useAuthStore'
import { GoogleIntegrationDialog } from '@components/GoogleIntegrationDialog'

type SyncEmailsButtonProps = {
  contactId?: string // Optional - if provided, sync just this contact
  variant?: 'default' | 'outline' | 'secondary'
  size?: 'default' | 'sm' | 'lg'
}

export default function SyncEmailsButton({ 
  contactId, 
  variant = 'default', 
  size = 'sm' 
}: SyncEmailsButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false)
  const user = useAuthStore(state => state.user)
  const [showAuthDialog, setShowAuthDialog] = useState(false)

  const syncContactEmails = trpc.email.syncContactEmails.useMutation()
  const syncAllEmails = trpc.email.syncAllEmails.useMutation()
  const utils = trpc.useUtils()
  
  // Check if user has valid Google auth
  const hasValidGoogleAuth = user?.googleAccessToken && user?.googleRefreshToken
  
  const handleSync = async () => {
    // If no valid auth, show Google integration dialog
    if (!hasValidGoogleAuth) {
      toast.info('Google authentication required')
      setShowAuthDialog(true)
      return
    }
    
    setIsSyncing(true)
    
    try {
      let result
      
      if (contactId) {
        result = await syncContactEmails.mutateAsync({ contactId })
      } else {
        result = await syncAllEmails.mutateAsync()
      }
      
      if (result.success) {
        const count = contactId ? result.count : 'all'
        toast.success('Emails synced successfully', {
          description: `Synced ${count} emails`
        })
        
        // Invalidate messages query to refresh UI
        await utils.invalidate()
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      toast.error('Failed to sync emails', {
        description: error.message
      })
    } finally {
      setIsSyncing(false)
    }
  }
  
  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={handleSync}
        disabled={isSyncing}
        className="gap-2"
      >
        {isSyncing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mail className="h-4 w-4" />
        )}
        {hasValidGoogleAuth 
          ? (contactId ? 'Sync Emails' : 'Sync All Emails')
          : 'Connect Google'}
      </Button>
      {showAuthDialog && <GoogleIntegrationDialog isOpen={showAuthDialog} onClose={() => setShowAuthDialog(false)} />}
    </>
  )
} 