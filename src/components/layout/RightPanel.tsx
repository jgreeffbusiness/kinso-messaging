'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { MessageSquare, ChevronDown, ChevronUp, X, Pencil } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useChat } from '@/providers/ChatProvider'

export function RightPanel({ 
  children, 
  showContactInfo = false,
  contactData = null,
  className 
}) {
  const { 
    inputValue, 
    setInputValue, 
    messages, 
    addMessage,
    setIsRightPanelVisible
  } = useChat()
  
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [chatExpanded, setChatExpanded] = useState(false)
  
  // Helper function to format date for the side trail
  const formatDateTrail = (date) => {
    const d = new Date(date);
    const month = d.toLocaleString('default', { month: 'short' }).toUpperCase();
    const day = d.getDate();
    return { month, day };
  }
  
  // Add useEffect to update visibility
  useEffect(() => {
    setIsRightPanelVisible(!isCollapsed)
    
    // Clean up when component unmounts
    return () => {
      setIsRightPanelVisible(false)
    }
  }, [isCollapsed, setIsRightPanelVisible])
  
  return (
    <div className={cn(
      "border-l transition-all duration-300 flex flex-col bg-background relative",
      isCollapsed ? "w-16" : "w-96",
      className
    )}>
      {isCollapsed ? (
        <div className="flex flex-col items-center pt-4 gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setIsCollapsed(false)}
          >
            <MessageSquare className="h-5 w-5" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between h-[73px] px-6 border-b">
            <h3 className="font-semibold text-2xl">
              {contactData?.contact?.fullName || "Assistant"}
            </h3>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsCollapsed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Contact information area with flex-grow and proper overflow */}
          <div className="flex-1 overflow-hidden flex flex-col relative">
            <div className="flex-1 overflow-hidden">
              {showContactInfo && contactData?.contact ? (
                <ScrollArea className="h-full pb-[180px]">
                  <div className="p-6">
                    {/* Profile Section */}
                    <div className="flex flex-col items-center mb-8">
                      <Avatar className="h-24 w-24 mb-4">
                        <AvatarImage src={contactData.contact.photoUrl} />
                        <AvatarFallback className="text-xl">
                          {contactData.contact.fullName?.[0] || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <h4 className="text-xl font-medium text-center">{contactData.contact.fullName}</h4>
                      {contactData.contact.title && (
                        <p className="text-muted-foreground text-center">{contactData.contact.title}</p>
                      )}
                      <div className="mt-4 flex gap-2">
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
                    
                    {/* Contact Details */}
                    <div className="mb-6">
                      <p className="text-sm text-muted-foreground mb-1">Email</p>
                      <p className="mb-3">{contactData.contact.email}</p>
                      
                      {contactData.contact.phone && (
                        <>
                          <p className="text-sm text-muted-foreground mb-1">Phone</p>
                          <p className="mb-3">{contactData.contact.phone}</p>
                        </>
                      )}
                    </div>
                    
                    {/* Recent Messages - Limited to 3 */}
                    {contactData.messages?.length > 0 && (
                      <div className="mb-6">
                        <h5 className="font-medium mb-3">Recent Messages</h5>
                        <div className="space-y-2">
                          {contactData.messages.slice(0, 3).map(message => (
                            <div key={message.id} className="p-2 bg-muted rounded-md">
                              <p className="text-sm">{message.content}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {new Date(message.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Notes Tabs */}
                    {contactData.notes?.length > 0 && (
                      <div>
                        <h5 className="font-medium mb-3">Notes</h5>
                        <Tabs defaultValue="professional">
                          <TabsList className="w-full mb-4">
                            <TabsTrigger value="professional" className="flex-1">Professional</TabsTrigger>
                            <TabsTrigger value="personal" className="flex-1">Personal</TabsTrigger>
                          </TabsList>
                          
                          <TabsContent value="professional">
                            <div className="space-y-6">
                              {contactData.notes
                                .filter(note => note.category === 'professional')
                                .map(note => {
                                  const { month, day } = formatDateTrail(note.createdAt);
                                  return (
                                    <div key={note.id} className="flex gap-4">
                                      {/* Date trail */}
                                      <div className="flex flex-col items-center text-xs text-muted-foreground w-8">
                                        <span>{month}</span>
                                        <span>{day}</span>
                                      </div>
                                      
                                      {/* Note content */}
                                      <div className="flex-1 p-3 bg-muted rounded-md">
                                        <p className="text-sm whitespace-pre-line">{note.content}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </TabsContent>
                          
                          <TabsContent value="personal">
                            <div className="space-y-6">
                              {contactData.notes
                                .filter(note => note.category === 'personal')
                                .map(note => {
                                  const { month, day } = formatDateTrail(note.createdAt);
                                  return (
                                    <div key={note.id} className="flex gap-4">
                                      {/* Date trail */}
                                      <div className="flex flex-col items-center text-xs text-muted-foreground w-8">
                                        <span>{month}</span>
                                        <span>{day}</span>
                                      </div>
                                      
                                      {/* Note content */}
                                      <div className="flex-1 p-3 bg-muted rounded-md">
                                        <p className="text-sm whitespace-pre-line">{note.content}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </TabsContent>
                        </Tabs>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No contact selected
                </div>
              )}
            </div>
            
            {/* Chat interface fixed to bottom of panel with max height constraint */}
            <div className={cn(
              "absolute bottom-0 left-0 right-0 bg-background border-t transition-all duration-300 shadow-lg",
              "max-h-[50vh]", // Prevents it from going off screen
              chatExpanded ? "h-[350px]" : "h-[140px]"
            )}>
              <div className="flex items-center justify-between px-4 py-2 border-b">
                <h4 className="font-medium">Chat with Assistant</h4>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setChatExpanded(!chatExpanded)}
                >
                  {chatExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
              </div>
              
              <ScrollArea className={cn("flex-1", chatExpanded ? "h-[270px]" : "h-[60px]")}>
                <div className="space-y-4 p-4">
                  {messages.map(message => (
                    <div 
                      key={message.id} 
                      className={cn(
                        "p-3 rounded-lg",
                        message.sender === "assistant" ? "bg-muted" : "bg-primary text-primary-foreground ml-8"
                      )}
                    >
                      <p className="text-sm">{message.content}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              
              <div className="p-2 border-t">
                <div className="flex gap-2">
                  <Input 
                    placeholder="Ask anything..." 
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="flex-1"
                  />
                  <Button 
                    size="sm" 
                    onClick={() => {
                      if (!inputValue.trim()) return;
                      
                      addMessage({
                        content: inputValue,
                        sender: "user",
                        createdAt: new Date().toISOString()
                      });
                      
                      setInputValue('');
                      
                      // Here you would call your AI service and add the response
                    }}
                  >
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
} 