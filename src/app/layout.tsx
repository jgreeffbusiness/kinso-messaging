import './globals.css'
import { Inter } from 'next/font/google'
import { TrpcProvider } from '@utils/trpcProvider'
import { AuthProvider } from '@components/AuthProvider' 
import { ChatProvider } from '@providers/ChatProvider'
import { ActiveFocusProvider } from '@providers/ActiveFocusProvider'
import { AutoSyncInitializer } from '@components/AutoSyncInitializer'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ActiveFocusProvider>
          <ChatProvider>
            <AuthProvider>
              <TrpcProvider>
                <AutoSyncInitializer />
                {children}
              </TrpcProvider>
            </AuthProvider>
          </ChatProvider>
        </ActiveFocusProvider>
      </body>
    </html>
  )
}
