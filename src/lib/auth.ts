import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export interface AuthUser {
  userId: string
  authId: string
  email: string
}

/**
 * Verify authentication from request cookies
 * Returns user data if authenticated, null if not
 */
export async function verifyAuth(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return null
    }

    // Verify JWT token
    const decoded = verify(sessionCookie, JWT_SECRET) as {
      userId: string
      authId: string
      email: string
      iat: number
      exp: number
    }
    
    // Validate that user still exists in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, authId: true, email: true }
    })
    
    if (!user) {
      return null
    }
    
    return {
      userId: user.id,
      authId: user.authId,
      email: user.email || ''
    }
  } catch (error) {
    console.error('Auth verification failed:', error)
    return null
  }
}

/**
 * Get current authenticated user with full details
 */
export async function getCurrentUser() {
  try {
    const authUser = await verifyAuth()
    if (!authUser) return null
    
    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      select: {
        id: true,
        authId: true,
        email: true,
        name: true,
        photoUrl: true,
        googleAccessToken: true,
        googleTokenExpiry: true,
        slackAccessToken: true,
        slackTokenExpiry: true,
        createdAt: true
      }
    })
    
    return user
  } catch (error) {
    console.error('Failed to get current user:', error)
    return null
  }
}

/**
 * Check if user has valid Google integration
 */
export async function hasValidGoogleAuth(userId: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        googleAccessToken: true, 
        googleTokenExpiry: true 
      }
    })
    
    if (!user?.googleAccessToken) return false
    
    // Check if token is expired
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      return false
    }
    
    return true
  } catch (error) {
    console.error('Error checking Google auth:', error)
    return false
  }
}

/**
 * Check if user has valid Slack integration
 */
export async function hasValidSlackAuth(userId: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        slackAccessToken: true, 
        slackTokenExpiry: true 
      }
    })
    
    if (!user?.slackAccessToken) return false
    
    // Check if token is expired
    if (user.slackTokenExpiry && user.slackTokenExpiry < new Date()) {
      return false
    }
    
    return true
  } catch (error) {
    console.error('Error checking Slack auth:', error)
    return false
  }
} 