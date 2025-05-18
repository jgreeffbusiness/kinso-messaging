'use client'

import { trpc } from '@utils/trpc'
import { useRouter } from 'next/navigation'
import ContactListItem from './ContactListItem'

export default function ContactList() {
  const { data: contacts, isLoading, isError } = trpc.contact.getAll.useQuery()
  const router = useRouter()

  if (isLoading) return <p className="text-sm text-gray-500">Loading contacts...</p>
  if (isError || !contacts) return <p className="text-sm text-red-500">Failed to load contacts.</p>

  const handleContactClick = (id: string) => {
    router.push(`/contacts/${id}`)
  }

  return (
    <div className="space-y-2">
      {contacts.map((contact) => (
        <ContactListItem
          key={contact.id}
          contact={contact}
          onClick={() => handleContactClick(contact.id)}
        />
      ))}
    </div>
  )
}
