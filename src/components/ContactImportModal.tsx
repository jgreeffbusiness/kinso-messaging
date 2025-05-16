'use client'

import { useState, useEffect } from 'react'
import { useGoogleContacts } from '@/hooks/useGoogleContacts'
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Icons } from '@/components/ui/icons'
import { GoogleIntegrationDialog } from '@/components/GoogleIntegrationDialog'
import { Check, Search, RefreshCw } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import Image from 'next/image'

type Contact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  photoUrl?: string;
};

interface ContactImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContactsImported?: () => void;
}

export function ContactImportModal({ 
  isOpen, 
  onClose,
  onContactsImported
}: ContactImportModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [showIntegrationDialog, setShowIntegrationDialog] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  
  const { hasContactsAuthorization, fetchContacts } = useGoogleContacts()
  
  // Filter contacts based on search query
  const filteredContacts = contacts.filter(contact => 
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    contact.email?.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  // Handle contact selection
  const toggleContactSelection = (contactId: string) => {
    const newSelected = new Set(selectedContacts)
    if (newSelected.has(contactId)) {
      newSelected.delete(contactId)
    } else {
      newSelected.add(contactId)
    }
    setSelectedContacts(newSelected)
  }
  
  // Handle select all
  const handleSelectAll = () => {
    if (selectedContacts.size === filteredContacts.length) {
      // Deselect all if all are selected
      setSelectedContacts(new Set())
    } else {
      // Select all filtered contacts
      setSelectedContacts(new Set(filteredContacts.map(c => c.id)))
    }
  }
  
  // Load contacts from Google
  const loadContacts = async () => {
    if (!hasContactsAuthorization()) {
      setShowIntegrationDialog(true)
      return
    }
    
    setIsLoading(true)
    
    try {
      const googleContacts = await fetchContacts()
      
      // Format the contacts
      const formattedContacts = googleContacts.map((contact: any) => ({
        id: contact.id,
        name: contact.name || 'Unnamed Contact',
        email: contact.email,
        phone: contact.phone,
        photoUrl: contact.photoUrl
      }))
      
      setContacts(formattedContacts)
      
      // Pre-select all contacts
      setSelectedContacts(new Set(formattedContacts.map(c => c.id)))
      
      toast.success("Contacts fetched", {
        description: `${formattedContacts.length} contacts found. Select which ones to import.`
      })
      
    } catch (error) {
      console.error('Failed to fetch contacts:', error)
      
      toast.error("Failed to fetch contacts", {
        description: error instanceof Error ? error.message : 'Something went wrong'
      })
    } finally {
      setIsLoading(false)
    }
  }
  
  // Handle the actual import of selected contacts
  const handleImportSelected = async () => {
    if (selectedContacts.size === 0) {
      toast.error("No contacts selected", {
        description: "Please select at least one contact to import."
      })
      return
    }
    
    setIsLoading(true)
    
    try {
      // Create an array of the selected contacts
      const contactsToImport = filteredContacts.filter(contact => 
        selectedContacts.has(contact.id)
      );
      
      // Send to your API endpoint
      const response = await fetch('/api/google/import-contacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contacts: contactsToImport })
      });
      
      // Error handling
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to import contacts')
      }
      
      const result = await response.json();
      
      // Show success message
      toast.success(`Successfully imported ${result.imported} contacts`);
      
      // Call the callback to refresh contacts
      if (onContactsImported) {
        onContactsImported();
      }
      
      // Reset the state
      setSearchQuery('')
      setSelectedContacts(new Set())
      onClose()
      
    } catch (error) {
      console.error('Import failed:', error)
      
      toast.error("Import failed", {
        description: error instanceof Error ? error.message : 'Something went wrong'
      })
    } finally {
      setIsLoading(false)
    }
  }
  
  // Connect button handler
  const handleConnect = () => {
    setShowIntegrationDialog(true)
  }
  
  // Handle integration dialog close
  const handleIntegrationClose = () => {
    setShowIntegrationDialog(false)
    // If authorization successful, load contacts
    if (hasContactsAuthorization()) {
      loadContacts()
    }
  }
  
  // Load contacts when the modal opens
  useEffect(() => {
    if (isOpen && hasContactsAuthorization()) {
      loadContacts()
    }
  }, [isOpen]) 
  
  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[500px] max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Import Contacts</DialogTitle>
          </DialogHeader>
          
          {!hasContactsAuthorization() || contacts.length === 0 ? (
            <div className="p-6 text-center">
              <p className="mb-4">{isLoading ? 'Loading contacts...' : 'Connect your Google account to import contacts'}</p>
              <Button onClick={handleConnect} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Connect Google Account
                  </>
                )}
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground">
                    {filteredContacts.length} contacts found
                  </p>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleSelectAll}
                    className="text-xs"
                  >
                    {selectedContacts.size === filteredContacts.length 
                      ? "Deselect All" 
                      : "Select All"}
                  </Button>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search contacts..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              
              <ScrollArea className="h-[350px] pr-4">
                {filteredContacts.length === 0 ? (
                  <div className="flex h-full items-center justify-center py-8 text-center text-muted-foreground">
                    No contacts match your search
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredContacts.map((contact) => (
                      <div 
                        key={contact.id} 
                        className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/5"
                      >
                        <Checkbox 
                          id={contact.id}
                          checked={selectedContacts.has(contact.id)}
                          onCheckedChange={() => toggleContactSelection(contact.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="font-medium">{contact.name}</div>
                          {contact.email && (
                            <div className="text-sm text-muted-foreground">{contact.email}</div>
                          )}
                          {contact.phone && (
                            <div className="text-sm text-muted-foreground">{contact.phone}</div>
                          )}
                        </div>
                        <div className="h-10 w-10 rounded-full overflow-hidden bg-muted relative">
                          <Image 
                            src={contact.photoUrl || '/images/default-avatar.png'}
                            alt=""
                            fill
                            className="object-cover"
                            sizes="40px"
                            onError={(e) => {
                              // @ts-ignore - src is valid but TypeScript doesn't recognize this pattern
                              e.currentTarget.src = '/images/default-avatar.png';
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
              
              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={onClose} disabled={isLoading}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleImportSelected} 
                  disabled={selectedContacts.size === 0 || isLoading}
                >
                  {isLoading ? (
                    <>
                      <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Import {selectedContacts.size} Contacts
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Google Integration Dialog */}
      <GoogleIntegrationDialog 
        isOpen={showIntegrationDialog}
        onClose={handleIntegrationClose}
      />
    </>
  )
} 