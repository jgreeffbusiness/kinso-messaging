import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/server/db'
import { gmailWebhookSetup } from '@/lib/services/gmail-webhook-setup'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') // This is our user ID
    const error = url.searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?google_error=${encodeURIComponent(error)}`
      )
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?google_error=missing_code_or_state`
      )
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?google_error=oauth_not_configured`
      )
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: GOOGLE_REDIRECT_URI,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      console.error('Google token exchange error:', tokenData.error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?google_error=${encodeURIComponent(tokenData.error)}`
      )
    }

    // Extract tokens
    const {
      access_token,
      refresh_token,
      expires_in
    } = tokenData

    // Calculate token expiry
    const tokenExpiry = expires_in 
      ? new Date(Date.now() + expires_in * 1000)
      : null

    // Update user with Google credentials
    const userId = state // Our user ID from the state parameter
    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: access_token,
        googleRefreshToken: refresh_token || null,
        googleTokenExpiry: tokenExpiry,
        googleIntegrations: {
          enabled: true,
          gmail: true,
          contacts: true,
          calendar: false, // Default to false for calendar
          scopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/contacts.readonly'
          ],
          connectedAt: new Date().toISOString(),
          gmailWatch: {
            watchActive: false,
            historyId: null,
            expiration: null,
            lastError: null,
            lastSetupAttempt: null,
            lastWebhook: null
          }
        }
      }
    })

    console.log(`Google OAuth successful for user ${userId}`)

    // ---- Start Initial Gmail Watch Setup ----
    try {
      console.log(`[GoogleCallback] Attempting initial Gmail watch setup for user ${userId}`);
      const watchResult = await gmailWebhookSetup.setupGmailWatch(userId);
      if (watchResult.success) {
        console.log(`[GoogleCallback] Initial Gmail watch successful for user ${userId}, History ID: ${watchResult.historyId}`);
      } else {
        console.error(`[GoogleCallback] Initial Gmail watch failed for user ${userId}: ${watchResult.error}`);
      }
    } catch (setupError: unknown) {
      const e = setupError as Error;
      console.error(`[GoogleCallback] Exception during initial Gmail watch setup for user ${userId}: ${e.message}`, e.stack);
    }
    // ---- End Initial Gmail Watch Setup ----

    // Redirect back to onboarding with success
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?google_success=true`
    )
  } catch (error) {
    console.error('Google OAuth callback error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?google_error=callback_failed`
    )
  }
} 