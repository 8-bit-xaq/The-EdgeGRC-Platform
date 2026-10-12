'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Next.js route error captured:', error)
  }, [error])

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-lg rounded-xl border border-destructive/20 bg-card p-6 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <div className="flex-1 space-y-1">
            <h3 className="text-base font-semibold text-foreground">
              Application Error
            </h3>
            <p className="text-xs text-muted-foreground">
              An unexpected error occurred in the Edge GRC application interface.
            </p>
            {error && (
              <div className="mt-3 rounded-md bg-muted/60 p-3 font-mono text-xs text-foreground/80 overflow-x-auto max-h-36">
                {error.message || 'Unknown runtime error'}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Reload Page
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => reset()}
            className="gap-1.5"
          >
            <RotateCcw className="size-3.5" />
            Try Again
          </Button>
        </div>
      </div>
    </div>
  )
}

