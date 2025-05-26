import { NextResponse } from 'next/server'
import { getCurrentUser, verifyAuth } from '@/lib/auth'

/**
 * Get current authenticated user information
 */
export async function GET() {
  try {
    // Verify authentication
    const authUser = await verifyAuth()
    
    if (!authUser) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Get full user details
    const user = await getCurrentUser()
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Return user data (excluding sensitive tokens)
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        authId: user.authId,
        email: user.email,
        name: user.name,
        photoUrl: user.photoUrl,
        hasGoogleIntegration: !!user.googleAccessToken,
        hasSlackIntegration: !!user.slackAccessToken,
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    console.error('❌ Failed to get current user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 