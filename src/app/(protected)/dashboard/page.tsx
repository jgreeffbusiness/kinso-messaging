'use client'

import { useState, useEffect } from 'react'
import useMessages from '@hooks/useMessages'
import { useThreadedMessages, EnhancedMessage, Message } from '@hooks/useThreadedMessages'
import { useActiveFocus } from '@/providers/ActiveFocusProvider'
import SharedLayout from '@components/layout/SharedLayout'
import { Loader2, AlertTriangle, Zap, ClipboardCheck, CalendarDays } from 'lucide-react'
import { UrgentCommunicationItem } from '@components/UrgentCommunicationItem'
import { useAuth } from '@/components/AuthProvider'

export default function DashboardPage() {
  const { user } = useAuth();
  const currentUserSlackId = user?.slackUserId;
  const { setActiveItem } = useActiveFocus();

  const { messages: rawMessages, isLoading: rawLoading, error: rawError } = useMessages();
  const threadedMessages: EnhancedMessage[] = useThreadedMessages(
    (rawMessages || []) as Message[], 
    currentUserSlackId
  );

  const [topAttentionItems, setTopAttentionItems] = useState<EnhancedMessage[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (threadedMessages && threadedMessages.length > 0) {
      setTopAttentionItems(threadedMessages.slice(0, 5));
    }
  }, [threadedMessages]);

  const handleItemSelect = (itemId: string) => {
    const itemToSelect = topAttentionItems.find(item => item.id === itemId);
    if (itemToSelect) {
      setSelectedItemId(itemId);
      setActiveItem({ type: 'dashboard_item', data: itemToSelect });
    } else {
      setSelectedItemId(null);
      setActiveItem(null);
    }
  };

  if (rawLoading) {
    return (
      <SharedLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
        </div>
      </SharedLayout>
    );
  }

  if (rawError) {
    return (
      <SharedLayout>
        <div className="p-6 text-center text-destructive">
          <AlertTriangle className="mx-auto h-12 w-12 mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Dashboard</h2>
          <p>{rawError.message || 'Could not fetch necessary data.'}</p>
        </div>
      </SharedLayout>
    );
  }

  return (
    <SharedLayout>
      {/* Page Header */}
      <div className="p-6 border-b bg-background">
        <h1 className="text-2xl font-bold">AI Command Center</h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Area - Scrollable */}
        <div className="flex-1 p-6 overflow-y-auto">
          <p className="text-muted-foreground mb-8">
            Your AI assistant has highlighted these items needing your focus.
          </p>

          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Column: Urgent Communications */}
            <div className="lg:w-3/5 flex-shrink-0">
              {topAttentionItems.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-semibold mb-3 text-primary flex items-center">
                    <Zap size={20} className="mr-2 opacity-80" /> Urgent Communications
                  </h2>
                  <div className="space-y-2 rounded-lg border bg-card p-2 shadow">
                    {topAttentionItems.map(item => (
                      <UrgentCommunicationItem 
                        key={item.id} 
                        item={item} 
                        onSelect={handleItemSelect}
                        isSelected={selectedItemId === item.id}
                      />
                    ))}
                  </div>
                </div>
              )}

              {topAttentionItems.length === 0 && !rawLoading && (
                <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card p-6 shadow">
                  <Zap size={48} className="mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-semibold">All Clear!</h3>
                  <p>Your AI hasn&apos;t flagged any items needing immediate attention right now.</p>
                </div>
              )}
            </div>

            {/* Right Column: Future Modules (Tasks, Events) */}
            <div className="lg:w-2/5 space-y-6">
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-3 text-primary/80 flex items-center">
                  <ClipboardCheck size={20} className="mr-2 opacity-70" /> Pending Tasks
                </h2>
                <div className="p-4 rounded-lg border bg-card text-muted-foreground text-sm shadow">
                  Task management integration coming soon...
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold mb-3 text-primary/80 flex items-center">
                  <CalendarDays size={20} className="mr-2 opacity-70" /> Upcoming Events
                </h2>
                <div className="p-4 rounded-lg border bg-card text-muted-foreground text-sm shadow">
                  Calendar integration coming soon...
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Assistant Panel is part of SharedLayout and will be on the right */}
      </div>
    </SharedLayout>
  );
}
