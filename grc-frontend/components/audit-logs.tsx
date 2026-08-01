"use client"

import { Fragment, useMemo, useState, useEffect } from "react"
import { ChevronDown, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { toast } from "sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AUDIT_CATEGORIES,
  DATE_RANGES,
  formatTimestamp,
  isWithinRange,
  relativeTime,
  type AuditCategory,
  type AuditLogEntry,
  type AuditSeverity,
  type DateRangeValue,
} from "@/lib/audit-logs"
import { ThirdPartyAuditExporter } from "@/components/third-party-audit-exporter"
import { initials } from "@/lib/users"
import { cn } from "@/lib/utils"
import { fetchApi } from "@/lib/api" // <-- NEW: API Wrapper

function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const styles: Record<AuditSeverity, string> = {
    Success: "border-transparent bg-success/15 text-success",
    Warning: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
    Critical: "border-transparent bg-destructive/15 text-destructive",
  }
  const dot: Record<AuditSeverity, string> = {
    Success: "bg-success",
    Warning: "bg-amber-500",
    Critical: "bg-destructive",
  }
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", styles[severity])}>
      <span className={cn("size-1.5 rounded-full", dot[severity])} aria-hidden />
      {severity}
    </Badge>
  )
}

export function AuditLogs() {
  const [query, setQuery] = useState("")
  const [range, setRange] = useState<DateRangeValue>("30d")
  const [category, setCategory] = useState<AuditCategory | "all">("all")
  const [severity, setSeverity] = useState<AuditSeverity | "all">("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10) 
  const [expanded, setExpanded] = useState<string | null>(null)
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchApi("auditlogs/")
      .then((res) => {
        if (!res.ok) throw new Error("Network response was not ok")
        return res.json()
      })
      .then((data) => {
        const formattedLogs: AuditLogEntry[] = data.map((dLog: any) => {
          let actionLabel = "Modified Record"
          let logSeverity: AuditSeverity = "Success"
          
          if (dLog.action === 0) {
            actionLabel = "Created Record"
            logSeverity = "Success"
          } else if (dLog.action === 1) {
            actionLabel = dLog.changed_fields 
              ? `Updated (${dLog.changed_fields})` 
              : "Updated Record"
            logSeverity = "Warning" 
          } else if (dLog.action === 2) {
            actionLabel = "Deleted Record"
            logSeverity = "Critical"
          }

          const defaultCategory = AUDIT_CATEGORIES.length > 0 ? AUDIT_CATEGORIES[0] : "System"

          return {
            id: String(dLog.id),
            timestamp: dLog.timestamp,
            actor: { name: dLog.actor_name || "System", email: "" },
            action: actionLabel,
            category: defaultCategory as AuditCategory,
            resource: dLog.object_repr || "Unknown Resource",
            severity: logSeverity,
            metadata: { modified_fields: dLog.changed_fields || "None" },
          }
        })
        setLogs(formattedLogs)
      })
      .catch((err) => {
        console.error("Failed to fetch audit logs", err)
        toast.error("Failed to load audit logs")
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((log) => {
      if (!isWithinRange(log.timestamp, range)) return false
      if (category !== "all" && log.category !== category) return false
      if (severity !== "all" && log.severity !== severity) return false
      if (!q) return true
      return (
        log.actor.name.toLowerCase().includes(q) ||
        log.actor.email.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.resource.toLowerCase().includes(q)
      )
    })
  }, [logs, query, range, category, severity])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  function resetPage() {
    setPage(1)
    setExpanded(null)
  }

  function clearFilters() {
    setQuery("")
    setRange("30d")
    setCategory("all")
    setSeverity("all")
    resetPage()
  }

  const getPageNumbers = (current: number, total: number) => {
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
    if (current <= 3) return [1, 2, 3, 4, "...", total]
    if (current >= total - 2) return [1, "...", total - 3, total - 2, total - 1, total]
    return [1, "...", current - 1, current, current + 1, "...", total]
  }

  const hasActiveFilters = range !== "30d" || category !== "all" || severity !== "all" || query !== ""

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); resetPage() }}
            placeholder="Search users or events..."
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(v) => { setRange(v as DateRangeValue); resetPage() }}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={(v) => { setCategory(v as AuditCategory | "all"); resetPage() }}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {AUDIT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={severity} onValueChange={(v) => { setSeverity(v as AuditSeverity | "all"); resetPage() }}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="Success">Success (Create)</SelectItem>
              <SelectItem value="Warning">Warning (Update)</SelectItem>
              <SelectItem value="Critical">Critical (Delete)</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground">
              <X className="size-3.5 mr-1" /> Clear Filters
            </Button>
          )}

          <div className="ml-auto">
            <ThirdPartyAuditExporter />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[40px]" />
              <TableHead className="w-[130px]">Timestamp</TableHead>
              <TableHead className="min-w-[180px]">Actor</TableHead>
              <TableHead className="min-w-[220px]">Action</TableHead>
              <TableHead className="min-w-[180px]">Resource</TableHead>
              <TableHead className="w-[130px]">Severity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Loading audit logs...</TableCell></TableRow>
            ) : pageItems.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No audit events match your filters.</TableCell></TableRow>
            ) : (
              pageItems.map((log, index) => {
                const isOpen = expanded === log.id
                return (
                  <Fragment key={log.id}>
                    <TableRow
                      className={cn("cursor-pointer align-top", index % 2 === 1 && "bg-muted/40", isOpen && "bg-accent/60 hover:bg-accent/60")}
                      onClick={() => setExpanded(isOpen ? null : log.id)}
                    >
                      <TableCell className="py-3">
                        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
                      </TableCell>
                      <TableCell className="py-3 whitespace-nowrap text-sm text-muted-foreground" title={formatTimestamp(log.timestamp)}>
                        {relativeTime(log.timestamp)}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar size="sm"><AvatarFallback>{initials(log.actor.name)}</AvatarFallback></Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{log.actor.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{log.actor.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <p className="text-sm text-foreground text-pretty">{log.action}</p>
                        <span className="mt-0.5 inline-block text-xs text-muted-foreground">{log.category}</span>
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="font-mono text-xs text-muted-foreground text-pretty">{log.resource}</span>
                      </TableCell>
                      <TableCell className="py-3">
                        <SeverityBadge severity={log.severity} />
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-muted/30 p-0">
                          <div className="px-4 py-4 sm:px-6">
                            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>Event ID: <span className="font-mono text-foreground">{log.id}</span></span>
                              <span>Recorded: <span className="text-foreground">{formatTimestamp(log.timestamp)}</span></span>
                            </div>
                            <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-foreground">
                              {JSON.stringify({ id: log.id, timestamp: log.timestamp, actor: log.actor, action: log.action, category: log.category, resource: log.resource, severity: log.severity, metadata: log.metadata }, null, 2)}
                            </pre>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col items-center justify-between gap-4 border-t border-border px-4 py-3 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            {filtered.length === 0 ? "No events" : `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length} events`}
          </p>
          <div className="flex items-center gap-2 border-l border-border pl-3">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); setExpanded(null) }}>
              <SelectTrigger className="h-8 w-[70px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => { setPage((p) => Math.max(1, p - 1)); setExpanded(null) }} disabled={currentPage === 1}>Previous</Button>
          {getPageNumbers(currentPage, totalPages).map((p, i) => (
            p === "..." ? <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm">...</span> : (
              <Button key={p} variant={p === currentPage ? "default" : "outline"} size="sm" className="w-9" onClick={() => { setPage(p as number); setExpanded(null) }}>{p}</Button>
            )
          ))}
          <Button variant="outline" size="sm" onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); setExpanded(null) }} disabled={currentPage === totalPages}>Next</Button>
        </div>
      </div>
    </section>
  )
}