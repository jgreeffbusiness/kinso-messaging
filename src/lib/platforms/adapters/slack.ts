import { 
  PlatformAdapter, 
  PlatformMessage, 
  PlatformContact,
  PlatformAuthResult,
  PlatformConfig
} from '../types'
import { prisma } from '@/server/db'
import { filterRealContacts } from '@/lib/utils/bot-detection'

interface SlackSendMessageOptions {
  channelId: string
  text: string
  threadTs?: string // For replies in thread
  replyBroadcast?: boolean // Reply to thread but also send to channel
}

interface SlackSendResponse {
  success: boolean
  messageId?: string
  timestamp?: string
  error?: string
}

interface SlackPlatformData {
  metadata?: {
    channel?: string
  }
  channel?: string
  threadId?: string
  [key: string]: unknown
}

interface SlackChannel {
  id: string
  name?: string
  is_channel?: boolean
  is_group?: boolean
  [key: string]: unknown
}

export class SlackAdapter implements PlatformAdapter {
  platform = 'slack'
  private rateLimitState = new Map<string, { nextAllowedTime: number, retryCount: number }>()
  
  config: PlatformConfig = {
    name: 'slack',
    displayName: 'Slack',
    icon: '💬',
    color: 'purple',
    authType: 'oauth',
    scopes: [
      'channels:read',
      'im:read',
      'im:history',
      'users:read',
      'users:read.email',
      'chat:write'
    ],
    endpoints: {
      auth: 'https://slack.com/oauth/v2/authorize',
      token: 'https://slack.com/api/oauth.v2.access',
      api: 'https://slack.com/api'
    }
  }

  async authenticate(userId: string): Promise<PlatformAuthResult> {
    try {
      // Redirect user to our Slack OAuth endpoint
      console.log(`Slack authentication requested for user: ${userId}`)
      
      return {
        success: false,
        error: 'Use /api/auth/slack to initiate OAuth flow'
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      }
    }
  }

  async refreshAuth(userId: string): Promise<PlatformAuthResult> {
    try {
      console.log(`Slack auth refresh requested for user: ${userId}`)
      
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { slackRefreshToken: true }
      })

      if (!user?.slackRefreshToken) {
        return {
          success: false,
          error: 'No refresh token available'
        }
      }

