import { NextResponse } from 'next/server'
import { initializeWebhookDrivenSync } from '@/lib/services/auto-sync-service'

export async function POST() {
  try {
    console.log('🚀 Initializing webhook-driven sync system...')
    
    await initializeWebhookDrivenSync()
    
    return NextResponse.json({ 
      success: true, 
      message: 'Webhook-driven sync system initialized',
      syncStrategy: 'initial-sync-on-page-load + webhooks'
    })
  } catch (error) {
    console.error('Failed to initialize sync system:', error)
    return NextResponse.json(
      { error: 'Failed to initialize sync system' },
      { status: 500 }
    )
  }
}

// Also allow GET for health checks
export async function GET() {
  return NextResponse.json({ 
    status: 'Webhook-driven sync service ready',
    strategy: 'initial-sync-on-page-load + webhooks',
    timestamp: new Date().toISOString()
  })
} 