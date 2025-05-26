import { NextRequest, NextResponse } from 'next/server'

/**
 * General webhook endpoint that routes to platform-specific handlers
 * This allows external services to use a single webhook URL while
 * internally routing to the correct platform handler
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const userAgent = request.headers.get('user-agent') || ''
    const contentType = request.headers.get('content-type') || ''
    
    console.log('🔔 General webhook received:', {
      userAgent,
      contentType,
      bodyType: body.type,
      bodyKeys: Object.keys(body)
    })

    // Route Slack webhooks
    if (isSlackWebhook(body, userAgent)) {
      console.log('🔀 Routing to Slack webhook handler')
      
      // Create a new request with the same body and headers
      const newRequest = new NextRequest(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(body)
      })
      
      // Import and call the Slack webhook handler
      const { POST: handleSlackWebhook } = await import('../webhooks/slack/route')
      return await handleSlackWebhook(newRequest)
    }

    // Route Gmail webhooks
    if (isGmailWebhook(body, userAgent, contentType)) {
      console.log('🔀 Routing to Gmail webhook handler')
      
      // Create a new request with the same body and headers
      const newRequest = new NextRequest(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(body)
      })
      
      // Import and call the Gmail webhook handler  
      const { POST: handleGmailWebhook } = await import('../webhooks/gmail/route')
      return await handleGmailWebhook(newRequest)
    }

    // Unknown webhook type
    console.log('❓ Unknown webhook type:', {
      userAgent,
      bodyType: body.type,
      bodyKeys: Object.keys(body).slice(0, 5)
    })

    return NextResponse.json({ 
      status: 'unknown_webhook_type',
      message: 'Unable to determine platform for webhook'
    }, { status: 400 })

  } catch (error) {
    console.error('❌ General webhook error:', error)
    return NextResponse.json(
      { error: 'Webhook routing failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
  // Health check endpoint
  return NextResponse.json({ 
    status: 'active',
    service: 'general-webhook-router',
    timestamp: new Date().toISOString(),
    supportedPlatforms: ['slack', 'gmail']
  })
}

/**
 * Detect if this is a Slack webhook
 */
function isSlackWebhook(body: Record<string, unknown>, userAgent: string): boolean {
  // Slack webhooks have these characteristics:
  return (
    // Slack sends these event types
    (body.type === 'url_verification' || body.type === 'event_callback') ||
    // Slack challenge parameter
    !!body.challenge ||
    // Slack team_id field
    !!body.team_id ||
    // Slack user agent
    userAgent.includes('Slackbot')
  )
}

/**
 * Detect if this is a Gmail webhook
 */
function isGmailWebhook(body: Record<string, unknown>, userAgent: string, contentType: string): boolean {
  // Gmail Push notifications have these characteristics:
  return (
    // Gmail sends Pub/Sub messages
    !!body.message ||
    // Google user agent
    userAgent.includes('Google') ||
    // Pub/Sub content type
    contentType.includes('application/json') && !!body.subscription
  )
} 