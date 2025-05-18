'use client'

import { useRouter } from 'next/navigation'
import useMessages from '@hooks/useMessages'
import SharedLayout from '@components/layout/SharedLayout'
import MessageList from '@components/MessageList'
import { Input } from '@components/ui/input'
import { Search, Loader2 } from 'lucide-react'
import { Separator } from '@components/ui/separator'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@components/ui/select'

export default function MessagesPage() {
  const router = useRouter()
  const { 
    messages, 
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    platformFilter,
    setPlatformFilter
  } = useMessages()

  // Handle message click
  const handleMessageClick = (messageId: string) => {
    router.push(`/messages/${messageId}`)
  }

  return (
    <SharedLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Messages</h1>
        </div>
        
        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search messages..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All platforms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="slack">Slack</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <Separator />
        
        {/* Messages List */}
        <div className="pt-2">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              Error loading messages: {error}
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery || platformFilter !== 'all' 
                ? 'No messages match your search or filter' 
                : 'No messages yet'}
            </div>
          ) : (
            <MessageList
              messages={messages}
              onMessageClick={handleMessageClick}
              showContact={true}
            />
          )}
        </div>
      </div>
    </SharedLayout>
  )
}