import { prisma } from '@/server/db'
import { processEmailContent } from './email-processor'

/**
 * Enhances existing email messages in the database with AI processing
 * This can be run as a background job or triggered manually
 */
export async function enhanceExistingMessages(userId: string, limit = 10) {
  try {
    // Get all email messages and filter in-memory for unprocessed ones
    const allEmailMessages = await prisma.message.findMany({
      where: {
        userId,
        platform: 'email'
      },
      orderBy: {
        timestamp: 'desc' // Process newest first
      }
    })

    // Filter to only unprocessed messages (those without aiSummary)
    const unprocessedMessages = allEmailMessages
      .filter(message => {
        const platformData = message.platformData as Record<string, unknown>
        return !platformData?.aiSummary
      })
      .slice(0, limit)

    console.log(`Found ${unprocessedMessages.length} unprocessed email messages for user ${userId}`)

    // Process messages in parallel batches for better performance
    const batchSize = 3 // Process 3 at a time to avoid rate limiting
    let processedCount = 0
    let failedCount = 0

    for (let i = 0; i < unprocessedMessages.length; i += batchSize) {
      const batch = unprocessedMessages.slice(i, i + batchSize)
      
      // Process batch in parallel
      const batchPromises = batch.map(async (message) => {
        try {
          // Process the email content with AI
          const aiResult = await processEmailContent(message.content)
          
          // Update the message with cleaned content and AI insights
          await prisma.message.update({
            where: { id: message.id },
            data: {
              content: aiResult.cleanedContent,
              platformData: {
                ...(message.platformData as object || {}),
                aiSummary: aiResult.summary,
                keyPoints: aiResult.keyPoints,
                actionItems: aiResult.actionItems,
                urgency: aiResult.urgency,
                category: aiResult.category,
                originalContent: aiResult.originalContent
              }
            }
          })

          console.log(`Enhanced message ${message.id}`)
          return { success: true, messageId: message.id }
        } catch (err) {
          const error = err instanceof Error ? err : new Error('Unknown error')
          console.error(`Failed to enhance message ${message.id}:`, error.message)
          return { success: false, messageId: message.id, error: error.message }
        }
      })

      // Wait for batch to complete
      const batchResults = await Promise.allSettled(batchPromises)
      
      // Count results
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          processedCount++
        } else {
          failedCount++
        }
      })

      // Small delay between batches only
      if (i + batchSize < unprocessedMessages.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    return {
      success: true,
      processed: processedCount,
      failed: failedCount,
      total: unprocessedMessages.length
    }

  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error')
    console.error('Error enhancing messages:', error.message)
    return {
      success: false,
      error: error.message,
      processed: 0,
      failed: 0,
      total: 0
    }
  }
}

/**
 * Enhance all messages for all users (for background processing)
 */
export async function enhanceAllUsersMessages(messagesPerUser = 5) {
  try {
    // Get all users who have email messages
    const usersWithEmails = await prisma.user.findMany({
      where: {
        messages: {
          some: {
            platform: 'email'
          }
        }
      },
      select: {
        id: true,
        email: true
      }
    })

    console.log(`Processing AI enhancement for ${usersWithEmails.length} users`)

    const results = []

    for (const user of usersWithEmails) {
      const result = await enhanceExistingMessages(user.id, messagesPerUser)
      results.push({
        userId: user.id,
        userEmail: user.email,
        ...result
      })
      
      // Delay between users to spread out API usage
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    return {
      success: true,
      userResults: results,
      totalUsers: usersWithEmails.length
    }

  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error')
    console.error('Error in bulk message enhancement:', error.message)
    return {
      success: false,
      error: error.message,
      userResults: [],
      totalUsers: 0
    }
  }
} 