"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { fetchApi } from "@/lib/api"

interface DeviceLogsResponse {
  logs: string[]
  count: number
  truncated: boolean
  error?: string
}

export function DeviceLogs() {
  const [logs, setLogs] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLogs = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetchApi("system/device-logs/")
      const data: DeviceLogsResponse = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Unable to load device logs.")
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
  }, [])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])

  function downloadLogs() {
    const file = new Blob([logs.join("\n")], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(file)
    const link = document.createElement("a")
    link.href = url
    link.download = "edge-grc-device-logs.txt"
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
            available here; common credentials, contact details, IP addresses, and
            device or user identifiers are redacted. Review the file before sharing:
            automated redaction cannot guarantee removal of every sensitive value.
            Formal activity records remain in Audit Logs.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={downloadLogs} disabled={!logs.length}>
            <Download className="size-4" aria-hidden />
            Download
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadLogs()} disabled={isLoading}>
            <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
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
    </Card>
  )
}
