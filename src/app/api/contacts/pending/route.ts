import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { contactApprovalSystem } from '@/lib/services/contact-approval-system'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

/**
 * Get pending contact approvals for the authenticated user
 */
export async function GET() {
  try {
    // Verify authentication
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized - no session cookie' }, { status: 401 })
    }

    let decoded
    try {
      decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError)
      return NextResponse.json({ error: 'Unauthorized - invalid session' }, { status: 401 })
    }

    const userId = decoded.userId
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - missing userId' }, { status: 401 })
    }

    const pendingApprovals = await contactApprovalSystem.getPendingApprovals(userId)
    
    return NextResponse.json({
      success: true,
      pending: pendingApprovals,
      count: pendingApprovals.length
    })

  } catch (error) {
    console.error('Error getting pending approvals:', error)
    return NextResponse.json(
      { error: 'Failed to get pending approvals' },
      { status: 500 }
    )
  }
}

/**
 * Handle approval decision (approve or reject pending contact)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized - no session cookie' }, { status: 401 })
    }

    let decoded
    try {
      decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError)
      return NextResponse.json({ error: 'Unauthorized - invalid session' }, { status: 401 })
    }

    const userId = decoded.userId
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - missing userId' }, { status: 401 })
    }

    const { pendingId, decision } = await request.json()
    
    if (!pendingId || !['approve', 'reject'].includes(decision)) {
      return NextResponse.json(
        { error: 'Invalid pendingId or decision' },
        { status: 400 }
      )
    }

    const result = await contactApprovalSystem.handleApprovalDecision(
      userId,
      pendingId,
      decision
    )

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to process approval decision' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      decision,
      contactId: result.contactId,
      messagesImported: result.messagesImported,
      message: decision === 'approve' 
        ? `Contact approved and ${result.messagesImported || 0} messages imported`
        : 'Contact rejected and sender blacklisted'
    })

  } catch (error) {
    console.error('Error handling approval decision:', error)
    return NextResponse.json(
      { error: 'Failed to handle approval decision' },
      { status: 500 }
    )
  }
} 