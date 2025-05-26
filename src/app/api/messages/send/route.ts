import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { SlackAdapter } from '@/lib/platforms/adapters/slack'
import { prisma } from '@/server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

interface SendMessageRequest {
  platform: 'slack' | 'gmail'
  type: 'reply' | 'new'
  originalMessageId?: string // For replies
  channelId?: string // For new messages
  content: string
  subject?: string // For email
}

interface SendResult {
  success: boolean
  messageId?: string
  timestamp?: string
  error?: string
}

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify session token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    const userId = decoded.userId

    const { platform, type, originalMessageId, channelId, content }: SendMessageRequest = await request.json()

    // Validate request
    if (!platform || !type || !content) {
      return NextResponse.json({ 
        error: 'Missing required fields: platform, type, content' 
      }, { status: 400 })
    }

    if (type === 'reply' && !originalMessageId) {
      return NextResponse.json({ 
        error: 'originalMessageId required for replies' 
      }, { status: 400 })
    }

    if (type === 'new' && !channelId) {
      return NextResponse.json({ 
        error: 'channelId required for new messages' 
      }, { status: 400 })
    }

    // Route to appropriate platform
    let result: SendResult
    switch (platform) {
      case 'slack':
        result = await handleSlackMessage(userId, type, content, originalMessageId, channelId)
        break
      case 'gmail':
        // result = await handleGmailMessage(userId, type, content, originalMessageId, subject)
        return NextResponse.json({ 
          error: 'Gmail sending not yet implemented' 
        }, { status: 501 })
      default:
        return NextResponse.json({ 
          error: 'Unsupported platform' 
        }, { status: 400 })
    }

    if (result.success) {
      // Log the sent message for tracking
      console.log(`Message sent via ${platform} for user ${userId}:`, {
        type,
        messageId: result.messageId,
        timestamp: result.timestamp
      })

      // Optionally store sent message in our database for thread continuity
      await logSentMessage(userId, platform, content, result, originalMessageId)

      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        timestamp: result.timestamp,
        platform
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Send message error:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}

async function handleSlackMessage(
  userId: string, 
  type: 'reply' | 'new', 
  content: string, 
  originalMessageId?: string, 
  channelId?: string
): Promise<SendResult> {
  const slackAdapter = new SlackAdapter()

  // Check if user is authenticated with Slack
  const isAuthenticated = await slackAdapter.isAuthenticated(userId)
  if (!isAuthenticated) {
    return {
      success: false,
      error: 'User not authenticated with Slack'
    }
  }

  if (type === 'reply' && originalMessageId) {
    return await slackAdapter.replyToMessage(userId, originalMessageId, content)
  } else if (type === 'new' && channelId) {
    return await slackAdapter.sendMessage(userId, {
      channelId,
      text: content
    })
  } else {
    return {
      success: false,
      error: 'Invalid message parameters'
    }
  }
}

async function logSentMessage(
  userId: string, 
  platform: string, 
  content: string, 
  result: SendResult, 
  originalMessageId?: string
) {
  try {
    // Store sent message in our database for thread continuity
    // This helps maintain context when syncing future messages
    await prisma.message.create({
      data: {
        userId,
        contactId: 'sent', // Special marker for sent messages
        platform,
        platformMessageId: result.messageId || result.timestamp || '',
        content,
        timestamp: new Date(),
        platformData: {
          direction: 'outbound',
          sentViaKinso: true,
          originalMessageId,
          sentAt: new Date(),
          platformResponse: result
        }
      }
    })
  } catch (error) {
    console.error('Failed to log sent message:', error)
    // Don't fail the API call if logging fails
  }
} 