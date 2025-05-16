'use client'

import { Contact } from '@prisma/client'

export default function ContactListItem({
  contact,
  onClick,
}: {
  contact: Contact
  onClick: () => void
}) {
  return (
    <button
      onClick={() => onClick()}
      className="w-full flex items-center gap-3 border rounded-lg bg-white p-4 hover:bg-gray-50 shadow-sm"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-700">
        {contact.fullName.slice(0, 1).toUpperCase()}
      </div>
      <div className="text-left">
        <p className="text-sm font-semibold text-gray-900">{contact.fullName}</p>
        {contact.email && <p className="text-xs text-gray-500">{contact.email}</p>}
      </div>
    </button>
  )
}
