'use client'

import { useAuthStore } from '@store/useAuthStore'
import { loginWithGoogle } from '@hooks/useFirebaseLogin'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Badge } from '@components/ui/badge'
import { User, LogOut, RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

export function AuthDebugPanel() {
  const { user, isAuthenticated, isLoading, error, logout } = useAuthStore()
  const [testing, setTesting] = useState(false)

  const handleGoogleLogin = async () => {
    try {
      setTesting(true)
      const user = await loginWithGoogle()
      toast.success(`Welcome ${user.name}!`)
    } catch (error) {
      toast.error('Login failed')
      console.error(error)
    } finally {
      setTesting(false)
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
      toast.success('Logged out successfully')
    } catch (error) {
      toast.error('Logout failed')
      console.error(error)
    }
  }

  const testSessionAPI = async () => {
    try {
      setTesting(true)
      const response = await fetch('/api/auth/me')
      const data = await response.json()
      
      if (response.ok) {
        toast.success('Session is valid')
        console.log('Session data:', data)
      } else {
        toast.error(`Session invalid: ${data.error}`)
      }
    } catch (error) {
      toast.error('Failed to test session')
      console.error(error)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Auth Debug Panel
        </CardTitle>
        <CardDescription>
          Development authentication status and controls
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Authentication Status */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status:</span>
            <Badge variant={isAuthenticated ? "default" : "secondary"}>
              {isAuthenticated ? (
                <><CheckCircle className="h-3 w-3 mr-1" /> Authenticated</>
              ) : (
                <><XCircle className="h-3 w-3 mr-1" /> Not Authenticated</>
              )}
            </Badge>
          </div>
          
          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
              Error: {error}
            </div>
          )}
        </div>

        {/* User Information */}
        {user && (
          <div className="space-y-2 p-3 bg-gray-50 rounded">
            <div className="text-sm">
              <strong>User ID:</strong> {user.id}
            </div>
            <div className="text-sm">
              <strong>Name:</strong> {user.name}
            </div>
            <div className="text-sm">
              <strong>Email:</strong> {user.email}
            </div>
            {user.isNewUser && (
              <Badge variant="outline" className="text-xs">
                New User
              </Badge>
            )}
            {user.hasGoogleIntegration && (
              <Badge variant="outline" className="text-xs">
                Google Connected
              </Badge>
            )}
            {user.hasSlackIntegration && (
              <Badge variant="outline" className="text-xs">
                Slack Connected
              </Badge>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          {!isAuthenticated ? (
            <Button 
              onClick={handleGoogleLogin}
              disabled={isLoading || testing}
              className="w-full"
            >
              {isLoading || testing ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                'Sign in with Google'
              )}
            </Button>
          ) : (
            <>
              <Button 
                onClick={handleLogout}
                variant="outline"
                disabled={isLoading}
                className="w-full"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
              
              <Button 
                onClick={testSessionAPI}
                variant="secondary"
                disabled={testing}
                className="w-full"
              >
                {testing ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  'Test Session API'
                )}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
} 