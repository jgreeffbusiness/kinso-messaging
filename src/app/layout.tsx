import './globals.css'
import { Inter } from 'next/font/google'
import { TrpcProvider } from '@utils/trpcProvider'
import { AuthProvider } from '@components/AuthProvider' 
import { UserSessionProvider } from '@components/UserSessionProvider'
import { ChatProvider } from '@providers/ChatProvider'
import { SelectedMessageProvider } from '@providers/SelectedMessageProvider'
import { AutoSyncInitializer } from '@components/AutoSyncInitializer'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SelectedMessageProvider>
          <ChatProvider>
            <AuthProvider>
              <UserSessionProvider>
                <TrpcProvider>
                  <AutoSyncInitializer />
                  {children}
                </TrpcProvider>
              </UserSessionProvider>
            </AuthProvider>
          </ChatProvider>
        </SelectedMessageProvider>
      </body>
    </html>
  )
}
