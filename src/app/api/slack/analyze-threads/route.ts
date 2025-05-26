import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@/server/db'
import { analyzeEmailThread } from '@/lib/thread-processor'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function POST(request: NextRequest) {
  try {
    // Verify user authentication
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    const { contactId } = await request.json()

    if (!contactId) {
      return NextResponse.json({ error: 'Contact ID required' }, { status: 400 })
    }

    // Get user and contact info
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { email: true, slackUserId: true }
    })

    const contact = await prisma.contact.findUnique({
      where: { id: contactId, userId: decoded.userId },
      select: { fullName: true, email: true }
    })

    if (!user?.email || !contact) {
      return NextResponse.json({ error: 'User or contact not found' }, { status: 404 })
    }

    // Get all Slack messages for this contact
    const messages = await prisma.message.findMany({
      where: {
        userId: decoded.userId,
        contactId,
        platform: 'slack'
      },
      orderBy: { timestamp: 'asc' }
    })

    if (messages.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No Slack messages found for this contact' 
      })
    }

    // Group messages by thread ID (extract from platformData)
    const threadsMap = new Map<string, typeof messages>()
    
    for (const message of messages) {
      let threadId = 'default_thread'
      
      // Try to extract thread ID from platformData
      if (message.platformData && typeof message.platformData === 'object') {
        const data = message.platformData as Record<string, unknown>
        threadId = (data.threadId as string) || (data.thread_ts as string) || threadId
      }
      
      if (!threadsMap.has(threadId)) {
        threadsMap.set(threadId, [])
      }
      threadsMap.get(threadId)!.push(message)
    }

    const threadAnalyses = []

    // Analyze each thread
    for (const [threadId, threadMessages] of threadsMap) {
      if (threadMessages.length === 0) continue

      // Convert to thread processor format
      const formattedMessages = threadMessages.map(msg => {
        // Extract sender info from platformData
        let from = user.email || 'unknown@example.com'
        let isFromUser = true
        
        if (msg.platformData && typeof msg.platformData === 'object') {
          const data = msg.platformData as Record<string, unknown>
          const senderId = (data.sender as string) || (data.user as string)
          
          // Check if sender is the current user
          isFromUser = senderId === user.slackUserId || 
                      from.toLowerCase().includes((user.email || '').toLowerCase())
          
          // Use sender ID or fallback to email
          from = senderId || from
        }

        return {
          id: msg.platformMessageId,
          from: from,
          to: [contact.email || 'slack-contact'],
          subject: `Slack conversation`, // Slack doesn't have subjects
          content: msg.content,
          timestamp: msg.timestamp,
          direction: isFromUser ? 'outbound' as const : 'inbound' as const,
          isFromUser
        }
      })

      try {
        const analysis = await analyzeEmailThread(
          formattedMessages,
          user.email || 'unknown@example.com',
          contact.fullName
        )

        threadAnalyses.push({
          threadId,
          messageCount: threadMessages.length,
          analysis,
          lastActivity: threadMessages[threadMessages.length - 1].timestamp
        })

        // Store the analysis as a summary message
        const existingSummary = await prisma.message.findFirst({
          where: {
            userId: decoded.userId,
            contactId,
            platformMessageId: `slack_thread_summary_${threadId}`
          }
        })

        if (existingSummary) {
          // Update existing summary
          await prisma.message.update({
            where: { id: existingSummary.id },
            data: {
              content: analysis.threadSummary,
              timestamp: new Date(),
              platformData: {
                isThreadSummary: true,
                threadId,
                analysis: JSON.parse(JSON.stringify(analysis)),
                messageCount: threadMessages.length,
                platform: 'slack'
              }
            }
          })
        } else {
          // Create new summary
          await prisma.message.create({
            data: {
              userId: decoded.userId,
              contactId,
              platform: 'slack_thread_summary',
              platformMessageId: `slack_thread_summary_${threadId}`,
              content: analysis.threadSummary,
              timestamp: new Date(),
              platformData: {
                isThreadSummary: true,
                threadId,
                analysis: JSON.parse(JSON.stringify(analysis)),
                messageCount: threadMessages.length,
                platform: 'slack'
              }
            }
          })
        }

      } catch (analysisError) {
        console.error(`Error analyzing Slack thread ${threadId}:`, analysisError)
        continue
      }
    }

    return NextResponse.json({
      success: true,
      threadsAnalyzed: threadAnalyses.length,
      analyses: threadAnalyses
    })

  } catch (error) {
    console.error('Slack thread analysis error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze Slack threads' },
      { status: 500 }
    )
  }
} 