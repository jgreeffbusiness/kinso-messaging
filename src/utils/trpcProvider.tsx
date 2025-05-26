'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { trpc } from './trpc'
import { httpBatchLink } from '@trpc/client'
import { useState } from 'react'
import superjson from 'superjson'

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Cache data for 5 minutes before considering it stale
        staleTime: 5 * 60 * 1000, // 5 minutes
        // Keep data in cache for 10 minutes
        gcTime: 10 * 60 * 1000, // 10 minutes
        // Don't refetch on window focus by default
        refetchOnWindowFocus: false,
        // Don't refetch on reconnect by default
        refetchOnReconnect: false,
        // Don't automatically refetch in background
        refetchInterval: false,
        // Retry failed requests only once
        retry: 1,
        // Don't retry on mount
        retryOnMount: false,
      },
    },
  }))
  
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
        }),
      ],
    })
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  )
}
