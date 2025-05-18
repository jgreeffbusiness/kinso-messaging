import './globals.css'
import { Inter } from 'next/font/google'
import { TrpcProvider } from '@utils/trpcProvider'
import { AuthProvider } from '@components/AuthProvider' 
import { UserSessionProvider } from '@components/UserSessionProvider'
import { ChatProvider } from '@providers/ChatProvider'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ChatProvider>
          <AuthProvider>
            <UserSessionProvider>
              <TrpcProvider>
                {children}
              </TrpcProvider>
            </UserSessionProvider>
          </AuthProvider>
        </ChatProvider>
      </body>
    </html>
  )
