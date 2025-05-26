import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI

// Bot scopes - for workspace operations
const SLACK_BOT_SCOPES = [
  'channels:read',
  'users:read',
  'chat:write'
].join(',')

// User scopes - for personal DM access on behalf of the user
const SLACK_USER_SCOPES = [
  'channels:read',
  'im:history', 
  'im:read',
  'im:write',
  'users:read'
].join(',')

export async function GET() {
  try {
    // Verify user is authenticated
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify session token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    
    if (!SLACK_CLIENT_ID || !SLACK_REDIRECT_URI) {
      return NextResponse.json(
        { error: 'Slack OAuth not configured' },
        { status: 500 }
      )
    }

    // Generate state parameter for CSRF protection
    const state = decoded.userId // Use user ID as state for simplicity
    
    // Build Slack OAuth URL with both bot and user scopes
    const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize')
    slackAuthUrl.searchParams.set('client_id', SLACK_CLIENT_ID)
    slackAuthUrl.searchParams.set('scope', SLACK_BOT_SCOPES) // Bot scopes
    slackAuthUrl.searchParams.set('user_scope', SLACK_USER_SCOPES) // User scopes for personal DMs
    slackAuthUrl.searchParams.set('redirect_uri', SLACK_REDIRECT_URI)
    slackAuthUrl.searchParams.set('state', state)
    slackAuthUrl.searchParams.set('response_type', 'code')

    // Redirect to Slack OAuth
    return NextResponse.redirect(slackAuthUrl.toString())
  } catch (error) {
    console.error('Slack OAuth initiation error:', error)
    return NextResponse.json(
      { error: 'Failed to initiate Slack OAuth' },
      { status: 500 }
    )
  }
} 