import { NextResponse } from 'next/server'
import { syncAllUserEmails } from '@server/services/gmail'
import { prisma } from '@server/db'

// Set this route to be called by a Vercel cron job
// Config in vercel.json: {"crons": [{"path": "/api/cron/sync-emails", "schedule": "0 */6 * * *"}]}
export async function GET() {
  try {
    // Get all users with Google tokens
    const users = await prisma.user.findMany({
      where: {
        googleAccessToken: { not: null }
      },
      select: {
        id: true
      }
    })
    
    const results = []
    
    // Sync emails for each user
    for (const user of users) {
      const result = await syncAllUserEmails(user.id)
      results.push({ userId: user.id, success: result.success })
    }
    
    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('Cron job error:', error)
    return NextResponse.json(
      { error: 'Failed to sync emails' }, 
      { status: 500 }
    )
  }
} 