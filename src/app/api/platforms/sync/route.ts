import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedMessageService } from '@/lib/services/unified-message-service'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, platform, contactId } = body

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    const messageService = getUnifiedMessageService()

    if (platform) {
      // Sync specific platform
      const result = await messageService.syncPlatform(userId, platform, contactId)
      return NextResponse.json(result)
    } else {
      // Sync all platforms
      const results = await messageService.syncAllPlatforms(userId)
      return NextResponse.json(results)
    }
  } catch (error) {
    console.error('Platform sync API error:', error)
    return NextResponse.json(
      { error: 'Failed to sync platforms' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    const messageService = getUnifiedMessageService()
    const platforms = await messageService.getSupportedPlatforms(userId)
    
    return NextResponse.json({ platforms })
  } catch (error) {
    console.error('Platform status API error:', error)
    return NextResponse.json(
      { error: 'Failed to get platform status' },
      { status: 500 }
    )
  }
} 