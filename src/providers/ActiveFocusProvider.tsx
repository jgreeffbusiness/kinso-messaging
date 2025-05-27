'use client'

import { createContext, useContext, useState, ReactNode, Dispatch, SetStateAction, useEffect } from 'react';
import { EnhancedMessage } from '@hooks/useThreadedMessages'; // Assuming EnhancedMessage is a common detailed type

// Define the types of items that can be focused
// We can expand this union as new focusable item types are added (e.g., Contact, Task, Event)
export type ActiveFocusItemType = 
  | { type: 'message'; data: EnhancedMessage } 
  | { type: 'dashboard_item'; data: EnhancedMessage } // Dashboard items are also EnhancedMessages for now
  | { type: 'message_id_only'; id: string } // For when only ID is available initially
  // | { type: 'contact'; data: ContactType } // Future
  // | { type: 'task'; data: TaskType }       // Future
  | null; // Null when nothing is actively focused

interface ActiveFocusContextType {
  activeItem: ActiveFocusItemType;
  setActiveItem: Dispatch<SetStateAction<ActiveFocusItemType>>;
  // We can keep selectedMessageId for backward compatibility or specific use cases if needed,
  // or derive it from activeItem if activeItem.type === 'message'
  selectedMessageId?: string; 
  setSelectedMessageId: (id: string | undefined) => void; // Kept for smoother transition
}

const ActiveFocusContext = createContext<ActiveFocusContextType | undefined>(undefined);

export function ActiveFocusProvider({ children }: { children: ReactNode }) {
  const [activeItem, _setActiveItem] = useState<ActiveFocusItemType>(null);
  const [selectedMessageId, _setSelectedMessageId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (activeItem?.type === 'message') {
      if (activeItem.data.id !== selectedMessageId) { // Compare with the exposed selectedMessageId state
        _setSelectedMessageId(activeItem.data.id); // Call the direct setter
      }
    } else if (activeItem?.type === 'dashboard_item') {
      // If a dashboard item is active, its ID should also be the selectedMessageId for consistency
      // as dashboard items are also EnhancedMessages
      if (activeItem.data.id !== selectedMessageId) {
        _setSelectedMessageId(activeItem.data.id);
      }
    } else if (activeItem?.type === 'message_id_only') {
      if (activeItem.id !== selectedMessageId) {
        _setSelectedMessageId(activeItem.id);
      }
    } else if (activeItem === null) {
      // If activeItem is cleared, and selectedMessageId was populated, clear selectedMessageId too.
      if (selectedMessageId !== undefined) {
        _setSelectedMessageId(undefined);
      }
    }
  // Watch both activeItem and the *exposed* selectedMessageId to prevent infinite loops
  // and to react if selectedMessageId is changed externally via its own setter.
  }, [activeItem, selectedMessageId]);

  const setActiveItem: Dispatch<SetStateAction<ActiveFocusItemType>> = (itemOrUpdater) => {
    _setActiveItem(itemOrUpdater); // Directly set activeItem
    // The useEffect will then sync selectedMessageId if needed.
  };

  const setSelectedMessageId = (id: string | undefined) => {
    _setSelectedMessageId(id); // Directly set selectedMessageId
    if (id) {
      // If an ID is set directly (likely from MessagesPage), 
      // set activeItem to the lightweight version.
      // This ensures activeItem reflects that *something* related to a message ID is active.
      if (activeItem?.type !== 'message_id_only' || activeItem.id !== id) {
         _setActiveItem({ type: 'message_id_only', id });
      }
    } else {
      // If ID is cleared, and activeItem was related to this ID, clear activeItem.
      if (activeItem?.type === 'message_id_only' && activeItem.id === selectedMessageId) {
         _setActiveItem(null);
      } else if (activeItem?.type === 'message' && activeItem.data.id === selectedMessageId) {
         _setActiveItem(null);
      } else if (activeItem?.type === 'dashboard_item' && activeItem.data.id === selectedMessageId) {
         _setActiveItem(null);
      } else if (id === undefined && activeItem !== null) { // General clear if id is undefined
         _setActiveItem(null);
      }
    }
  };

  return (
    <ActiveFocusContext.Provider value={{
      activeItem,
      setActiveItem,
      selectedMessageId,
      setSelectedMessageId
    }}>
      {children}
    </ActiveFocusContext.Provider>
  );
}

export function useActiveFocus() {
  const context = useContext(ActiveFocusContext);
  if (context === undefined) {
    throw new Error('useActiveFocus must be used within an ActiveFocusProvider');
  }
  return context;
} 