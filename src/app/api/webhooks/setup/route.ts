import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { webhookManager } from '@/lib/services/webhook-management'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function GET() {
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

    // Get webhook setup instructions and status
    const instructions = webhookManager.getSetupInstructions()
    const status = await webhookManager.getWebhookStatus()
    const pollingSchedule = await webhookManager.optimizePollingSchedule(userId)
    const slackSetup = await webhookManager.setupSlackWebhook()
    const gmailSetup = await webhookManager.setupGmailWebhook(userId)

    return NextResponse.json({
      success: true,
      instructions,
      status,
      pollingSchedule,
      setup: {
        slack: slackSetup,
        gmail: gmailSetup
      }
    })

  } catch (error) {
    console.error('❌ Error getting webhook setup:', error)
    return NextResponse.json(
      { error: 'Failed to get webhook setup' },
      { status: 500 }
    )
  }
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

    const body = await request.json()
    const action = body.action

    if (action === 'test') {
      // Test webhook endpoints
      const testResults = await webhookManager.testWebhooks()
      return NextResponse.json({
        success: true,
        testResults
      })
    }

    if (action === 'optimize_polling') {
      // Update polling schedule based on webhook availability
      const schedule = await webhookManager.optimizePollingSchedule(userId)
      return NextResponse.json({
        success: true,
        schedule,
        message: schedule.webhooksEnabled 
          ? 'Polling frequency reduced due to webhook availability'
          : 'Polling frequency maintained - webhooks not fully configured'
      })
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    )

  } catch (error) {
    console.error('❌ Error in webhook setup action:', error)
    return NextResponse.json(
      { error: 'Failed to execute webhook action' },
      { status: 500 }
    )
  }
} 