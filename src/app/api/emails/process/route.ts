import { NextRequest, NextResponse } from 'next/server'
import { processEmailContent } from '@/lib/email-processor'

export async function POST(request: NextRequest) {
  try {
    const { emailContent } = await request.json()
    
    if (!emailContent || typeof emailContent !== 'string') {
      return NextResponse.json(
        { error: 'Email content is required' },
        { status: 400 }
      )
    }
    
    const processedEmail = await processEmailContent(emailContent)
    
    return NextResponse.json({
      success: true,
      data: processedEmail
    })
    
  } catch (error) {
    console.error('Email processing error:', error)
    return NextResponse.json(
      { error: 'Failed to process email' },
      { status: 500 }
    )
  }
} 