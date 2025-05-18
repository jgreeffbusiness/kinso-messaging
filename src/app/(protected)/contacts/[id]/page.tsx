'use client'

import { useParams, useRouter } from 'next/navigation'
import { trpc } from '@utils/trpc'
import SharedLayout from '@components/layout/SharedLayout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@components/ui/avatar'
import { Button } from '@components/ui/button'
import { Pencil, MessageSquare, ArrowLeft } from 'lucide-react'
import { Separator } from '@components/ui/separator'

export default function ContactDetailPage() {
  const params = useParams()
  const router = useRouter()
  const contactId = params.id as string
  const { data: contact, isLoading } = trpc.contact.getById.useQuery({ id: contactId })

  const handleBackClick = () => {
    router.push('/contacts')
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
        {/* Back button */}
        <Button 
          variant="ghost" 
          size="sm" 
          className="mb-4 -ml-2 gap-1"
          onClick={handleBackClick}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Contacts
        </Button>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <p>Loading contact information...</p>
          </div>
        ) : !contact ? (
          <div className="flex items-center justify-center h-64">
            <p>Contact not found</p>
          </div>
        ) : (
          <>
            {/* Contact Header */}
            <div className="flex items-start gap-6">
              <Avatar className="h-24 w-24">
                <AvatarImage src={contact.photoUrl} />
                <AvatarFallback className="text-xl">
                  {getInitials(contact.fullName)}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="text-2xl font-bold mb-1">{contact.fullName}</h1>
                    {contact.email && <p className="text-muted-foreground">{contact.email}</p>}
                    {contact.phoneNumber && <p className="text-muted-foreground">{contact.phoneNumber}</p>}
                  </div>
                  
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-1">
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button size="sm" className="gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Message
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            
            <Separator />
            
            {/* Contact Detail Tabs */}
            <Tabs defaultValue="messages" className="mt-6">
              <TabsList>
                <TabsTrigger value="messages">Messages</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              
              <TabsContent value="messages" className="mt-4">
                {contact.messages && contact.messages.length > 0 ? (
                  <div className="space-y-4">
                    {contact.messages.map(message => (
                      <div key={message.id} className="bg-muted p-4 rounded-lg">
                        <div className="flex justify-between mb-2">
                          <span className="font-medium">{message.platform}</span>
                          <span className="text-sm text-muted-foreground">
                            {new Date(message.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p>{message.content}</p>
                        {message.summary && (
                          <div className="mt-2 border-t pt-2">
                            <p className="text-sm font-medium">Summary</p>
                            <p className="text-sm">{message.summary.summaryText}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No messages yet</p>
                )}
              </TabsContent>
              
              <TabsContent value="notes" className="mt-4">
                {contact.notes && contact.notes.length > 0 ? (
                  <div className="space-y-4">
                    {contact.notes.map(note => (
                      <div key={note.id} className="bg-muted p-4 rounded-lg">
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p>{note.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No notes yet</p>
                )}

                <Button className="mt-4">Add Note</Button>
              </TabsContent>
              
              <TabsContent value="activity" className="mt-4">
                <p className="text-muted-foreground text-center py-8">Activity log coming soon</p>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </SharedLayout>
  )
}