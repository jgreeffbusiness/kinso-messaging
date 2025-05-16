'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { GoogleIntegrationDialog } from '@/components/GoogleIntegrationDialog'

export default function SettingsPage() {
  const [showIntegrationDialog, setShowIntegrationDialog] = useState(false)
  
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="space-y-6">
        <div className="border rounded-lg p-6 bg-card">
          <h2 className="text-xl font-semibold mb-4">Google Integration</h2>
          <p className="text-muted-foreground mb-4">
            Connect your Google account to import contacts, access emails, and sync your calendar.
          </p>
          
          <Button onClick={() => setShowIntegrationDialog(true)}>
            Connect Google Account
          </Button>
        </div>
      </div>
      
      <GoogleIntegrationDialog 
        isOpen={showIntegrationDialog}
        onClose={() => setShowIntegrationDialog(false)}
      />
    </div>
  )
} 