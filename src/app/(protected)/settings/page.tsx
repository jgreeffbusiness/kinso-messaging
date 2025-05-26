'use client'

import { GooglePlatformCard } from '@components/GooglePlatformCard'
import { SlackPlatformCard } from '@components/SlackPlatformCard'
import SharedLayout from '@components/layout/SharedLayout'
import { Separator } from '@components/ui/separator'

export default function SettingsPage() {  
  return (
    <SharedLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your platform integrations and AI features</p>
        </div>
        
        <Separator />

        {/* Platform Integrations */}
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-4">Platform Integrations</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Connect your communication platforms to get unified AI-powered insights
            </p>
          </div>

          {/* Google Platform */}
          <div className="space-y-4">
            <h3 className="text-md font-medium text-blue-700">📧 Google Workspace</h3>
            <GooglePlatformCard />
          </div>

          <Separator />

          {/* Slack Platform */}
          <div className="space-y-4">
            <h3 className="text-md font-medium text-purple-700">💬 Slack Workspace</h3>
            <SlackPlatformCard />
          </div>
        </div>

        <Separator />

        {/* AI Features Overview */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">AI Features</h2>
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-lg border">
            <h3 className="font-medium mb-3">🤖 Available across all connected platforms</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm font-medium">Thread Analysis</span>
                </div>
                <p className="text-xs text-muted-foreground ml-4">
                  AI-powered conversation summaries and insights
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm font-medium">Unread Highlights</span>
                </div>
                <p className="text-xs text-muted-foreground ml-4">
                  Key points from messages you haven&apos;t responded to
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm font-medium">Action Items</span>
                </div>
                <p className="text-xs text-muted-foreground ml-4">
                  Automatically extracted tasks and follow-ups
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm font-medium">Response Tracking</span>
                </div>
                <p className="text-xs text-muted-foreground ml-4">
                  Timeline analysis and urgency detection
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SharedLayout>
  )
} 