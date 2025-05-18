'use client'

import { useState } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { ScrollArea } from '@components/ui/scroll-area'
import { cn } from '@lib/utils'
import { useChat } from '@providers/ChatProvider'

export function GlobalChat() {
  const { 
    isGlobalChatVisible,
    hideGlobalChat,
    inputValue, 
    setInputValue,
    messages,
    addMessage,
    isRightPanelVisible 
  } = useChat()
  
  const [expanded, setExpanded] = useState(false)
  
  // Don't render if right panel is showing or if global chat is hidden
  if (!isGlobalChatVisible || isRightPanelVisible) {
    return null
  }
  
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 shadow-lg rounded-lg border bg-background overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <h4 className="font-medium">Chat with Assistant</h4>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={hideGlobalChat}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <div className={cn(
        "transition-all duration-300",
        expanded ? "h-[300px]" : "h-[150px]"
      )}>
        <ScrollArea className="h-full">
          <div className="space-y-4 p-4 pb-14">
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
      </div>
      
      <div className="absolute bottom-0 left-0 right-0 p-3 border-t bg-background">
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
            }}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  )
} 