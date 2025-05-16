'use client'

import { trpc } from '@/utils/trpc'
import ContactListItem from './ContactListItem'

export default function ContactList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data: contacts, isLoading, isError } = trpc.contact.getAll.useQuery()

  if (isLoading) return <p className="text-sm text-gray-500">Loading contacts...</p>
  if (isError || !contacts) return <p className="text-sm text-red-500">Failed to load contacts.</p>

  return (
    <div className="space-y-2">
      {contacts.map((contact) => (
        <ContactListItem
          key={contact.id}
          contact={contact}
          onClick={() => onSelect(contact.id)}
        />
      ))}
    </div>
  )
}
