import { AuthDebugPanel } from '@/components/AuthDebugPanel'

export default function AuthTestPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Authentication Test
          </h1>
          <p className="text-gray-600">
            Test the Google Auth sign-up/sign-in flow and session management
          </p>
        </div>
        
        <div className="flex justify-center">
          <AuthDebugPanel />
        </div>
        
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>This page is for development testing only.</p>
        </div>
      </div>
    </div>
  )
} 