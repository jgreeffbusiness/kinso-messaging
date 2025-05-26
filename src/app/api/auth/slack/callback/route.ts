import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/server/db'

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') // This is our user ID
    const error = url.searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('Slack OAuth error:', error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?slack_error=${encodeURIComponent(error)}`
      )
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?slack_error=missing_code_or_state`
      )
    }

    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !SLACK_REDIRECT_URI) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?slack_error=oauth_not_configured`
      )
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: SLACK_REDIRECT_URI,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (!tokenData.ok) {
      console.error('Slack token exchange error:', tokenData.error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?slack_error=${encodeURIComponent(tokenData.error)}`
      )
    }

    // Extract token and team info
    const {
      access_token,
      refresh_token,
      team,
      authed_user,
      expires_in
    } = tokenData

    // Log the full token response for debugging
    console.log('Slack OAuth tokens received:', {
      hasBotToken: !!access_token,
      hasUserToken: !!authed_user?.access_token,
      userScopes: authed_user?.scope,
      teamScopes: tokenData.scope
    })

    // Calculate token expiry (if provided)
    const tokenExpiry = expires_in 
      ? new Date(Date.now() + expires_in * 1000)
      : null

    // Update user with Slack credentials
    const userId = state // Our user ID from the state parameter
    await prisma.user.update({
      where: { id: userId },
      data: {
        slackAccessToken: access_token, // Bot token for workspace operations
        slackRefreshToken: refresh_token || null,
        slackTokenExpiry: tokenExpiry,
        slackTeamId: team?.id || null,
        slackUserId: authed_user?.id || null,
        slackIntegrations: {
          enabled: true,
          team: {
            id: team?.id,
            name: team?.name
          },
          user: {
            id: authed_user?.id,
            name: authed_user?.name
          },
          tokens: {
            botToken: access_token,
            userToken: authed_user?.access_token || null, // User token for personal DMs
          },
          scopes: tokenData.scope?.split(',') || [],
          userScopes: authed_user?.scope?.split(',') || [],
          connectedAt: new Date().toISOString()
        }
      }
    })

    console.log(`Slack OAuth successful for user ${userId}, team: ${team?.name}`)

    // Redirect back to settings with success
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?slack_success=true`
    )
  } catch (error) {
    console.error('Slack OAuth callback error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?slack_error=callback_failed`
    )
  }
} 