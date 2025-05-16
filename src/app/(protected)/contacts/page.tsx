'use client'

import { useState } from 'react'
import { useContacts } from '@/hooks/useContacts'
import { useRightPanel } from '@/providers/RightPanelProvider'
import SyncGoogleContactsButton from '@/components/SyncGoogleContactsButton'
import SharedLayout from '@/components/layout/SharedLayout'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, UserPlus, Loader2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

// Mock data for demo purposes
const mockNotes = [
  {
    id: '1',
    content: 'Roadmap updates\nPrioritized improvements to the insights engine, especially better contact tagging for meetings and follow-ups.',
    category: 'professional' as const,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
  },
  {
    id: '2',
    content: 'Design process insights\nShared insights on the design process, challenges, and outcomes of a recent branding project.',
    category: 'professional' as const,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  },
  {
    id: '3',
    content: 'Birthday is on May 15th',
    category: 'personal' as const,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  }
]

const mockMessages = [
  {
    id: '1',
    content: 'Looking forward to our call tomorrow!',
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
    isOutbound: false
  }
]

export default function ContactsPage() {
  const { contacts, isLoading, error } = useContacts()
  const [searchQuery, setSearchQuery] = useState('')
  const { open, content } = useRightPanel()

  // Filter contacts based on search query
  const filteredContacts = contacts?.filter(contact => 
    contact.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.email && contact.email.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || []

  // Handle contact selection
  const handleContactClick = (contact) => {
    open({
      type: 'contact',
      props: {
        contact,
        notes: mockNotes,
        messages: mockMessages
      },
      title: 'Contact Details'
    })
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

  // Check if a contact is currently being viewed
  const isContactSelected = (contactId) => {
    return content?.type === 'contact' && content?.props?.contact?.id === contactId
  }

  return (
    <SharedLayout showContactPanel={!!content?.props?.contact} contactData={content?.props}>
      <div className="space-y-6">
        {/* Header with actions inline */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Your Contacts</h1>
          
          {/* Actions aligned with heading */}
          <div className="flex items-center gap-2">
            <SyncGoogleContactsButton />
            <Button className="h-10">
              <UserPlus className="h-4 w-4 mr-2" />
              Add Contact
            </Button>
          </div>
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
                className={`flex items-center p-3 rounded-md hover:bg-accent cursor-pointer ${
                  isContactSelected(contact.id) ? 'bg-accent' : ''
                }`}
                onClick={() => handleContactClick(contact)}
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