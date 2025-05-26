import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { SlackAdapter } from '@/lib/platforms/adapters/slack'
import { prisma } from '@/server/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function GET() {
  try {
    // Verify user is authenticated
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify session token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    const userId = decoded.userId

    console.log(`🔍 Starting Slack debug for user: ${userId}`)
    
    const slackAdapter = new SlackAdapter()
    const debugResults: any = {
      userId,
      steps: [],
      errors: []
    }

    // Step 1: Check authentication
    try {
      const isAuth = await slackAdapter.isAuthenticated(userId)
      debugResults.steps.push({
        step: 1,
        name: 'Authentication Check',
        success: isAuth,
        result: isAuth ? 'User authenticated with Slack' : 'User not authenticated'
      })

      if (!isAuth) {
        return NextResponse.json(debugResults)
      }
    } catch (error) {
      debugResults.errors.push(`Auth check failed: ${error}`)
      return NextResponse.json(debugResults)
    }

    // Step 2: Get user's Slack credentials
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { 
          slackAccessToken: true,
          slackTeamId: true,
          slackUserId: true,
          slackIntegrations: true
        }
      })

      debugResults.steps.push({
        step: 2,
        name: 'User Credentials',
        success: !!user?.slackAccessToken,
        result: {
          hasAccessToken: !!user?.slackAccessToken,
          teamId: user?.slackTeamId,
          userId: user?.slackUserId,
          integrations: user?.slackIntegrations
        }
      })

      if (!user?.slackAccessToken) {
        debugResults.errors.push('No Slack access token found')
        return NextResponse.json(debugResults)
      }

      // Step 3: Test conversations.list API call
      try {
        console.log('🔍 Testing conversations.list API...')
        const response = await fetch('https://slack.com/api/conversations.list', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${user.slackAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            types: 'im,mpim', // Include both direct messages and multi-party DMs
            limit: 100,
          }),
        })

        const conversationsData = await response.json()
        
        debugResults.steps.push({
          step: 3,
          name: 'Conversations List API',
          success: conversationsData.ok,
          result: {
            ok: conversationsData.ok,
            error: conversationsData.error,
            channelsCount: conversationsData.channels?.length || 0,
            channels: conversationsData.channels?.slice(0, 5).map((c: any) => ({
              id: c.id,
              user: c.user,
              is_im: c.is_im,
              is_mpim: c.is_mpim,
              is_channel: c.is_channel,
              is_group: c.is_group,
              name: c.name || '(no name)',
              created: c.created ? new Date(c.created * 1000).toISOString() : null
            })) || [],
            // Show filtering results
            dmCount: conversationsData.channels?.filter((c: any) => c.is_im === true).length || 0,
            mpimCount: conversationsData.channels?.filter((c: any) => c.is_mpim === true).length || 0,
            channelCount: conversationsData.channels?.filter((c: any) => c.is_channel === true).length || 0
          }
        })

        if (!conversationsData.ok) {
          debugResults.errors.push(`conversations.list failed: ${conversationsData.error}`)
          return NextResponse.json(debugResults)
        }

        // Step 3.5: Try alternative API call for DMs
        try {
          console.log('🔍 Testing alternative API - users.conversations...')
          const altResponse = await fetch('https://slack.com/api/users.conversations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${user.slackAccessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              types: 'im,mpim',
              limit: 100,
            }),
          })

          const altData = await altResponse.json()
          
          debugResults.steps.push({
            step: 3.5,
            name: 'Alternative API - users.conversations',
            success: altData.ok,
            result: {
              ok: altData.ok,
              error: altData.error,
              channelsCount: altData.channels?.length || 0,
              dmCount: altData.channels?.filter((c: any) => c.is_im === true).length || 0,
              mpimCount: altData.channels?.filter((c: any) => c.is_mpim === true).length || 0,
              sampleChannels: altData.channels?.slice(0, 3).map((c: any) => ({
                id: c.id,
                is_im: c.is_im,
                user: c.user
              })) || []
            }
          })

        } catch (error) {
          debugResults.errors.push(`Alternative API error: ${error}`)
        }

        // Step 4: Test conversations.history for first conversation
        if (conversationsData.channels && conversationsData.channels.length > 0) {
          const firstChannel = conversationsData.channels[0]
          
          try {
            console.log(`🔍 Testing conversations.history for channel: ${firstChannel.id}`)
            const historyResponse = await fetch('https://slack.com/api/conversations.history', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${user.slackAccessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                channel: firstChannel.id,
                limit: 10,
              }),
            })

            const historyData = await historyResponse.json()
            
            debugResults.steps.push({
              step: 4,
              name: 'Conversations History API',
              success: historyData.ok,
              result: {
                channelId: firstChannel.id,
                ok: historyData.ok,
                error: historyData.error,
                messagesCount: historyData.messages?.length || 0,
                messages: historyData.messages?.slice(0, 2).map((m: any) => ({
                  ts: m.ts,
                  user: m.user,
                  text: m.text?.substring(0, 100) || '(no text)',
                  subtype: m.subtype
                })) || []
              }
            })

            if (!historyData.ok) {
              debugResults.errors.push(`conversations.history failed: ${historyData.error}`)
            }

          } catch (error) {
            debugResults.errors.push(`History API error: ${error}`)
          }
        } else {
          debugResults.steps.push({
            step: 4,
            name: 'Conversations History API',
            success: false,
            result: 'No conversations found to test'
          })
        }

      } catch (error) {
        debugResults.errors.push(`Conversations API error: ${error}`)
      }

      // Step 5: Test our adapter's fetchMessages method
      try {
        console.log('🔍 Testing SlackAdapter.fetchMessages...')
        const messages = await slackAdapter.fetchMessages(userId, {
          limit: 10,
          since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        })

        debugResults.steps.push({
          step: 5,
          name: 'SlackAdapter.fetchMessages',
          success: true,
          result: {
            messagesCount: messages.length,
            messages: messages.slice(0, 2).map(m => ({
              id: m.id,
              content: m.content.substring(0, 100) || '(no content)',
              timestamp: m.timestamp,
              sender: m.sender
            }))
          }
        })

      } catch (error) {
        debugResults.errors.push(`fetchMessages error: ${error}`)
      }

    } catch (error) {
      debugResults.errors.push(`User lookup failed: ${error}`)
    }

    return NextResponse.json(debugResults)

  } catch (error) {
    console.error('Slack debug error:', error)
    return NextResponse.json(
      { error: 'Debug failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
} 