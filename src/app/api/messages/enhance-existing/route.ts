import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { enhanceExistingMessages } from '@/lib/enhance-existing-messages'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function POST(request: NextRequest) {
  try {
    // Get session cookie
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify the token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    
    const { limit = 10 } = await request.json()
    
    const result = await enhanceExistingMessages(decoded.userId, limit)
    
    return NextResponse.json({
      success: true,
      data: result
    })
    
  } catch (error) {
    console.error('Message enhancement error:', error)
    return NextResponse.json(
      { error: 'Failed to enhance messages' },
      { status: 500 }
    )
  }
} 