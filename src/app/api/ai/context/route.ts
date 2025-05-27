import { NextRequest, NextResponse } from 'next/server'
import { analyzeEmailThread, ThreadData, ThreadAnalysis, ThreadMessage } from '@/lib/thread-processor'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const receivedThreadData: ThreadData = body.threadData
    const userEmail: string | undefined = body.userEmail
    const contactName: string | undefined = body.contactName

    if (!receivedThreadData || !receivedThreadData.id || !receivedThreadData.messages?.length || !userEmail || !contactName) {
      return NextResponse.json(
        { error: 'Invalid or incomplete data provided to /api/ai/context' },
        { status: 400 }
      )
    }

    const messagesForAnalysis: ThreadMessage[] = receivedThreadData.messages.map((msg, index) => {
      const originalTimestamp = msg.timestamp
      const convertedTimestamp = new Date(originalTimestamp)
      
      if (isNaN(convertedTimestamp.getTime())) {
        console.error(`[API /ai/context] Invalid timestamp for message at index ${index}:`, originalTimestamp, `(Contact: ${contactName}, ThreadID: ${receivedThreadData.id})`)
      }
      
      return {
        ...msg,
        timestamp: convertedTimestamp
      }
    })

    const analysisResult: ThreadAnalysis = await analyzeEmailThread(
      messagesForAnalysis,
      userEmail,
      contactName
    )
    
    return NextResponse.json(analysisResult)
  } catch (error) {
    console.error('AI Context API error (/api/ai/context):', error)
    return NextResponse.json(
      { error: 'Failed to generate AI context' },
      { status: 500 }
    )
  }
} 