"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Download, RefreshCw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fetchApi } from "@/lib/api"

interface DeviceLogsResponse {
  logs: string[]
  count: number
  truncated: boolean
  view: "sanitized" | "unsanitized"
  error?: string
}

export function DeviceLogs() {
  const [logs, setLogs] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUnsanitized, setShowUnsanitized] = useState(false)
  const [confirmUnsanitized, setConfirmUnsanitized] = useState(false)

  const loadLogs = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setLogs([])

    try {
      const endpoint = showUnsanitized
        ? "system/device-logs/?view=unsanitized"
        : "system/device-logs/"
      const response = await fetchApi(endpoint)
      const data: DeviceLogsResponse = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Unable to load device logs.")
      }
      if (data.view !== (showUnsanitized ? "unsanitized" : "sanitized")) {
        throw new Error("The returned log view did not match the selected view.")
      }

      setLogs(data.logs)
      setTruncated(data.truncated)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load device logs."
      setError(message)
      toast.error("Failed to load device logs", { description: message })
    } finally {
      setIsLoading(false)
    }
  }, [showUnsanitized])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])

  function downloadLogs() {
    const file = new Blob([logs.join("\n")], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(file)
    const link = document.createElement("a")
    link.href = url
    link.download = showUnsanitized
      ? "edge-grc-device-logs-UNSANITIZED.txt"
      : "edge-grc-device-logs-SANITIZED.txt"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1.5">
          <CardTitle>Device logs</CardTitle>
          <CardDescription>
            Recent backend operational logs for troubleshooting. Up to 500 lines are
            available here. Formal activity records remain in Audit Logs.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div
          role="status"
          className={`mb-4 flex items-start gap-3 rounded-md border p-4 ${
            showUnsanitized
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : "border-border bg-muted/40 text-foreground"
          }`}
        >
          {showUnsanitized ? (
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          ) : (
            <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {showUnsanitized ? "UNSANITIZED VIEW — RAW DEVICE LOGS" : "SANITIZED VIEW"}
            </p>
            <p className="mt-1 text-sm">
              {showUnsanitized
                ? "This view may contain credentials, personal information, IP addresses, and device identifiers. Do not share or send this file unless you have reviewed and intentionally approved its contents."
                : "Common credentials and identifying details are redacted. Automated redaction is best-effort; review logs before sharing."}
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={showUnsanitized ? "destructive" : "outline"}
            size="sm"
            onClick={() => {
              if (showUnsanitized) {
                setShowUnsanitized(false)
              } else {
                setConfirmUnsanitized(true)
              }
            }}
            disabled={isLoading}
          >
            {showUnsanitized ? "Switch to sanitized view" : "Show unsanitized logs"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={downloadLogs} disabled={!logs.length || isLoading}>
            <Download className="size-4" aria-hidden />
            {showUnsanitized ? "Download unsanitized logs" : "Download sanitized logs"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadLogs()} disabled={isLoading}>
            <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden />
            Refresh {showUnsanitized ? "unsanitized" : "sanitized"} logs
          </Button>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </p>
        ) : logs.length === 0 && !isLoading ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            No device logs are available yet.
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-auto rounded-md border border-border bg-muted/40 p-4" aria-busy={isLoading}>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
              {logs.join("\n")}
            </pre>
          </div>
        )}
        {truncated && !error && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing only the most recent logs. Earlier entries have been omitted.
          </p>
        )}
      </CardContent>
      <Dialog open={confirmUnsanitized} onOpenChange={setConfirmUnsanitized}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden />
              Show unsanitized device logs?
            </DialogTitle>
            <DialogDescription>
              Raw logs may expose passwords, tokens, personal information, IP addresses, or
              device details. The unsanitized download will contain those same raw values.
              Only continue if you are authorized to view them and will handle them securely.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmUnsanitized(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmUnsanitized(false)
                setShowUnsanitized(true)
              }}
            >
              Show raw logs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
