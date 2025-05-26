import { google } from 'googleapis'
import { prisma } from '@/server/db'

interface GoogleError {
  code?: number
  message?: string
}

interface WatchResponse {
  historyId?: string | null
  expiration?: string | null
}

export class GmailWebhookSetupService {
  
  /**
   * Set up Gmail push notifications for a user
   */
  async setupGmailWatch(userId: string): Promise<{
    success: boolean
    watchResponse?: WatchResponse
    error?: string
    historyId?: string
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          googleAccessToken: true,
          googleRefreshToken: true
        }
      })

      if (!user?.googleAccessToken) {
        return {
          success: false,
          error: 'User not authenticated with Google'
        }
      }

      // Set up OAuth2 client
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      )

      oauth2Client.setCredentials({
        access_token: user.googleAccessToken,
        refresh_token: user.googleRefreshToken
      })

      // Initialize Gmail API
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

      // Set up watch request
      const watchRequest = {
        userId: 'me',
        requestBody: {
          labelIds: ['INBOX'], // Watch only inbox
          topicName: `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/gmail-notifications`,
          labelFilterBehavior: 'INCLUDE' // Only include messages with these labels
        }
      }

      console.log('🔍 Setting up Gmail watch for user:', user.email)
      console.log('📡 Topic name:', watchRequest.requestBody.topicName)

      // Call Gmail watch API
      const response = await gmail.users.watch(watchRequest)

      console.log('✅ Gmail watch setup successful:', {
        historyId: response.data.historyId,
        expiration: response.data.expiration
      })

      // Store the history ID for incremental sync
      await this.storeWatchData(userId, {
        historyId: response.data.historyId || '',
        expiration: response.data.expiration || '',
        watchActive: true
      })

      return {
        success: true,
        watchResponse: response.data,
        historyId: response.data.historyId || undefined
      }

    } catch (error) {
      console.error('❌ Gmail watch setup failed:', error)
      
      const googleError = error as GoogleError
      let errorMessage = 'Unknown error'
      if (googleError.code === 400) {
        errorMessage = 'Invalid topic name or permissions issue'
      } else if (googleError.code === 403) {
        errorMessage = 'Insufficient permissions or Pub/Sub not set up correctly'
      } else if (googleError.message) {
        errorMessage = googleError.message
      }

      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Stop Gmail push notifications for a user
   */
  async stopGmailWatch(userId: string): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          googleAccessToken: true,
          googleRefreshToken: true
        }
      })

      if (!user?.googleAccessToken) {
        return {
          success: false,
          error: 'User not authenticated with Google'
        }
      }

      // Set up OAuth2 client
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      )

      oauth2Client.setCredentials({
        access_token: user.googleAccessToken,
        refresh_token: user.googleRefreshToken
      })

      // Initialize Gmail API
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

      // Stop watching
      await gmail.users.stop({ userId: 'me' })

      console.log('🛑 Gmail watch stopped for user:', user.email)

      // Update watch data
      await this.storeWatchData(userId, {
        historyId: '',
        expiration: '',
        watchActive: false
      })

      return { success: true }

    } catch (error) {
      console.error('❌ Gmail watch stop failed:', error)
      const googleError = error as GoogleError
      return {
        success: false,
        error: googleError.message || 'Unknown error'
      }
    }
  }

  /**
   * Check if Gmail watch is active for a user
   */
  async getWatchStatus(userId: string): Promise<{
    isActive: boolean
    historyId?: string
    expiration?: string
    lastUpdate?: Date
  }> {
    // In a full implementation, you'd store this in the database
    // For now, we'll check if the user has Google access
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        // You'd add these fields to your schema:
        // gmailWatchHistoryId: true,
        // gmailWatchExpiration: true,
        // gmailWatchActive: true,
        // gmailWatchUpdated: true
      }
    })

    return {
      isActive: !!user?.googleAccessToken,
      historyId: undefined, // Would come from database
      expiration: undefined,
      lastUpdate: undefined
    }
  }

  /**
   * Get setup instructions for the UI
   */
  getSetupInstructions(): {
    steps: string[]
    commands: string[]
    requirements: string[]
  } {
    return {
      requirements: [
        '🔑 Google Cloud Project with billing enabled',
        '📧 Gmail API already enabled',
        '📡 Cloud Pub/Sub API enabled',
        '🌐 Ngrok tunnel running (for local development)',
        '⚙️ Proper IAM permissions configured'
      ],
      steps: [
        '1. Enable Cloud Pub/Sub API in Google Cloud Console',
        '2. Create Pub/Sub topic: gmail-notifications',
        '3. Create push subscription to your webhook URL',
        '4. Set IAM permissions for Gmail API service account',
        '5. Call Gmail watch() API to start notifications',
        '6. Test by sending yourself an email'
      ],
      commands: [
        '# Create topic',
        'gcloud pubsub topics create gmail-notifications',
        '',
        '# Create subscription (replace YOUR_NGROK_URL)',
        `gcloud pubsub subscriptions create gmail-webhook-subscription \\`,
        `  --topic=gmail-notifications \\`,
        `  --push-endpoint=https://YOUR_NGROK_URL.ngrok.io/api/webhooks/gmail`,
        '',
        '# Set IAM permissions',
        'gcloud pubsub topics add-iam-policy-binding gmail-notifications \\',
        '  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \\',
        '  --role=roles/pubsub.publisher'
      ]
    }
  }

  /**
   * Store watch data in database (placeholder)
   */
  private async storeWatchData(userId: string, data: {
    historyId: string
    expiration: string
    watchActive: boolean
  }): Promise<void> {
    // In a full implementation, you'd update the user record:
    // await prisma.user.update({
    //   where: { id: userId },
    //   data: {
    //     gmailWatchHistoryId: data.historyId,
    //     gmailWatchExpiration: data.expiration,
    //     gmailWatchActive: data.watchActive,
    //     gmailWatchUpdated: new Date()
    //   }
    // })
    
    console.log(`💾 Would store Gmail watch data for user ${userId}:`, data)
  }

  /**
   * Process incremental Gmail sync using history API
   */
  async processHistoryUpdate(userId: string, historyId: string): Promise<{
    success: boolean
    newMessages: number
    error?: string
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          googleAccessToken: true,
          googleRefreshToken: true
        }
      })

      if (!user?.googleAccessToken) {
        return {
          success: false,
          newMessages: 0,
          error: 'User not authenticated'
        }
      }

      // Set up OAuth2 client
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      )

      oauth2Client.setCredentials({
        access_token: user.googleAccessToken,
        refresh_token: user.googleRefreshToken
      })

      // Initialize Gmail API
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

      // Get history since the last known historyId
      const historyResponse = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: historyId,
        labelId: 'INBOX'
      })

      const history = historyResponse.data.history || []
      console.log(`📧 Found ${history.length} history items since ${historyId}`)

      // Process new messages
      let newMessages = 0
      for (const historyItem of history) {
        if (historyItem.messagesAdded) {
          newMessages += historyItem.messagesAdded.length
          // Here you'd process each new message
          console.log(`📨 ${historyItem.messagesAdded.length} new messages added`)
        }
      }

      return {
        success: true,
        newMessages
      }

    } catch (error) {
      console.error('❌ Gmail history processing failed:', error)
      const googleError = error as GoogleError
      return {
        success: false,
        newMessages: 0,
        error: googleError.message
      }
    }
  }
}

export const gmailWebhookSetup = new GmailWebhookSetupService() 