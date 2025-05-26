import { useState, useMemo, useCallback } from 'react'
import { trpc } from '@utils/trpc'

export function useMessages() {
  const [searchQuery, setSearchQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState('all')
  
  // Fetch messages with TRPC with more conservative settings
  const { data: messages, isLoading, error, refetch } = trpc.message.getAll.useQuery(
    undefined, // no parameters
    {
      // Cache for 5 minutes - don't refetch unless explicitly requested
      staleTime: 5 * 60 * 1000,
      // Only refetch manually or when specifically invalidated
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: false,
      // Don't automatically retry
      retry: false,
      // Enable the query (always fetch on mount)
      enabled: true,
    }
  )
  
  // Manual refresh function for when user wants to check for new messages
  const refreshMessages = useCallback(async () => {
    console.log('🔄 Manually refreshing messages...')
    return await refetch()
  }, [refetch])
  
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
    setPlatformFilter,
    refetch,
    refreshMessages // New manual refresh function
  }
} 

export default useMessages