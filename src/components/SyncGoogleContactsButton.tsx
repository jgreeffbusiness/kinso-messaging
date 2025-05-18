'use client'

import { useState } from 'react'
import { Button } from '@components/ui/button'
import { useGoogleContacts } from '@hooks/useGoogleContacts'
import { GoogleIntegrationDialog } from '@components/GoogleIntegrationDialog'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { ContactImportModal } from '@components/ContactImportModal'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@components/ui/alert-dialog'
import { useContacts } from '@hooks/useContacts'

export default function SyncGoogleContactsButton() {
  const [isSyncing, setIsSyncing] = useState(false)
  const [showIntegrationDialog, setShowIntegrationDialog] = useState(false)
  const [showContactImportModal, setShowContactImportModal] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  
  const googleContacts = useGoogleContacts()
  const { refreshContacts } = useContacts()
  
  // Handle the sync button click
  function handleSync() {
    // If already authorized, just open the contact import modal
    if (googleContacts.hasContactsAuthorization()) {
      setShowContactImportModal(true)
    } else {
      // Otherwise show the authorization dialog
      setShowIntegrationDialog(true)
    }
  }
  
  // Close the modal after authorization
  const handleAuthClose = (success = false) => {
    setShowIntegrationDialog(false)
    
    // If authorization was successful, open contact import modal
    if (success) {
      setTimeout(() => {
        setShowContactImportModal(true)
      }, 100) // Small delay to ensure UI updates correctly
    }
  }
  
  // Handle refresh after import
  const handleContactsImported = () => {
    refreshContacts()
  }
  
  return (
    <>
      <Button
        onClick={handleSync}
        disabled={isSyncing}
        variant="outline"
        className="gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        Sync with Google
      </Button>
      
      {/* Integration Dialog */}
      <GoogleIntegrationDialog 
        isOpen={showIntegrationDialog}
        onClose={(success) => handleAuthClose(success)}
      />
      
      {/* Contact Import Modal */}
      <ContactImportModal
        isOpen={showContactImportModal}
        onClose={() => setShowContactImportModal(false)}
        onContactsImported={handleContactsImported}
      />
      
      {/* Error Dialog */}
      <AlertDialog open={!!syncError} onOpenChange={() => setSyncError(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              Sync Error
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              {syncError}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}