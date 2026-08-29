"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Initialize QueryClient inside useState to ensure it is only created once per user session
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // Data remains "fresh" for 5 minutes
            refetchOnWindowFocus: true, // Auto-refresh when user tabs back
            retry: 1, // Only retry failed requests once to prevent spamming
          },
        },
      })
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}