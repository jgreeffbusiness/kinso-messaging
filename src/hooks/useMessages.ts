import { useState, useMemo } from 'react'
import { trpc } from '@utils/trpc'

export function useMessages() {
  const [searchQuery, setSearchQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState('all')
  
  // Fetch messages with TRPC
  const { data: messages, isLoading, error } = trpc.message.getAll.useQuery()
  
  // Apply filters to messages
  const filteredMessages = useMemo(() => {
    if (!messages) return []
    
    return messages
      .filter(message => 
        message.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (message.contact?.fullName && 
         message.contact.fullName.toLowerCase().includes(searchQuery.toLowerCase()))
      )
      .filter(message => 
        platformFilter === 'all' || 
        message.platform.toLowerCase() === platformFilter.toLowerCase()
      )
  }, [messages, searchQuery, platformFilter])
  
  return {
    messages: filteredMessages,
    allMessages: messages,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    platformFilter,
    setPlatformFilter
  }
} 

export default useMessages