      // Note: Slack tokens typically don't expire, but if they do,
      // we would implement refresh logic here
      return {
        success: true,
        accessToken: 'refreshed-token' // Placeholder
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Refresh failed'
      }
    }
  }

  async isAuthenticated(userId: string): Promise<boolean> {
    try {
      console.log(`Checking Slack authentication for user: ${userId}`)
      
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { 
          slackAccessToken: true,
          slackTokenExpiry: true,
          slackIntegrations: true
        }
      })

      if (!user?.slackAccessToken) {
        return false
      }

      // Check if token has expired (if expiry is set)
      if (user.slackTokenExpiry && new Date(user.slackTokenExpiry) < new Date()) {
        return false
      }

      // Check if integrations are enabled
      const integrations = user.slackIntegrations as SlackIntegrations | null
      if (!integrations?.enabled) {
        return false
      }

      return true
    } catch (error) {
      console.error(`Slack auth check failed for user ${userId}:`, error)
      return false
    }
  }

  async fetchMessages(userId: string, options?: {
    limit?: number
    since?: Date
    contactId?: string
  }): Promise<PlatformMessage[]> {
    try {
      console.log(`Fetching Slack messages for user: ${userId}, options:`, options)
      
      // Get user's Slack credentials
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { 
          slackAccessToken: true,
          slackTeamId: true,
          slackUserId: true,
          slackIntegrations: true
        }
      })

      if (!user?.slackAccessToken) {
        throw new Error('User not authenticated with Slack')
      }

      // Get the appropriate token for DM access
      const integrations = user.slackIntegrations as { 
        tokens?: { userToken?: string };
        userScopes?: string[];
        scopes?: string[];
      } | null
      const userToken = integrations?.tokens?.userToken
      const botToken = user.slackAccessToken
      
      console.log('🔍 Token analysis:', {
        hasUserToken: !!userToken,
        hasBotToken: !!botToken,
        userScopes: integrations?.userScopes || 'none',
        botScopes: integrations?.scopes || 'none'
      })

      // For DM access, we MUST use user token if available
      if (!userToken) {
        console.warn('⚠️  No user token available - bot tokens cannot access personal DMs!')
        console.warn('⚠️  Please reconnect Slack with user scopes to access personal conversations.')
        return [] // Return empty instead of throwing error
      }
      
      console.log('✅ Using user token for personal DM access')
      const accessToken = userToken

      const messages: PlatformMessage[] = []
      
      // Fetch direct messages using user token
      const conversations = await this.fetchSlackConversations(accessToken, userId)
      
      console.log(`📱 Found ${conversations.length} personal DM conversations`)
      
      for (const conversation of conversations) {
        console.log(`📨 Fetching messages from conversation: ${conversation.id}`)
        const conversationHistory = await this.fetchSlackConversationHistory(
          accessToken,
          conversation.id,
          userId,
          options
        )
        
        console.log(`📨 Found ${conversationHistory.length} messages in conversation ${conversation.id}`)
        
        // Convert Slack messages to our format
        const convertedMessages = conversationHistory.map(msg => 
          this.convertSlackMessage(msg, conversation)
        )
        
        messages.push(...convertedMessages)
      }
      
      console.log(`✅ Total messages fetched: ${messages.length}`)
      return messages
    } catch (error) {
      console.error('Error fetching Slack messages:', error)
      return []
    }
  }

  async fetchThread(userId: string, threadId: string): Promise<PlatformMessage[]> {
    try {
      console.log(`Fetching Slack thread ${threadId} for user: ${userId}`)
      
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { slackAccessToken: true }
      })

      if (!user?.slackAccessToken) {
        throw new Error('User not authenticated with Slack')
      }

      // Use conversations.replies API to get thread messages
      const response = await fetch(`${this.config.endpoints?.api}/conversations.replies`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.slackAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: threadId.split('-')[0], // Extract channel from thread ID
          ts: threadId.split('-')[1], // Extract timestamp from thread ID
        }),
      })

      const data = await response.json()
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`)
      }

      return data.messages?.map((msg: SlackMessage) => this.convertSlackMessage(msg)) || []
    } catch (error) {
      console.error('Error fetching Slack thread:', error)
      return []
    }
  }

  /**
   * Send a message/reply through Slack
   */
  async sendMessage(userId: string, options: SlackSendMessageOptions): Promise<SlackSendResponse> {
    try {
      console.log(`Sending Slack message for user ${userId}:`, options)
      
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { slackAccessToken: true }
      })

      if (!user?.slackAccessToken) {
        return {
          success: false,
          error: 'User not authenticated with Slack'
        }
      }

      // Use chat.postMessage API
      const requestBody = {
        channel: options.channelId,
        text: options.text,
        ...(options.threadTs && { thread_ts: options.threadTs }),
        ...(options.replyBroadcast && { reply_broadcast: options.replyBroadcast })
      }

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.slackAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()
      
      if (!data.ok) {
        return {
          success: false,
          error: `Slack API error: ${data.error}`
        }
      }

      return {
        success: true,
        messageId: data.message?.client_msg_id || data.ts,
        timestamp: data.ts,
      }
    } catch (error) {
      console.error('Error sending Slack message:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Reply to a specific message in Slack
   */
  async replyToMessage(userId: string, originalMessageId: string, replyText: string): Promise<SlackSendResponse> {
    try {
      // First, get the original message to find channel and thread info
      const originalMessage = await prisma.message.findFirst({
        where: {
          userId,
          platformMessageId: originalMessageId,
          platform: 'slack'
        }
      })

      if (!originalMessage) {
        return {
          success: false,
          error: 'Original message not found'
        }
      }

      const platformData = originalMessage.platformData as SlackPlatformData
      const channelId = platformData?.metadata?.channel || platformData?.channel
      const threadTs = platformData?.threadId?.split('-')[1] || originalMessageId

      if (!channelId) {
        return {
          success: false,
          error: 'Could not determine Slack channel for reply'
        }
      }

      return await this.sendMessage(userId, {
        channelId,
        text: replyText,
        threadTs
      })
    } catch (error) {
      console.error('Error replying to Slack message:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reply'
      }
    }
  }

  /**
   * Get channel information for a user (for sending new messages)
   */
  async getChannels(userId: string): Promise<Array<{ id: string; name: string; type: string }>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { slackAccessToken: true }
      })

      if (!user?.slackAccessToken) {
        return []
      }

      const response = await fetch('https://slack.com/api/conversations.list', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.slackAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          types: 'public_channel,private_channel,im,mpim',
          limit: 100,
        }),
      })

      const data = await response.json()
      
      if (!data.ok) {
        console.error('Failed to fetch Slack channels:', data.error)
        return []
      }

      return data.channels?.map((channel: SlackChannel) => ({
        id: channel.id,
        name: channel.name || 'Direct Message',
        type: channel.is_channel ? 'channel' : channel.is_group ? 'group' : 'dm'
      })) || []
    } catch (error) {
      console.error('Error fetching Slack channels:', error)
      return []
    }
  }

  async fetchContacts(userId: string): Promise<PlatformContact[]> {
    try {
      console.log(`Fetching Slack contacts for user: ${userId}`)
      
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { slackAccessToken: true }
      })

      if (!user?.slackAccessToken) {
        throw new Error('User not authenticated with Slack')
      }

      // Use users.list API to get workspace members with rate limiting
      const response = await this.makeSlackAPICall('https://slack.com/api/users.list', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.slackAccessToken}`,
          'Content-Type': 'application/json',
        },
      }, userId)

      const data = await response.json()
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`)
      }

      // Convert Slack users to our platform contact format
      const allContacts = data.members?.map((member: SlackUser) => this.convertSlackUser(member)) || []
      
      // Filter out bots and automated accounts
      const { realContacts, filteredBots } = filterRealContacts(allContacts)
      
      // Log filtering results for debugging
      if (filteredBots.length > 0) {
        console.log(`Filtered out ${filteredBots.length} bots/automated accounts from Slack:`)
        filteredBots.forEach(bot => {
          console.log(`  - ${bot.name} (${bot.email || bot.handle}): ${bot.botDetection.reasons.join(', ')}`)
        })
      }
      
      console.log(`Returning ${realContacts.length} real Slack contacts (filtered ${filteredBots.length} bots)`)
      return realContacts
    } catch (error) {
      console.error('Error fetching Slack contacts:', error)
      return []
    }
  }

  async searchContacts(userId: string, query: string): Promise<PlatformContact[]> {
    try {
      console.log(`Searching Slack contacts for user: ${userId}, query: ${query}`)
      
      // For now, fetch all contacts and filter client-side
      const allContacts = await this.fetchContacts(userId)
      
      return allContacts.filter(contact => 
        contact.name.toLowerCase().includes(query.toLowerCase()) ||
        contact.email?.toLowerCase().includes(query.toLowerCase()) ||
        contact.handle?.toLowerCase().includes(query.toLowerCase())
      )
    } catch (error) {
      console.error('Error searching Slack contacts:', error)
      return []
    }
  }

  async syncMessages(userId: string, contactId?: string): Promise<{
    success: boolean
    messagesProcessed: number
    newMessages: number
    errors: string[]
  }> {
    try {
      console.log(`Starting Slack message sync for user ${userId}, contact: ${contactId}`)
      
      // 1. Get authentication for this user
      const isAuth = await this.isAuthenticated(userId)
      if (!isAuth) {
        return {
          success: false,
          messagesProcessed: 0,
          newMessages: 0,
          errors: ['User not authenticated with Slack']
        }
      }

      // 2. Fetch messages from Slack
      const messages = await this.fetchMessages(userId, {
        limit: 100,
        since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      })

      // 3. Basic sync - just return the count for now
      // The unified sync service will handle the actual processing
      return {
        success: true,
        messagesProcessed: messages.length,
        newMessages: messages.length, // Placeholder
        errors: []
      }
    } catch (error) {
      return {
        success: false,
        messagesProcessed: 0,
        newMessages: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  // Helper methods for Slack API calls
  private async fetchSlackConversations(userAccessToken: string, userId: string): Promise<SlackConversation[]> {
    console.log(`🔍 Fetching personal DM conversations using user token for user ${userId}...`)
    
    // Define interfaces for type safety
    interface SlackUser {
      id: string;
      name?: string;
      real_name?: string;
      is_bot?: boolean;
      deleted?: boolean;
    }
    
    // Use users.conversations with user token - this is the correct method for personal conversations
    const response = await this.makeSlackAPICall('https://slack.com/api/users.conversations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        types: 'im,mpim', // Include both direct messages and multi-party DMs
        limit: 100,
        exclude_archived: false, // Include archived conversations
      }),
    }, userId)

    const data = await response.json()
    
    console.log('🔍 users.conversations API Response:', {
      ok: data.ok,
      error: data.error,
      warning: data.warning,
      channelsLength: data.channels?.length || 0,
      hasChannels: !!data.channels
    })
    
    // If users.conversations still doesn't return DMs, try conversations.list with user token
    if (data.ok && (!data.channels || data.channels.length === 0 || !data.channels.some((ch: { is_im?: boolean; is_mpim?: boolean }) => ch.is_im || ch.is_mpim))) {
      console.log('🔄 users.conversations returned no DMs, trying conversations.list with user token...')
      
      const fallbackResponse = await this.makeSlackAPICall('https://slack.com/api/conversations.list', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          types: 'im,mpim',
          limit: 100,
          exclude_archived: false,
        }),
      }, userId)

      const fallbackData = await fallbackResponse.json()
      
      console.log('🔍 conversations.list (fallback) API Response:', {
        ok: fallbackData.ok,
        error: fallbackData.error,
        warning: fallbackData.warning,
        channelsLength: fallbackData.channels?.length || 0,
        hasChannels: !!fallbackData.channels
      })
      
      if (fallbackData.ok && fallbackData.channels) {
        console.log('📋 Fallback conversations received:')
        fallbackData.channels.forEach((channel: { 
          id: string; 
          name?: string; 
          is_im?: boolean; 
          is_mpim?: boolean; 
          is_channel?: boolean; 
          is_group?: boolean;
          user?: string;
        }, index: number) => {
          console.log(`  ${index + 1}. Conversation ID: ${channel.id}`)
          console.log(`     Name: ${channel.name || 'N/A'}`)
          console.log(`     Type flags: is_im=${channel.is_im}, is_mpim=${channel.is_mpim}, is_channel=${channel.is_channel}, is_group=${channel.is_group}`)
          console.log(`     User: ${channel.user || 'N/A'}`)
          console.log(`     ---`)
        })
        
        // Use fallback data if it has DMs
        const fallbackDMs = (fallbackData.channels || []).filter((channel: { is_im?: boolean; is_mpim?: boolean }) => {
          return channel.is_im === true || channel.is_mpim === true
        })
        
        if (fallbackDMs.length > 0) {
          console.log(`✅ Found ${fallbackDMs.length} DMs via conversations.list fallback!`)
          return fallbackDMs
        }
      }
    }
    
    // Filter to only include actual DMs and multi-party DMs
    const conversations = (data.channels || []).filter((channel: { is_im?: boolean; is_mpim?: boolean }) => {
      // Include if it's a direct message (im) or multi-party direct message (mpim)
      return channel.is_im === true || channel.is_mpim === true
    })
    
    console.log(`✅ Found ${conversations.length} personal DM conversations (filtered from ${data.channels?.length || 0} total)`)
    
    // If we still didn't find any DMs with both approaches, let's try a different strategy
    if (conversations.length === 0) {
      console.log('🔧 No DMs found with list methods, trying conversations.open approach...')
      
      // First, let's get workspace users to see who we might have DMs with
      try {
        const usersResponse = await this.makeSlackAPICall('https://slack.com/api/users.list', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${userAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            limit: 50,
          }),
        }, userId)

        const usersData = await usersResponse.json()
        
        if (usersData.ok && usersData.members) {
          console.log(`📋 Found ${usersData.members.length} workspace users`)
          
          // Filter to real users (not bots, not deleted, not the current user)
          const realUsers = usersData.members.filter((user: SlackUser) => 
            !user.is_bot && 
            !user.deleted && 
            user.id !== usersData.self?.id &&
            user.name !== 'slackbot'
          ).slice(0, 5) // Limit to first 5 for testing
          
          console.log(`👥 Testing conversations.open with ${realUsers.length} real users:`)
          realUsers.forEach((user: SlackUser, index: number) => {
            console.log(`  ${index + 1}. ${user.real_name || user.name} (${user.id})`)
          })
          
          // Try conversations.open with each user to see if DMs exist
          for (const user of realUsers) {
            try {
              const openResponse = await this.makeSlackAPICall('https://slack.com/api/conversations.open', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${userAccessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  users: user.id,
                }),
              }, userId)

              const openData = await openResponse.json()
              
              if (openData.ok && openData.channel) {
                console.log(`✅ Found DM conversation: ${openData.channel.id} with ${user.real_name || user.name}`)
                console.log(`   Channel details: is_im=${openData.channel.is_im}, created=${openData.channel.created}`)
                
                // Add this conversation to our results
                conversations.push(openData.channel)
              } else {
                console.log(`❌ No DM with ${user.real_name || user.name}: ${openData.error || 'unknown error'}`)
              }
            } catch (error) {
              console.log(`❌ Error checking DM with ${user.real_name || user.name}: ${error}`)
            }
          }
          
          if (conversations.length > 0) {
            console.log(`🎉 Found ${conversations.length} DM conversations using conversations.open!`)
          }
        }
      } catch (error) {
        console.error('❌ Error in conversations.open approach:', error)
      }
    }
    
    // Final logging
    conversations.forEach((conv: { id: string; user?: string; is_im?: boolean }, index: number) => {
      console.log(`  ${index + 1}. Conversation ${conv.id} - User: ${conv.user || 'group'} - Type: ${conv.is_im ? 'DM' : 'Group DM'}`)
    })
    
    return conversations
  }

  private async fetchSlackConversationHistory(
    accessToken: string, 
    channelId: string, 
    userId: string,
    options?: { limit?: number; since?: Date }
  ): Promise<SlackMessage[]> {
    const body: SlackHistoryRequest = {
      channel: channelId,
      limit: options?.limit || 100,
    }

    if (options?.since) {
      body.oldest = Math.floor(options.since.getTime() / 1000)
    }

    const response = await this.makeSlackAPICall('https://slack.com/api/conversations.history', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, userId)

    const data = await response.json()
    return data.ok ? data.messages || [] : []
  }

  // Convert Slack message format to our PlatformMessage format
  private convertSlackMessage(slackMessage: SlackMessage, conversation?: SlackConversation): PlatformMessage {
    return {
      id: slackMessage.ts,
      platformId: slackMessage.ts,
      content: slackMessage.text || '',
      timestamp: new Date(parseFloat(slackMessage.ts) * 1000),
      threadId: slackMessage.thread_ts || `${conversation?.id}-${slackMessage.ts}`,
      sender: {
        id: slackMessage.user || 'unknown',
        name: 'Unknown User', // We'll resolve this from users.info
        handle: slackMessage.user || 'unknown'
      },
      recipients: [], // We'll populate this based on channel/DM context
      direction: 'inbound', // We'll determine this based on the user later
      metadata: {
        channel: conversation?.id || slackMessage.channel,
        subtype: slackMessage.subtype,
        edited: slackMessage.edited,
        reactions: slackMessage.reactions,
        team: slackMessage.team
      }
    }
  }

  // Convert Slack user format to our PlatformContact format
  private convertSlackUser(slackUser: SlackUser): PlatformContact {
    return {
      id: slackUser.id,
      name: slackUser.real_name || slackUser.name || 'Unknown User',
      email: slackUser.profile?.email,
      handle: slackUser.name,
      avatar: slackUser.profile?.image_192,
      platformSpecific: {
        isBot: slackUser.is_bot,
        isAdmin: slackUser.is_admin,
        timezone: slackUser.tz,
        status: slackUser.profile?.status_text,
        deleted: slackUser.deleted
      }
    }
  }

  /**
   * Make rate-limited API call with exponential backoff
   */
  private async makeSlackAPICall(url: string, options: RequestInit, userId: string): Promise<Response> {
    const endpoint = url.split('/').pop() || 'unknown'
    const rateLimitKey = `${userId}-${endpoint}`
    
    // Check if we need to wait due to previous rate limiting
    const rateLimitInfo = this.rateLimitState.get(rateLimitKey)
    if (rateLimitInfo && Date.now() < rateLimitInfo.nextAllowedTime) {
      const waitTime = rateLimitInfo.nextAllowedTime - Date.now()
      console.log(`Rate limited for ${endpoint}, waiting ${waitTime}ms`)
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    try {
      const response = await fetch(url, options)
      
      // Check for rate limiting in response
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60')
        const currentInfo = this.rateLimitState.get(rateLimitKey) || { retryCount: 0, nextAllowedTime: 0 }
        
        // Exponential backoff: start with retry-after, then double for each subsequent retry
        const backoffMultiplier = Math.pow(2, currentInfo.retryCount)
        const waitTime = retryAfter * 1000 * backoffMultiplier
        
        console.log(`Slack API rate limited for ${endpoint}. Retry ${currentInfo.retryCount + 1}, waiting ${waitTime}ms`)
        
        this.rateLimitState.set(rateLimitKey, {
          nextAllowedTime: Date.now() + waitTime,
          retryCount: currentInfo.retryCount + 1
        })
        
        // Wait and retry (max 3 retries)
        if (currentInfo.retryCount < 3) {
          await new Promise(resolve => setTimeout(resolve, waitTime))
          return this.makeSlackAPICall(url, options, userId)
        } else {
          throw new Error(`Max retries exceeded for ${endpoint} due to rate limiting`)
        }
      }
      
      // Reset rate limit state on successful request
      if (response.ok) {
        this.rateLimitState.delete(rateLimitKey)
      }
      
      return response
    } catch (error) {
      console.error(`Slack API call failed for ${endpoint}:`, error)
      throw error
    }
  }
}

// TypeScript interfaces for Slack API responses
interface SlackMessage {
  ts: string
  thread_ts?: string
  text?: string
  user?: string
  channel?: string
  subtype?: string
  edited?: unknown
  reactions?: unknown[]
  team?: string
}

interface SlackUser {
  id: string
  name?: string
  real_name?: string
  is_bot?: boolean
  is_admin?: boolean
  tz?: string
  deleted?: boolean
  profile?: {
    email?: string
    image_192?: string
    status_text?: string
  }
}

interface SlackConversation {
  id: string
  name?: string
}

interface SlackHistoryRequest {
  channel: string
  limit: number
  oldest?: number
}

interface SlackIntegrations {
  enabled?: boolean
  team?: {
    id?: string
    name?: string
  }
  user?: {
    id?: string
    name?: string
  }
  scopes?: string[]
  connectedAt?: string
} 