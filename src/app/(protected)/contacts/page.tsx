'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useContacts } from '@hooks/useContacts'
import SyncGoogleContactsButton from '@components/SyncGoogleContactsButton'
import SharedLayout from '@components/layout/SharedLayout'
import { Avatar, AvatarFallback, AvatarImage } from '@components/ui/avatar'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Search, UserPlus, Loader2 } from 'lucide-react'
import { Separator } from '@components/ui/separator'

export default function ContactsPage() {
  const router = useRouter()
  const { contacts, isLoading, error } = useContacts()
  const [searchQuery, setSearchQuery] = useState('')

  // Filter contacts based on search query
  const filteredContacts = contacts?.filter(contact => 
    contact.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.email && contact.email.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  // Navigate to contact detail page
  const handleContactClick = (contactId) => {
    router.push(`/contacts/${contactId}`)
  }

  // Get initials for avatar fallback
  const getInitials = (name) => {
    if (!name) return '?'
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  return (
    <SharedLayout>
      <div className="space-y-6">
        {/* Header with actions inline */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Your Contacts</h1>
          
          {/* Actions aligned with heading */}
          <div className="flex items-center gap-2">
            <SyncGoogleContactsButton />
            <Button className="gap-2">
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
              Error loading contacts: {error}
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No contacts match your search' : 'No contacts yet'}
            </div>
          ) : (
            filteredContacts.map(contact => (
              <div
                key={contact.id}
                className="flex items-center p-3 rounded-md hover:bg-accent cursor-pointer"
                onClick={() => handleContactClick(contact.id)}
              >
                <Avatar className="h-10 w-10 mr-4">
                  <AvatarImage src={contact.photoUrl} />
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
    </SharedLayout>
  )
}