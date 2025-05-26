import { NextRequest, NextResponse } from 'next/server'
import { generateAIContext, ThreadData } from '@/lib/ai-context'

export async function POST(request: NextRequest) {
  try {
    const threadData: ThreadData = await request.json()
    
    if (!threadData.id || !threadData.messages?.length) {
      return NextResponse.json(
        { error: 'Invalid thread data provided' },
        { status: 400 }
      )
    }

    const context = await generateAIContext(threadData)
    
    return NextResponse.json(context)
  } catch (error) {
    console.error('AI Context API error:', error)
    return NextResponse.json(
      { error: 'Failed to generate AI context' },
      { status: 500 }
    )
  }
} 