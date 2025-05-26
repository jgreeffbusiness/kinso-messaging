import { NextRequest, NextResponse } from 'next/server'
import { optimizedSlackSync } from '@/lib/services/optimized-slack-sync'
import { optimizedThreadingService } from '@/lib/services/optimized-message-threading'
import { contactApprovalSystem } from '@/lib/services/contact-approval-system'
import { prisma } from '@/server/db'

// Simple rate limiting to prevent duplicate webhook processing
const recentEvents = new Map<string, number>() // eventId -> timestamp

// Clean up old events every 10 minutes
setInterval(() => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000
  for (const [eventId, timestamp] of recentEvents.entries()) {
    if (timestamp < tenMinutesAgo) {
      recentEvents.delete(eventId)
    }
  }
}, 10 * 60 * 1000)

// Slack sends different event types
interface SlackEventBase {
  token: string
  team_id: string
  api_app_id: string
  event: {
    type: string
    channel?: string
    user?: string
    text?: string
    ts?: string
    thread_ts?: string
  }
  type: string
  event_id: string
  event_time: number
}

interface SlackChallenge {
  type: 'url_verification'
  challenge: string
  token: string
}

interface SlackMessageEvent extends SlackEventBase {
  event: {
    type: 'message'
    channel: string
    user: string
    text: string
    ts: string
    thread_ts?: string
    channel_type: 'im' | 'channel' | 'group'
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    console.log('🔔 Slack webhook received:', {
      type: body.type,
      eventType: body.event?.type,
      channelType: body.event?.channel_type,
      user: body.event?.user,
      teamId: body.team_id
    })

    // Handle Slack URL verification (one-time setup)
    if (body.type === 'url_verification') {
      console.log('✅ Slack URL verification challenge')
      return NextResponse.json({ challenge: (body as SlackChallenge).challenge })
    }

    // Handle message events
    if (body.type === 'event_callback' && body.event?.type === 'message') {
      const event = body as SlackMessageEvent
      
      // Check for duplicate events (Slack sometimes sends duplicates)
      const eventKey = `${event.team_id}:${event.event.channel}:${event.event.ts}`
      const now = Date.now()
      
      if (recentEvents.has(eventKey)) {
        console.log(`⏭️ Skipping duplicate event: ${eventKey}`)
        return NextResponse.json({ status: 'duplicate_ignored' })
      }
      
      // Record this event to prevent duplicates
      recentEvents.set(eventKey, now)
      
      // Only process DM messages (not channels/groups)
      if (event.event.channel_type !== 'im') {
        console.log(`⏭️ Skipping non-DM message in ${event.event.channel_type}`)
        return NextResponse.json({ status: 'ignored' })
      }

      // Don't process bot messages
      if (event.event.user?.startsWith('B') || event.event.text?.includes('has joined')) {
        console.log('⏭️ Skipping bot/system message')
        return NextResponse.json({ status: 'ignored' })
      }

      // Find user by Slack team ID
      const user = await prisma.user.findFirst({
        where: {
          slackTeamId: event.team_id
        },
        select: {
          id: true,
          email: true
        }
      })

      if (!user) {
        console.log(`❌ No user found for Slack team ${event.team_id}`)
        return NextResponse.json({ status: 'user_not_found' })
      }

      console.log(`📨 New DM detected for user ${user.email} (${user.id})`)
      console.log(`   From: ${event.event.user}`)
      console.log(`   Channel: ${event.event.channel}`)
      console.log(`   Text: ${event.event.text?.substring(0, 50)}...`)

      // DEMO: Process message through new contact approval system
      const approvalResult = await contactApprovalSystem.processIncomingMessage({
        userId: user.id,
        platform: 'slack',
        sender: {
          handle: event.event.user,
          name: 'Unknown User' // Would be resolved from Slack user info
        },
        content: event.event.text || '',
        timestamp: new Date(parseInt(event.event.ts) * 1000),
        platformMessageId: event.event.ts
      })

      console.log(`🎯 Contact Approval System Result:`, {
        action: approvalResult.action,
        reason: approvalResult.reason,
        contactId: approvalResult.contactId,
        pendingId: approvalResult.pendingId
      })

      // Continue with existing sync logic for now
      // Trigger targeted sync for just this specific conversation
      const syncResult = await optimizedSlackSync.syncSpecificChannel(
        user.id, 
        event.event.channel,
        `webhook:new_message:${event.event.user}`
      )

      // Notify threading service only if we actually got new messages
      if (syncResult.success && syncResult.newMessages > 0) {
        await optimizedThreadingService.onNewMessages(user.id, syncResult.newMessages)
        
        // Invalidate frontend cache to show new messages immediately
        console.log(`🔄 Invalidating frontend cache for ${syncResult.newMessages} new messages`)
        // Note: In a production setup, you'd want to use Redis pub/sub or WebSockets
        // For now, the frontend will pick up changes on next natural refresh or manual refetch
      }

      return NextResponse.json({ 
        status: 'processed',
        userId: user.id,
        messageChannel: event.event.channel,
        newMessages: syncResult.newMessages
      })
    }

    // Handle other event types
    console.log(`⏭️ Unhandled event type: ${body.type}/${body.event?.type}`)
    return NextResponse.json({ status: 'ignored' })

  } catch (error) {
    console.error('❌ Slack webhook error:', error)
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
    service: 'slack-webhook',
    timestamp: new Date().toISOString()
  })
} 