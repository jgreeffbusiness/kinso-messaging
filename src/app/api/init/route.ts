import { NextResponse } from 'next/server'
import { initializeAutoSyncForAllUsers } from '@/lib/services/auto-sync-service'

export async function POST() {
  try {
    console.log('Initializing auto-sync for all users...')
    
    await initializeAutoSyncForAllUsers()
    
    return NextResponse.json({ 
      success: true, 
      message: 'Auto-sync initialized for all users' 
    })
  } catch (error) {
    console.error('Failed to initialize auto-sync:', error)
    return NextResponse.json(
      { error: 'Failed to initialize auto-sync' },
      { status: 500 }
    )
  }
}

// Also allow GET for health checks
export async function GET() {
  return NextResponse.json({ 
    status: 'Auto-sync service ready',
    timestamp: new Date().toISOString()
  })
} 