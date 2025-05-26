// Core platform types for multi-platform messaging support

/**
 * Common platform contact interface
 */
export interface PlatformContact {
  id: string
  name: string
  email?: string
  handle?: string // username, @handle, etc.
  avatar?: string
  platformSpecific?: Record<string, unknown>
}

/**
 * Common platform message interface
 */
export interface PlatformMessage {
  id: string
  platformId: string // Platform-specific message ID
  content: string
  timestamp: Date
  threadId?: string
  sender: {
    id: string
    name: string
    email?: string
    handle?: string
  }
  recipients: Array<{
    id: string
    name: string
    email?: string
    handle?: string
  }>
  direction: 'inbound' | 'outbound'
  metadata?: Record<string, unknown>
}

export interface PlatformThread {
  id: string
  platformId: string
  subject?: string
  participants: PlatformContact[]
  messageCount: number
  lastActivity: Date
  metadata: Record<string, unknown>
}

export interface PlatformConfig {
  name: string
  displayName: string
  icon: string
  color: string
  authType: 'oauth' | 'api_key' | 'webhook'
  scopes?: string[]
  endpoints?: Record<string, string>
}

/**
 * Platform adapter interface
 */
export interface PlatformAdapter {
  platform: string
  
  // Authentication
  isAuthenticated(userId: string): Promise<boolean>
  
  // Contacts
  fetchContacts(userId: string): Promise<PlatformContact[]>
  
  // Messages
  fetchMessages(userId: string, options?: {
    limit?: number
    since?: Date
    contactId?: string
  }): Promise<PlatformMessage[]>
  
  // Sync capability
  syncMessages(userId: string, contactId?: string): Promise<{
    success: boolean
    messagesProcessed: number
    newMessages: number
    errors: string[]
  }>
}

/**
 * Cross-platform sync options
 */
export interface SyncOptions {
  platforms?: string[]
  limit?: number
  since?: Date
  contactId?: string
}

export interface PlatformAuthResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresAt?: Date
  error?: string
}

export interface FetchOptions {
  limit?: number
  since?: Date
  contactIds?: string[]
  threadIds?: string[]
}

export interface OutgoingMessage {
  content: string
  threadId?: string
  recipients: PlatformContact[]
  replyToId?: string
  metadata?: Record<string, unknown>
}

// Normalized message format for our database
export interface NormalizedMessage {
  id?: string // Our internal ID
  userId: string
  contactId: string
  platform: string
  platformMessageId: string
  content: string
  timestamp: Date
  platformData: {
    // Common fields
    threadId?: string
    direction: 'inbound' | 'outbound'
    subject?: string
    
    // Platform-specific data
    [key: string]: unknown
  }
}

// Enhanced message with AI processing
export interface EnhancedMessage extends NormalizedMessage {
  platformData: {
    // Original fields
    threadId?: string
    direction: 'inbound' | 'outbound'
    subject?: string
    
    // AI enhancement fields
    aiSummary?: string
    keyPoints?: string[]
    actionItems?: string[]
    urgency?: 'low' | 'medium' | 'high'
    category?: 'meeting' | 'administrative' | 'commercial' | 'personal' | 'notification' | 'other'
    originalContent?: string
    
    // Platform-specific data
    [key: string]: unknown
  }
} 