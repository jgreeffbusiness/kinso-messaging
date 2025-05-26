import { NextRequest, NextResponse } from 'next/server'
import { optimizedThreadingService } from '@/lib/services/optimized-message-threading'
import { gmailWebhookSetup } from '@/lib/services/gmail-webhook-setup'
import { prisma } from '@/server/db'

// Gmail Push Notification format
interface GmailPushNotification {
  message: {
    data: string // Base64-encoded JSON
    messageId: string
    publishTime: string
  }
  subscription: string
}

interface GmailHistoryData {
  emailAddress: string
  historyId: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as GmailPushNotification
    
    console.log('📧 Gmail webhook received:', {
      messageId: body.message?.messageId,
      subscription: body.subscription,
      publishTime: body.message?.publishTime
    })

    if (!body.message?.data) {
      console.log('⏭️ No message data in Gmail webhook')
      return NextResponse.json({ status: 'ignored' })
    }

    // Decode the base64 data
    const decodedData = JSON.parse(
      Buffer.from(body.message.data, 'base64').toString('utf-8')
    ) as GmailHistoryData

    console.log('📧 Decoded Gmail notification:', {
      emailAddress: decodedData.emailAddress,
      historyId: decodedData.historyId
    })

    // Find user by email address
    const user = await prisma.user.findFirst({
      where: {
        email: decodedData.emailAddress
      },
      select: {
        id: true,
        email: true,
        googleAccessToken: true
      }
    })

    if (!user) {
      console.log(`❌ No user found for email ${decodedData.emailAddress}`)
      return NextResponse.json({ status: 'user_not_found' })
    }

    if (!user.googleAccessToken) {
      console.log(`❌ User ${user.email} has no Google access token`)
      return NextResponse.json({ status: 'no_auth' })
    }

    console.log(`📧 New email activity detected for user ${user.email} (${user.id})`)
    console.log(`   History ID: ${decodedData.historyId}`)

    // Process incremental sync using the history ID
    const historyResult = await gmailWebhookSetup.processHistoryUpdate(
      user.id, 
      decodedData.historyId
    )

    if (historyResult.success && historyResult.newMessages > 0) {
      console.log(`📨 Processed ${historyResult.newMessages} new emails`)
      
      // Notify threading service of new messages
      await optimizedThreadingService.onNewMessages(user.id, historyResult.newMessages)
    } else if (!historyResult.success) {
      console.log(`❌ History processing failed: ${historyResult.error}`)
    }

    return NextResponse.json({ 
      status: 'processed',
      userId: user.id,
      historyId: decodedData.historyId,
      newMessages: historyResult.newMessages,
      processingSuccess: historyResult.success
    })

  } catch (error) {
    console.error('❌ Gmail webhook error:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
  // Health check endpoint
  return NextResponse.json({ 
    status: 'active',
    service: 'gmail-webhook',
    timestamp: new Date().toISOString(),
    setup: {
      required: [
        'Google Cloud Pub/Sub topic created',
        'Subscription configured to this endpoint',
        'IAM permissions set for Gmail API service account',
        'Gmail watch() API called for user'
      ],
      endpoint: '/api/webhooks/gmail',
      setupEndpoint: '/api/webhooks/gmail/setup'
    }
  })
} 