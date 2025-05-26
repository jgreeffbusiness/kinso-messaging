'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@components/ui/button'
import { Card, CardContent } from '@components/ui/card'
import { Phone, Plus, X } from 'lucide-react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle, faSlack, faMicrosoft, faLinkedin } from '@fortawesome/free-brands-svg-icons'
import { SlackConnectButton } from '@components/SlackConnectButton'
import { GoogleIntegrationDialog } from '@components/GoogleIntegrationDialog'
import { toast } from 'sonner'

// Design system constants
const BORDER_RADIUS = '6px'

interface PlatformOption {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  status: 'available' | 'connected' | 'unavailable'
  iconBg: string
}

export default function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [currentStep, setCurrentStep] = useState(0)
  const [contactConnections, setContactConnections] = useState<Set<string>>(new Set())
  const [messageConnections, setMessageConnections] = useState<Set<string>>(new Set())
  const [showGoogleDialog, setShowGoogleDialog] = useState(false)

  const contactPlatforms: PlatformOption[] = [
    {
      id: 'google-contacts',
      name: 'Google',
      description: 'Email contacts, calendar events, and meeting participants.',
      icon: <FontAwesomeIcon icon={faGoogle} className="h-5 w-5" />,
      status: 'available',
      iconBg: 'bg-white'
    },
    {
      id: 'outlook-contacts',
      name: 'Microsoft',
      description: 'Contacts, meetings, and email correspondents from Outlook or Teams.',
      icon: <FontAwesomeIcon icon={faMicrosoft} className="h-5 w-5" />,
      status: 'unavailable',
      iconBg: 'bg-white'
    },
    {
      id: 'linkedin-contacts',
      name: 'LinkedIn',
      description: 'Connections and public profile details.',
      icon: <FontAwesomeIcon icon={faLinkedin} className="h-5 w-5 text-blue-600" />,
      status: 'unavailable',
      iconBg: 'bg-white'
    },
    {
      id: 'phone-contacts',
      name: 'Phone',
      description: 'Import contacts directly from your mobile device.',
      icon: <Phone className="h-5 w-5 text-slate-600" />,
      status: 'unavailable',
      iconBg: 'bg-white'
    }
  ]

  const messagePlatforms: PlatformOption[] = [
    {
      id: 'gmail',
      name: 'Gmail',
      description: 'Email conversations, threads, and message history.',
      icon: <FontAwesomeIcon icon={faGoogle} className="h-5 w-5" />,
      status: 'available',
      iconBg: 'bg-white'
    },
    {
      id: 'slack',
      name: 'Slack',
      description: 'Direct messages, channels, and workspace conversations.',
      icon: <FontAwesomeIcon icon={faSlack} className="h-5 w-5 text-purple-600" />,
      status: 'available',
      iconBg: 'bg-white'
    },
    {
      id: 'outlook',
      name: 'Outlook',
      description: 'Microsoft email account and conversation history.',
      icon: <FontAwesomeIcon icon={faMicrosoft} className="h-5 w-5" />,
      status: 'unavailable',
      iconBg: 'bg-white'
    }
  ]

  const handleContactConnect = (platformId: string) => {
    if (platformId === 'google-contacts') {
      setShowGoogleDialog(true)
    }
  }

  const handleMessageConnect = (platformId: string) => {
    if (platformId === 'gmail') {
      setShowGoogleDialog(true)
    }
  }

  const handleGoogleIntegrationSuccess = () => {
    // Mark both contacts and messages as connected since Google provides both
    setContactConnections(prev => new Set([...prev, 'google-contacts']))
    setMessageConnections(prev => new Set([...prev, 'gmail']))
    setShowGoogleDialog(false)
    toast.success('Google connected successfully!')
  }

  const handleNext = () => {
    if (currentStep === 0) {
      setCurrentStep(1)
    } else {
      toast.success('Setup complete. Welcome to Kinso.')
      router.push('/dashboard')
    }
  }

  useEffect(() => {
    const googleSuccess = searchParams.get('google_success')
    const googleError = searchParams.get('google_error')
    const slackSuccess = searchParams.get('slack_success')
    const slackError = searchParams.get('slack_error')

    if (googleSuccess) {
      if (currentStep === 0) {
        setContactConnections(prev => new Set([...prev, 'google-contacts']))
      } else {
        setMessageConnections(prev => new Set([...prev, 'gmail']))
      }
      toast.success('Connected successfully')
      
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('google_success')
      window.history.replaceState({}, '', newUrl.toString())
    }

    if (googleError) {
      toast.error('Connection failed')
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('google_error')
      window.history.replaceState({}, '', newUrl.toString())
    }

    if (slackSuccess) {
      setMessageConnections(prev => new Set([...prev, 'slack']))
      toast.success('Slack connected')
      
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('slack_success')
      window.history.replaceState({}, '', newUrl.toString())
    }

    if (slackError) {
      toast.error('Slack connection failed')
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('slack_error')
      window.history.replaceState({}, '', newUrl.toString())
    }
  }, [searchParams, currentStep])

  const PlatformCard = ({ 
    platform, 
    connected, 
    onConnect 
  }: { 
    platform: PlatformOption
    connected: boolean
    onConnect: () => void 
  }) => (
    <Card 
      className={`transition-all duration-200 ${
        connected 
          ? 'border-blue-200 bg-blue-50' 
          : platform.status === 'unavailable'
            ? 'border-gray-200 bg-gray-50'
            : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
      style={{ borderRadius: BORDER_RADIUS }}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div 
              className={`w-10 h-10 ${platform.iconBg} border border-gray-200 flex items-center justify-center`}
              style={{ borderRadius: BORDER_RADIUS }}
            >
              {platform.icon}
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900">{platform.name}</h3>
              <p className="text-sm text-gray-600 mt-1">{platform.description}</p>
            </div>
          </div>
          
          <div className="flex-shrink-0 ml-4">
            {connected ? (
              <button className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                <X className="h-4 w-4 text-gray-600" />
              </button>
            ) : platform.status === 'available' ? (
              <button 
                onClick={onConnect}
                className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-gray-400 transition-colors"
              >
                <Plus className="h-4 w-4 text-gray-600" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <Plus className="h-4 w-4 text-gray-400" />
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )

  const currentConnections = currentStep === 0 ? contactConnections : messageConnections
  const hasConnections = currentConnections.size > 0

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            {currentStep === 0 ? 'Bring in contacts' : 'Connect your messages'}
          </h1>
          <p className="text-gray-600 leading-relaxed">
            {currentStep === 0 
              ? hasConnections 
                ? 'Your network is taking shape. Connect more sources or continue.'
                : 'Connect your contact sources to build your professional network.'
              : hasConnections
                ? 'Great! Now connect your messaging apps to analyze conversations.'
                : 'Connect messaging platforms to start tracking important conversations.'
            }
          </p>
        </div>

        {/* Platform Cards */}
        <div className="space-y-3 mb-8">
          {(currentStep === 0 ? contactPlatforms : messagePlatforms).map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={platform}
              connected={currentStep === 0 
                ? contactConnections.has(platform.id)
                : messageConnections.has(platform.id)
              }
              onConnect={() => currentStep === 0 
                ? handleContactConnect(platform.id)
                : handleMessageConnect(platform.id)
              }
            />
          ))}
        </div>

        {/* Custom Slack Component */}
        {currentStep === 1 && !messageConnections.has('slack') && (
          <div className="mb-8">
            <SlackConnectButton 
              onConnectionChange={() => setMessageConnections(prev => new Set([...prev, 'slack']))}
            />
          </div>
        )}

        {/* Actions */}
        <div className="space-y-4">
          <Button 
            onClick={handleNext}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white py-4 text-lg font-medium"
            style={{ borderRadius: BORDER_RADIUS }}
          >
            Continue
          </Button>
        </div>
      </div>

      {/* Google Integration Dialog */}
      <GoogleIntegrationDialog 
        isOpen={showGoogleDialog}
        onClose={handleGoogleIntegrationSuccess}
      />
    </div>
  )
} 