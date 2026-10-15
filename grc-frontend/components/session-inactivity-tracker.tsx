"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AlertCircle, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fetchApi } from "@/lib/api"

interface SessionInactivityTrackerProps {
  onLogout: () => void
}

export function SessionInactivityTracker({ onLogout }: SessionInactivityTrackerProps) {
  const [timeoutMinutes, setTimeoutMinutes] = useState(240) // Default 4 hours
  const [showWarning, setShowWarning] = useState(false)
  const [secondsRemaining, setSecondsRemaining] = useState(120)

  const lastActivityRef = useRef<number>(Date.now())
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch configured timeout from organization settings
  useEffect(() => {
    fetchApi("organization")
      .then((res) => res.json())
      .then((data) => {
        if (data?.session_timeout && typeof data.session_timeout === "number") {
          setTimeoutMinutes(data.session_timeout)
        }
      })
      .catch(() => {})
  }, [])

  const resetActivity = () => {
    lastActivityRef.current = Date.now()
    if (showWarning) {
      setShowWarning(false)
      setSecondsRemaining(120)
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
      toast.info("Session Extended", { description: "Your activity refreshed the session timer." })
    }
  }

  useEffect(() => {
    const activityEvents = ["mousedown", "keydown", "touchstart", "scroll"]
    const handleActivity = () => {
      // Throttle activity updates to once per 10 seconds unless in warning
      const now = Date.now()
      if (now - lastActivityRef.current > 10000 || showWarning) {
        lastActivityRef.current = now
      }
    }

    activityEvents.forEach((event) => window.addEventListener(event, handleActivity))

    // Check inactivity every 15 seconds
    const interval = setInterval(() => {
      const now = Date.now()
      const elapsedMs = now - lastActivityRef.current
      const totalTimeoutMs = timeoutMinutes * 60 * 1000
      const warningThresholdMs = totalTimeoutMs - 2 * 60 * 1000 // 2 minutes before

      if (elapsedMs >= totalTimeoutMs) {
        // Timed out
        clearInterval(interval)
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
        toast.error("Session Expired", { description: "You were logged out due to inactivity." })
        onLogout()
      } else if (elapsedMs >= warningThresholdMs && !showWarning) {
        setShowWarning(true)
        const remaining = Math.max(0, Math.floor((totalTimeoutMs - elapsedMs) / 1000))
        setSecondsRemaining(remaining)

        // Countdown second by second
        countdownIntervalRef.current = setInterval(() => {
          setSecondsRemaining((prev) => {
            if (prev <= 1) {
              if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
              onLogout()
              return 0
            }
            return prev - 1
          })
        }, 1000)
      }
    }, 15000)

    return () => {
      activityEvents.forEach((event) => window.removeEventListener(event, handleActivity))
      clearInterval(interval)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [timeoutMinutes, showWarning, onLogout])

  if (!showWarning) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
      <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-card/95 p-4 shadow-xl backdrop-blur-md max-w-sm">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Clock className="size-5" />
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-xs font-semibold text-foreground">Inactivity Timeout Warning</p>
          <p className="text-xs text-muted-foreground">
            Logging out in <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{secondsRemaining}s</span> due to inactivity.
          </p>
        </div>
        <Button size="sm" variant="default" onClick={resetActivity} className="h-8 text-xs shrink-0">
          Stay Logged In
        </Button>
      </div>
    </div>
  )
}

