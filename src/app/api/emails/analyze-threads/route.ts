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
      select: { email: true }
    })

    const contact = await prisma.contact.findUnique({
      where: { id: contactId, userId: decoded.userId },
      select: { fullName: true, email: true }
    })

    if (!user?.email || !contact) {
      return NextResponse.json({ error: 'User or contact not found' }, { status: 404 })
    }

    // Get all messages for this contact, grouped by thread
    const messages = await prisma.message.findMany({
      where: {
        userId: decoded.userId,
        contactId,
        platform: { in: ['email', 'gmail'] }
      },
      orderBy: { timestamp: 'asc' }
    })

    if (messages.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No email messages found for this contact' 
      })
    }

    // Group messages by thread ID (extract from platformData)
    const threadsMap = new Map<string, typeof messages>()
    
    for (const message of messages) {
      let threadId = 'default_thread'
      
      // Try to extract thread ID from platformData
      if (message.platformData && typeof message.platformData === 'object') {
        const data = message.platformData as Record<string, unknown>
        threadId = (data.threadId as string) || (data.thread_id as string) || threadId
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

      const formattedMessages = threadMessages.map(msg => {
        let fromEmailString = user.email || 'unknown@example.com'; // Default to user's email for 'from' field
        let isFromUser = true; // Default to true if we can't determine sender or it is the user
        
        if (msg.platformData && typeof msg.platformData === 'object') {
          const data = msg.platformData as Record<string, unknown>;
          let extractedSenderIdentifier: string | undefined = undefined;

          // Attempt to get email string from data.from or data.sender
          if (typeof data.from === 'string') {
            extractedSenderIdentifier = data.from;
          } else if (typeof data.from === 'object' && data.from !== null && typeof (data.from as { email?: string }).email === 'string') {
            extractedSenderIdentifier = (data.from as { email: string }).email;
          } else if (typeof data.sender === 'string') {
            extractedSenderIdentifier = data.sender;
          } else if (typeof data.sender === 'object' && data.sender !== null && typeof (data.sender as { email?: string }).email === 'string') {
            extractedSenderIdentifier = (data.sender as { email: string }).email;
          }

          if (extractedSenderIdentifier) {
            fromEmailString = extractedSenderIdentifier; // This will be used as the 'from' field in formattedMessage
            // Now determine if this fromEmailString belongs to the user
            isFromUser = fromEmailString.toLowerCase().includes((user.email || '').toLowerCase());
          } else {
            // If no identifiable sender email, assume it might be from user (or keep default fromEmailString as user.email)
            // isFromUser remains true as per initialization if user.email is the fromEmailString
            isFromUser = (user.email || '').toLowerCase() === fromEmailString.toLowerCase();
          }
        } else {
            // No platformData, fromEmailString remains user.email, isFromUser remains true
        }

        return {
          id: msg.platformMessageId,
          from: fromEmailString, // Use the derived email string
          to: [contact.email || 'unknown@example.com'],
          subject: (msg.platformData as Record<string, unknown>)?.subject as string || 'Email conversation',
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

        const platformMessageIdForSummary = `thread_summary_${threadId}`;

        const existingSummary = await prisma.message.findFirst({
          where: {
            userId: decoded.userId,
            contactId,
            platformMessageId: platformMessageIdForSummary
          }
        })

        const summaryContent = analysis.summary; 

        const summaryDataForDb = {
          content: summaryContent,
          timestamp: new Date(),
          platformData: {
            isThreadSummary: true,
            threadId,
            analysis: JSON.parse(JSON.stringify(analysis)),
            messageCount: threadMessages.length
          }
        }

        if (existingSummary) {
          await prisma.message.update({
            where: { id: existingSummary.id },
            data: summaryDataForDb
          })
        } else {
          await prisma.message.create({
            data: {
              userId: decoded.userId,
              contactId,
              platform: 'thread_summary',
              platformMessageId: platformMessageIdForSummary,
              ...summaryDataForDb
            }
          })
        }

      } catch (analysisError) {
        console.error(`Error analyzing thread ${threadId}:`, analysisError)
        continue
      }
    }

    return NextResponse.json({
      success: true,
      threadsAnalyzed: threadAnalyses.length,
      analyses: threadAnalyses
    })

  } catch (error) {
    console.error('Thread analysis error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze threads' },
      { status: 500 }
    )
  }
} 