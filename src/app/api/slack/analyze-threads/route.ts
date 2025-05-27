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

    // Group messages by conversation (contact + time proximity)
    const conversationsMap = new Map<string, typeof messages>()
    
    for (const message of messages) {
      // Group by contact - all messages with same contact become one conversation
      const conversationKey = `slack_conversation_${message.contactId}`
      
      if (!conversationsMap.has(conversationKey)) {
        conversationsMap.set(conversationKey, [])
      }
      conversationsMap.get(conversationKey)!.push(message)
    }

    const threadAnalyses = []

    // Analyze each conversation
    for (const [conversationKey, conversationMessages] of conversationsMap) {
      if (conversationMessages.length === 0) continue

      // Sort messages chronologically
      const sortedMessages = conversationMessages.sort((a, b) => 
        a.timestamp.getTime() - b.timestamp.getTime()
      )

      // Convert to thread processor format
      const formattedMessages = sortedMessages.map(msg => {
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
          subject: `Slack conversation with ${contact.fullName}`,
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
          conversationKey,
          messageCount: conversationMessages.length,
          analysis,
          lastActivity: sortedMessages[sortedMessages.length - 1].timestamp
        })

        // Store the analysis as a summary message that will be picked up by threading logic
        const summaryId = `slack_thread_summary_${conversationKey}`
        
        const existingSummary = await prisma.message.findFirst({
          where: {
            userId: decoded.userId,
            contactId,
            platformMessageId: summaryId
          }
        })

        const summaryData = {
          content: analysis.summary,
          timestamp: new Date(),
          platformData: {
            isThreadSummary: true,
            threadId: conversationKey,
            analysis: JSON.parse(JSON.stringify(analysis)),
            messageCount: conversationMessages.length,
            platform: 'slack'
          }
        }

        if (existingSummary) {
          // Update existing summary
          await prisma.message.update({
            where: { id: existingSummary.id },
            data: summaryData
          })
        } else {
          // Create new summary
          await prisma.message.create({
            data: {
              userId: decoded.userId,
              contactId,
              platform: 'slack_thread_summary',
              platformMessageId: summaryId,
              ...summaryData
            }
          })
        }

      } catch (analysisError) {
        console.error(`Error analyzing conversation ${conversationKey}:`, analysisError)
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