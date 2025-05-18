'use client'

import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { cn } from '@lib/utils'
import { useChat } from '@providers/ChatProvider'

export function RightPanel() {
  const { 
    inputValue, 
    setInputValue, 
    messages, 
    addMessage
  } = useChat()

  return (
    <div className="border-l w-80 flex flex-col bg-background">
      <div className="flex items-center p-4 border-b">
        <h3 className="font-medium">AI Assistant</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {messages.map(message => (
            <div 
              key={message.id} 
              className={cn(
                "p-3 rounded-lg break-words",
                message.sender === "assistant" ? "bg-muted" : "bg-primary text-primary-foreground ml-8"
              )}
            >
              <p className="text-sm">{message.content}</p>
            </div>
          ))}
        </div>
      </div>
      
      <div className="p-3 border-t mt-auto">
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