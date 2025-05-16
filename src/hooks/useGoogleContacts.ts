'use client'

import { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

export function useGoogleContacts() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = useAuthStore(state => state.user);
  
  // This function checks if the user has authorized Google Contacts
  const hasContactsAuthorization = () => {
    if (!user?.googleAccessToken) return false;
    
    // Check if token is expired
    const tokenExpiry = user.googleTokenExpiry 
      ? new Date(user.googleTokenExpiry) 
      : null;
    
    if (!tokenExpiry || tokenExpiry < new Date()) return false;
    
    // Check if contacts integration is enabled
    return user.googleIntegrations?.contacts === true;
  }

  // Fetch contacts using the token stored in the user object
  async function fetchContacts() {
    setIsLoading(true);
    setError(null);
    
    try {
      if (!hasContactsAuthorization()) {
        throw new Error('Google Contacts not authorized');
      }
      
      const response = await fetch('/api/google/contacts');
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Non-JSON response received:', await response.text());
        throw new Error('Server returned an invalid response format');
      }
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch contacts');
      }
      
      const data = await response.json();
      return data.contacts;
    } catch (err) {
      console.error('Failed to fetch Google contacts:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch contacts');
      return [];
    } finally {
      setIsLoading(false);
    }
  }
  
  return { 
    fetchContacts, 
    hasContactsAuthorization,
    isLoading, 
    error 
  };
} 