import { NextRequest, NextResponse } from 'next/server'
import { enhanceMessage } from '@/lib/message-enhancer'

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json()
    
    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }
    
    const enhancedMessage = await enhanceMessage(message)
    
    return NextResponse.json({
      success: true,
      data: enhancedMessage
    })
    
  } catch (error) {
    console.error('Message enhancement error:', error)
    return NextResponse.json(
      { error: 'Failed to enhance message' },
      { status: 500 }
    )
  }
} 