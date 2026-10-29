'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React ErrorBoundary exception:', error, errorInfo)
  }

  public resetError = () => {
    if (this.props.onReset) {
      this.props.onReset()
    }
    this.setState({ hasError: false, error: null })
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        if (this.state.error) {
          return this.props.fallback(this.state.error, this.resetError)
        }
      } else if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="min-h-[360px] w-full flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-destructive/20 bg-card p-6 shadow-lg">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle className="size-5" />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="text-base font-semibold text-foreground">
                  An unexpected interface error occurred
                </h3>
                <p className="text-xs text-muted-foreground">
                  The application encountered an error while rendering this component. You can attempt to reset this section or refresh the page.
                </p>
                {this.state.error && (
                  <div className="mt-3 rounded-md bg-muted/60 p-3 font-mono text-xs text-foreground/80 overflow-x-auto max-h-36">
                    {this.state.error.message || String(this.state.error)}
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
                onClick={this.resetError}
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

    return this.props.children
  }
}
