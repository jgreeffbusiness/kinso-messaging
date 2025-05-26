import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { gmailWebhookSetup } from '@/lib/services/gmail-webhook-setup'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

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

    if (action === 'start') {
      // Start Gmail push notifications
      const result = await gmailWebhookSetup.setupGmailWatch(userId)
      
      if (result.success) {
        return NextResponse.json({
          success: true,
          message: 'Gmail push notifications started successfully',
          historyId: result.historyId,
          watchData: result.watchResponse
        })
      } else {
        return NextResponse.json({
          success: false,
          error: result.error
        }, { status: 400 })
      }
    }

    if (action === 'stop') {
      // Stop Gmail push notifications
      const result = await gmailWebhookSetup.stopGmailWatch(userId)
      
      if (result.success) {
        return NextResponse.json({
          success: true,
          message: 'Gmail push notifications stopped'
        })
      } else {
        return NextResponse.json({
          success: false,
          error: result.error
        }, { status: 400 })
      }
    }

    if (action === 'status') {
      // Get current watch status
      const status = await gmailWebhookSetup.getWatchStatus(userId)
      return NextResponse.json({
        success: true,
        status
      })
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: start, stop, or status' },
      { status: 400 }
    )

  } catch (error) {
    console.error('❌ Gmail webhook setup error:', error)
    return NextResponse.json(
      { error: 'Failed to manage Gmail webhook' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    // Get setup instructions
    const instructions = gmailWebhookSetup.getSetupInstructions()
    
    return NextResponse.json({
      success: true,
      instructions,
      envVariables: {
        required: [
          'GOOGLE_CLOUD_PROJECT_ID',
          'GOOGLE_CLIENT_ID', 
          'GOOGLE_CLIENT_SECRET',
          'GOOGLE_REDIRECT_URI'
        ],
        example: {
          GOOGLE_CLOUD_PROJECT_ID: 'your-project-id',
          topic: 'projects/your-project-id/topics/gmail-notifications',
          webhookUrl: 'https://your-ngrok-url.ngrok.io/api/webhooks/gmail'
        }
      }
    })
  } catch (error) {
    console.error('❌ Error getting Gmail setup instructions:', error)
    return NextResponse.json(
      { error: 'Failed to get setup instructions' },
      { status: 500 }
    )
  }
} 