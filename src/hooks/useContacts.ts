import { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

export function useContacts() {
  const [contacts, setContacts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const user = useAuthStore(state => state.user);
  
  const fetchContacts = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/contacts');
      
      if (!response.ok) {
        throw new Error('Failed to fetch contacts');
      }
      
      const data = await response.json();
      setContacts(data.contacts);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching contacts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);
  
  // Fetch contacts on mount
  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);
  
  // Function to refresh contacts
  const refreshContacts = () => {
    fetchContacts();
  };
  
  return {
    contacts,
    isLoading,
    error,
    refreshContacts
  };
} 