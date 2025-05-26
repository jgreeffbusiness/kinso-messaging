'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, MessageSquare, Brain, Clock, AlertTriangle, Mail } from 'lucide-react'
import { toast } from 'sonner'

interface UnifiedThreadAnalysisProps {
  contactId: string
  contactName: string
}

interface ThreadAnalysis {
  threadSummary: string
  keyTopics: string[]
  currentStatus: 'awaiting_user_response' | 'awaiting_contact_response' | 'concluded' | 'ongoing'
  unreadHighlights: string[]
  actionItems: string[]
  urgency: 'low' | 'medium' | 'high' | 'urgent'
  relationship: 'professional' | 'personal' | 'support' | 'sales' | 'networking'
  nextSteps: string[]
  unresponded: {
    hasUnrespondedMessages: boolean
    unrespondedCount: number
    daysSinceLastUserReply: number
  }
}

interface AnalysisResult {
  threadId: string
  messageCount: number
  analysis: ThreadAnalysis
  lastActivity: string
}

interface PlatformAnalysis {
  platform: 'email' | 'slack'
  analyses: AnalysisResult[]
  loading: boolean
}

export function UnifiedThreadAnalysis({ contactId, contactName }: UnifiedThreadAnalysisProps) {
  const [emailAnalysis, setEmailAnalysis] = useState<PlatformAnalysis>({
    platform: 'email',
    analyses: [],
    loading: false
  })
  
  const [slackAnalysis, setSlackAnalysis] = useState<PlatformAnalysis>({
    platform: 'slack',
    analyses: [],
    loading: false
  })

  const [showResults, setShowResults] = useState(false)

  const analyzeEmailThreads = async () => {
    try {
      setEmailAnalysis(prev => ({ ...prev, loading: true }))
      
      const response = await fetch('/api/emails/analyze-threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId })
      })
      
      if (!response.ok) {
        throw new Error('Failed to analyze email threads')
      }
      
      const data = await response.json()
      
      if (data.success) {
        setEmailAnalysis(prev => ({ 
          ...prev, 
          analyses: data.analyses || [],
          loading: false 
        }))
        toast.success(`Analyzed ${data.threadsAnalyzed} email threads`)
      } else {
        setEmailAnalysis(prev => ({ ...prev, loading: false }))
        toast.error(data.message || 'No email threads found')
      }
    } catch (error) {
      console.error('Email thread analysis error:', error)
      setEmailAnalysis(prev => ({ ...prev, loading: false }))
      toast.error('Failed to analyze email threads')
    }
  }

  const analyzeSlackThreads = async () => {
    try {
      setSlackAnalysis(prev => ({ ...prev, loading: true }))
      
      const response = await fetch('/api/slack/analyze-threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId })
      })
      
      if (!response.ok) {
        throw new Error('Failed to analyze Slack threads')
      }
      
      const data = await response.json()
      
      if (data.success) {
        setSlackAnalysis(prev => ({ 
          ...prev, 
          analyses: data.analyses || [],
          loading: false 
        }))
        toast.success(`Analyzed ${data.threadsAnalyzed} Slack threads`)
      } else {
        setSlackAnalysis(prev => ({ ...prev, loading: false }))
        toast.error(data.message || 'No Slack threads found')
      }
    } catch (error) {
      console.error('Slack thread analysis error:', error)
      setSlackAnalysis(prev => ({ ...prev, loading: false }))
      toast.error('Failed to analyze Slack threads')
    }
  }

  const analyzeAllThreads = async () => {
    setShowResults(true)
    await Promise.all([
      analyzeEmailThreads(),
      analyzeSlackThreads()
    ])
  }

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return 'bg-red-100 text-red-800'
      case 'high': return 'bg-orange-100 text-orange-800'
      case 'medium': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-green-100 text-green-800'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'awaiting_user_response': return 'bg-red-100 text-red-800'
      case 'awaiting_contact_response': return 'bg-blue-100 text-blue-800'
      case 'concluded': return 'bg-gray-100 text-gray-800'
      default: return 'bg-green-100 text-green-800'
    }
  }

  const renderThreadCard = (result: AnalysisResult, platform: 'email' | 'slack', index: number) => (
    <Card key={`${platform}-${result.threadId}`} className={`border-l-4 ${platform === 'email' ? 'border-l-blue-500' : 'border-l-purple-500'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {platform === 'email' ? (
              <Mail className="h-4 w-4 text-blue-600" />
            ) : (
              <MessageSquare className="h-4 w-4 text-purple-600" />
            )}
            {platform === 'email' ? 'Email' : 'Slack'} Thread {index + 1} ({result.messageCount} messages)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={getUrgencyColor(result.analysis.urgency)}>
              {result.analysis.urgency}
            </Badge>
            <Badge className={getStatusColor(result.analysis.currentStatus)}>
              {result.analysis.currentStatus.replace(/_/g, ' ')}
            </Badge>
          </div>
        </div>
        <CardDescription className="text-sm text-gray-600">
          Last activity: {new Date(result.lastActivity).toLocaleDateString()}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Thread Summary */}
        <div>
          <h4 className="font-medium text-sm mb-2">Summary</h4>
          <p className="text-sm text-gray-700">{result.analysis.threadSummary}</p>
        </div>

        {/* Key Topics */}
        {result.analysis.keyTopics.length > 0 && (
          <div>
            <h4 className="font-medium text-sm mb-2">Key Topics</h4>
            <div className="flex flex-wrap gap-1">
              {result.analysis.keyTopics.map((topic, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {topic}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Unread Highlights */}
        {result.analysis.unreadHighlights.length > 0 && (
          <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
            <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Unread Highlights
            </h4>
            <ul className="text-sm space-y-1">
              {result.analysis.unreadHighlights.map((highlight, i) => (
                <li key={i} className="text-yellow-800">• {highlight}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Unresponded Info */}
        {result.analysis.unresponded.hasUnrespondedMessages && (
          <div className="bg-red-50 p-3 rounded-lg border border-red-200">
            <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
              <Clock className="h-4 w-4 text-red-600" />
              Needs Response
            </h4>
            <p className="text-sm text-red-800">
              {result.analysis.unresponded.unrespondedCount} unresponded messages
              {result.analysis.unresponded.daysSinceLastUserReply > 0 && 
                ` • ${result.analysis.unresponded.daysSinceLastUserReply} days since your last reply`
              }
            </p>
          </div>
        )}

        {/* Action Items */}
        {result.analysis.actionItems.length > 0 && (
          <div>
            <h4 className="font-medium text-sm mb-2">Action Items</h4>
            <ul className="text-sm space-y-1">
              {result.analysis.actionItems.map((item, i) => (
                <li key={i} className="text-gray-700">• {item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Next Steps */}
        {result.analysis.nextSteps.length > 0 && (
          <div>
            <h4 className="font-medium text-sm mb-2">Suggested Next Steps</h4>
            <ul className="text-sm space-y-1">
              {result.analysis.nextSteps.map((step, i) => (
                <li key={i} className={platform === 'email' ? 'text-blue-700' : 'text-purple-700'}>• {step}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )

  const totalThreads = emailAnalysis.analyses.length + slackAnalysis.analyses.length
  const isLoading = emailAnalysis.loading || slackAnalysis.loading

  return (
    <div className="space-y-4">
      <Button 
        onClick={analyzeAllThreads}
        disabled={isLoading}
        className="flex items-center gap-2"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Brain className="h-4 w-4" />
        )}
        {isLoading ? 'Analyzing...' : 'Analyze All Conversations'}
      </Button>

      {showResults && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">
            Conversation Analysis for {contactName}
          </h3>
          
          {totalThreads > 0 ? (
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">All ({totalThreads})</TabsTrigger>
                <TabsTrigger value="email">Email ({emailAnalysis.analyses.length})</TabsTrigger>
                <TabsTrigger value="slack">Slack ({slackAnalysis.analyses.length})</TabsTrigger>
              </TabsList>
              
              <TabsContent value="all" className="space-y-4">
                {/* Combined view sorted by last activity */}
                {[...emailAnalysis.analyses.map(a => ({ ...a, platform: 'email' as const })), 
                  ...slackAnalysis.analyses.map(a => ({ ...a, platform: 'slack' as const }))]
                  .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
                  .map((result, index) => renderThreadCard(result, result.platform, index))}
              </TabsContent>
              
              <TabsContent value="email" className="space-y-4">
                {emailAnalysis.analyses.map((result, index) => 
                  renderThreadCard(result, 'email', index)
                )}
                {emailAnalysis.analyses.length === 0 && !emailAnalysis.loading && (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No Email Threads</h3>
                      <p className="text-gray-600">No email conversations found for {contactName}.</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              
              <TabsContent value="slack" className="space-y-4">
                {slackAnalysis.analyses.map((result, index) => 
                  renderThreadCard(result, 'slack', index)
                )}
                {slackAnalysis.analyses.length === 0 && !slackAnalysis.loading && (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No Slack Threads</h3>
                      <p className="text-gray-600">No Slack conversations found for {contactName}.</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          ) : !isLoading && (
            <Card>
              <CardContent className="p-6 text-center">
                <Brain className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Conversations Found</h3>
                <p className="text-gray-600">
                  No conversations found for {contactName} across email and Slack. 
                  Make sure to sync messages first.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
} 