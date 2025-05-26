'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/utils/trpc'
import { GoogleIntegrationDialog } from '@/components/GoogleIntegrationDialog'

interface SmartSyncButtonProps {
  contactId?: string
  variant?: 'default' | 'outline' | 'secondary'
  size?: 'default' | 'sm' | 'lg'
}

export function SmartSyncButton({ 
  contactId, 
  variant = 'default', 
  size = 'sm' 
}: SmartSyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false)
  const [showAuthDialog, setShowAuthDialog] = useState(false)

  const syncContactEmails = trpc.email.syncContactEmails.useMutation()
  const syncAllEmails = trpc.email.syncAllEmails.useMutation()
  const utils = trpc.useUtils()

  const handleSync = async () => {
    setIsSyncing(true)

    try {
      let result
      
      if (contactId) {
        result = await syncContactEmails.mutateAsync({ contactId })
      } else {
        result = await syncAllEmails.mutateAsync()
      }
      
      if (result.success) {
        const count = contactId ? (result as { count: number }).count || 0 : 'all'
        toast.success('Emails synced successfully', {
          description: `Synced ${count} emails`
        })
        
        await utils.invalidate()
      } else {
        // Handle auth-related errors by opening auth dialog
        if (result.error?.includes('authentication') || 
            result.error?.includes('expired') || 
            result.error?.includes('reconnect')) {
          setShowAuthDialog(true)
          return
        } else {
          throw new Error(result.error)
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      // Check if this is an auth error
      if (errorMessage.includes('authentication') || 
          errorMessage.includes('expired') || 
          errorMessage.includes('reconnect')) {
        setShowAuthDialog(true)
        return
      }
      
      toast.error('Failed to sync emails', {
        description: errorMessage
      })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleAuthComplete = () => {
    setShowAuthDialog(false)
    toast.success('Authentication successful! You can now sync emails.')
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
          <RefreshCw className="h-4 w-4" />
        )}
        {isSyncing ? 'Syncing...' : (contactId ? 'Sync Emails' : 'Sync All Emails')}
      </Button>

      {showAuthDialog && (
        <GoogleIntegrationDialog 
          isOpen={showAuthDialog} 
          onClose={handleAuthComplete}
        />
      )}
    </>
  )
} 