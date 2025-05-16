'use client'

import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Edit, Share2, MessageSquare, FileText, Clock } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent } from '@/components/ui/card'
import { formatDistanceToNow } from 'date-fns'

interface ContactPanelProps {
  contact: {
    id: string  
    fullName: string
    email?: string
    phone?: string
    photoUrl?: string
    title?: string
    company?: string
  }
  notes?: {
    id: string
    content: string
    category: 'personal' | 'professional'
    createdAt: Date
  }[]
  messages?: {
    id: string
    content: string
    createdAt: Date
    isOutbound: boolean
  }[]
}

export function ContactPanel({ 
  contact, 
  notes = [], 
  messages = [] 
}: ContactPanelProps) {
  const [activeTab, setActiveTab] = useState<'professional' | 'personal'>('professional')

  // Combine notes and messages into a timeline
  const timelineItems = [
    ...notes.filter(note => note.category === activeTab).map(note => ({
      id: note.id,
      content: note.content,
      createdAt: note.createdAt,
      type: 'note' as const
    })),
    ...messages.map(message => ({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      type: 'message' as const,
      isOutbound: message.isOutbound
    }))
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  // Get initials for avatar fallback
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Contact header */}
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <Avatar className="h-20 w-20 mb-4">
          <AvatarImage src={contact.photoUrl} />
          <AvatarFallback>{getInitials(contact.fullName)}</AvatarFallback>
        </Avatar>
        <h2 className="text-xl font-semibold">{contact.fullName}</h2>
        {contact.title && contact.company && (
          <p className="text-muted-foreground">{contact.title} at {contact.company}</p>
        )}
        
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="icon">
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="default" className="gap-2">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        </div>
      </div>

      <Separator />
      
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1">
        <div className="px-4">
          <TabsList className="grid w-full grid-cols-2 mt-2">
            <TabsTrigger value="professional">Professional</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="professional" className="flex-1 pt-4">
          <div className="space-y-6">
            {timelineItems.length > 0 ? (
              timelineItems.map(item => (
                <TimelineItem key={item.id} item={item} />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mb-2 opacity-20" />
                <p>No professional notes yet</p>
                <Button variant="outline" className="mt-2">Add a note</Button>
              </div>
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="personal" className="flex-1 pt-4">
          <div className="space-y-6">
            {timelineItems.length > 0 ? (
              timelineItems.map(item => (
                <TimelineItem key={item.id} item={item} />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mb-2 opacity-20" />
                <p>No personal notes yet</p>
                <Button variant="outline" className="mt-2">Add a note</Button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
      
      {/* Add Note Button */}
      <div className="p-4 border-t mt-auto">
        <Button className="w-full gap-2">
          <FileText className="h-4 w-4" />
          Add Note
        </Button>
      </div>
    </div>
  )
}

interface TimelineItemProps {
  item: {
    id: string
    content: string
    createdAt: Date
    type: 'note' | 'message'
    isOutbound?: boolean
  }
}

function TimelineItem({ item }: TimelineItemProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
          {item.type === 'note' ? (
            <>
              <FileText className="h-4 w-4" />
              <span>Note</span>
            </>
          ) : (
            <>
              <MessageSquare className="h-4 w-4" />
              <span>{item.isOutbound ? 'Sent message' : 'Received message'}</span>
            </>
          )}
          <div className="flex-1" />
          <Clock className="h-3 w-3" />
          <span>{formatDistanceToNow(item.createdAt, { addSuffix: true })}</span>
        </div>
        <p className="text-sm whitespace-pre-wrap">{item.content}</p>
      </CardContent>
    </Card>
  )
} 