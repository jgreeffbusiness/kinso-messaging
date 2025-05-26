import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

/**
 * Cache invalidation endpoint - signals frontend to refresh data
 * This can be called by webhooks or other server processes when new data arrives
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify session token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    const userId = decoded.userId

    const body = await request.json()
    const { resource } = body // e.g., 'messages', 'contacts', etc.

    console.log(`🔄 Cache invalidation requested for user ${userId}, resource: ${resource}`)

    // For now, just log the invalidation request
    // In a production setup, this would:
    // 1. Use Redis pub/sub to notify connected clients
    // 2. Or use WebSockets/Server-Sent Events to push updates
    // 3. Or use a service like Pusher for real-time updates

    return NextResponse.json({
      success: true,
      userId,
      resource,
      timestamp: new Date().toISOString(),
      message: 'Cache invalidation logged - frontend will refresh on next interaction'
    })

  } catch (error) {
    console.error('Cache invalidation error:', error)
    return NextResponse.json(
      { error: 'Failed to invalidate cache' },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint to check if there are pending cache invalidations
 * Frontend can poll this to know when to refresh
 */
export async function GET() {
  try {
    // Verify authentication
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify session token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    const userId = decoded.userId

    // For now, return that no invalidations are pending
    // In production, this would check Redis or a cache invalidation queue
    return NextResponse.json({
      pendingInvalidations: [],
      lastCheck: new Date().toISOString(),
      userId
    })

  } catch (error) {
    console.error('Cache check error:', error)
    return NextResponse.json(
      { error: 'Failed to check cache status' },
      { status: 500 }
    )
  }
} 