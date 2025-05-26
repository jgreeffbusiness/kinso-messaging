'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginWithGoogle } from '@hooks/useFirebaseLogin'
import { useAuthStore } from '@store/useAuthStore'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Icons } from '@components/ui/icons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@lib/firebase'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const { setUser, setLoading, setError, isLoading, error } = useAuthStore()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: ''
  })

  async function handleGoogleAuth() {
    try {
      const user = await loginWithGoogle()
      toast.success(`Welcome ${user.name || 'back'}!`)
      router.push(user.isNewUser ? '/onboarding' : '/dashboard')
    } catch (err) {
      console.error(err)
      toast.error('Failed to sign in with Google')
    }
  }

  async function handleEmailSignup() {
    try {
      setLoading(true)
      setError(null)

      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match')
        return
      }

      if (formData.password.length < 6) {
        setError('Password must be at least 6 characters')
        return
      }

      // Create Firebase user
      const result = await createUserWithEmailAndPassword(auth, formData.email, formData.password)
      
      // Get Firebase ID token
      const idToken = await result.user.getIdToken()
      
      // Call backend to create user with additional data
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          idToken,
          name: formData.name,
          email: formData.email
        })
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Signup failed')
      }
      
      if (!data.success || !data.user) {
        throw new Error('Invalid response from server')
      }
      
      setUser(data.user)
      toast.success(`Welcome to Kinso, ${data.user.name}!`)
      router.push('/onboarding')
    } catch (err) {
      console.error(err)
      const error = err as { code?: string; message?: string }
      if (error.code === 'auth/email-already-in-use') {
        setError('Email already in use. Try signing in instead.')
      } else if (error.code === 'auth/weak-password') {
        setError('Password is too weak. Please choose a stronger password.')
      } else if (error.code === 'auth/invalid-email') {
        setError('Invalid email address.')
      } else {
        setError(error.message || 'Failed to create account. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailSignin() {
    try {
      setLoading(true)
      setError(null)

      // Sign in with Firebase
      const result = await signInWithEmailAndPassword(auth, formData.email, formData.password)
      
      // Get Firebase ID token
      const idToken = await result.user.getIdToken()
      
      // Call backend to validate token and create session
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Login failed')
      }
      
      if (!data.success || !data.user) {
        throw new Error('Invalid response from server')
      }
      
      setUser(data.user)
      toast.success(`Welcome back, ${data.user.name}!`)
      router.push('/dashboard')
    } catch (err) {
      console.error(err)
      const error = err as { code?: string; message?: string }
      if (error.code === 'auth/user-not-found') {
        setError('No account found with this email. Try signing up instead.')
      } else if (error.code === 'auth/wrong-password') {
        setError('Incorrect password.')
      } else if (error.code === 'auth/invalid-email') {
        setError('Invalid email address.')
      } else {
        setError(error.message || 'Failed to sign in. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError(null) // Clear errors when user starts typing
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold">
            Welcome to Kinso
          </CardTitle>
          <CardDescription>
            Manage your high-signal relationships across platforms
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {/* Google Sign In */}
          <Button 
            variant="outline" 
            onClick={handleGoogleAuth}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Icons.google className="mr-2 h-4 w-4" />
            )}
            Continue with Google
          </Button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>
          
          {/* Email Auth Tabs */}
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signin-email">Email</Label>
                <Input 
                  id="signin-email" 
                  type="email" 
                  placeholder="name@example.com"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signin-password">Password</Label>
                <Input 
                  id="signin-password" 
                  type="password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <Button 
                className="w-full" 
                onClick={handleEmailSignin}
                disabled={isLoading || !formData.email || !formData.password}
              >
                {isLoading && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>
            </TabsContent>
            
            <TabsContent value="signup" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name">Full Name</Label>
                <Input 
                  id="signup-name" 
                  type="text" 
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input 
                  id="signup-email" 
                  type="email" 
                  placeholder="name@example.com"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <Input 
                  id="signup-password" 
                  type="password"
                  placeholder="At least 6 characters"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-confirm">Confirm Password</Label>
                <Input 
                  id="signup-confirm" 
                  type="password"
                  placeholder="Confirm your password"
                  value={formData.confirmPassword}
                  onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <Button 
                className="w-full" 
                onClick={handleEmailSignup}
                disabled={isLoading || !formData.email || !formData.password || !formData.name}
              >
                {isLoading && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
                Create Account
              </Button>
            </TabsContent>
          </Tabs>
          
          <p className="text-xs text-center text-muted-foreground">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </CardContent>
      </Card>
    </div>
  )
} 