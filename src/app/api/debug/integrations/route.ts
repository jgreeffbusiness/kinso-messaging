import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { prisma } from '@/server/db'

export async function GET() {
  try {
    const authUser = await verifyAuth()
    
    if (!authUser) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get user with all integration fields
    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      select: {
        id: true,
        googleAccessToken: true,
        googleTokenExpiry: true,
        googleIntegrations: true,
        slackAccessToken: true,
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const integrationStatus = {
      userId: user.id,
      google: {
        hasToken: !!user.googleAccessToken,
        tokenExpiry: user.googleTokenExpiry,
        isExpired: user.googleTokenExpiry ? new Date(user.googleTokenExpiry) <= new Date() : null,
        integrations: user.googleIntegrations || {},
        gmailEnabled: user.googleIntegrations && 
                     typeof user.googleIntegrations === 'object' && 
                     !Array.isArray(user.googleIntegrations) &&
                     'gmail' in user.googleIntegrations &&
                     user.googleIntegrations.gmail === true
      },
      slack: {
        hasToken: !!user.slackAccessToken,
        // Slack tokens typically don't expire
      },
      shouldAutoSync: false
    }

    // Determine if this user should be auto-synced
    integrationStatus.shouldAutoSync = (
      // Gmail: valid token + enabled integration
      (integrationStatus.google.hasToken && 
       !integrationStatus.google.isExpired && 
       integrationStatus.google.gmailEnabled) ||
      // Slack: has token
      integrationStatus.slack.hasToken
    )

    return NextResponse.json(integrationStatus)
  } catch (error) {
    console.error('Failed to get integration status:', error)
    return NextResponse.json(
      { error: 'Failed to get integration status' },
      { status: 500 }
    )
  }
} 