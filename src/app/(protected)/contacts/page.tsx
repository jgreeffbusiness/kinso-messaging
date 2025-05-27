'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useContacts } from '@hooks/useContacts'
import { SimplePlatformSyncModal } from '@components/SimplePlatformSyncModal'
import SharedLayout from '@components/layout/SharedLayout'
import { Avatar, AvatarFallback, AvatarImage } from '@components/ui/avatar'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Search, UserPlus, Loader2, RefreshCw } from 'lucide-react'
import { Separator } from '@components/ui/separator'

// Define a more specific type for contacts coming from useContacts if possible
// For now, a basic structure to satisfy linter for filtering
interface PageContact {
  id: string
  fullName?: string | null
  email?: string | null
  photoUrl?: string | null
}

export default function ContactsPage() {
  const router = useRouter()
  // Correctly type the hook's return value based on linter error
  const { contacts, isLoading, error, refreshContacts } = useContacts() as {
    contacts: PageContact[] | undefined;
    isLoading: boolean;
    error: Error | null;
    refreshContacts: () => void; // Corrected from refetchContacts based on linter error
  };
  const [searchQuery, setSearchQuery] = useState('')
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  
  // Ensure contacts is an array before filtering
  const typedContacts = contacts || []
  const filteredContacts = typedContacts.filter(contact => 
    contact.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.email && contact.email.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  // Navigate to contact detail page
  const handleContactClick = (contactId: string) => {
    router.push(`/contacts/${contactId}`)
  }

  // Get initials for avatar fallback
  const getInitials = (name?: string | null): string => {
    if (!name) return '?'
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  const handleOpenSyncModal = () => {
    setIsSyncModalOpen(true)
  }

  return (
    <SharedLayout>
      <div className="space-y-6">
        {/* Header with actions inline */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Your Contacts</h1>
          
          {/* Actions aligned with heading */}
          <div className="flex items-center gap-2">
            {/* New Generic Sync Contacts Button */}
            <Button onClick={handleOpenSyncModal} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Sync Contacts
            </Button>
            <Button className="gap-2" onClick={() => router.push('/contacts/new')} >
              <UserPlus className="h-4 w-4" />
              Add Contact
            </Button>
          </div>
        </div>
        
        {/* Search input */}
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
              
        <Separator />
        
        {/* Contacts List */}
        <div className="space-y-1 mt-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              Error loading contacts: {error?.message || 'Unknown error'}
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No contacts match your search' : 'No contacts yet. Try syncing!'}
            </div>
          ) : (
            filteredContacts.map(contact => (
              <div
                key={contact.id}
                className="flex items-center p-3 rounded-md hover:bg-accent cursor-pointer"
                onClick={() => handleContactClick(contact.id)}
              >
                <Avatar className="h-10 w-10 mr-4">
                  <AvatarImage src={contact.photoUrl || undefined} />
                  <AvatarFallback>{getInitials(contact.fullName)}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium">{contact.fullName}</div>
                  {contact.email && (
                    <div className="text-sm text-muted-foreground">{contact.email}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <SimplePlatformSyncModal 
        isOpen={isSyncModalOpen} 
        onClose={() => setIsSyncModalOpen(false)} 
        onSyncSuccess={() => {
          refreshContacts()
        }}
      />
    </SharedLayout>
  )
}