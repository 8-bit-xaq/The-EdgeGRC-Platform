export type AuditSeverity = "Success" | "Warning" | "Critical"
export type AuditCategory = "Auth" | "Data Changes" | "System"

export interface AuditLogEntry {
  id: string
  timestamp: string // ISO string
  actor: { name: string; email: string }
  action: string
  category: AuditCategory
  resource: string
  severity: AuditSeverity
  /** Structured event metadata surfaced in the expandable row. */
  metadata: Record<string, unknown>
}

export const AUDIT_CATEGORIES: AuditCategory[] = ["Auth", "Data Changes", "System"]

export const DATE_RANGES = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
] as const

export type DateRangeValue = (typeof DATE_RANGES)[number]["value"]

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Build seed data relative to "now" so timestamps always look fresh. */
function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

// Seed audit trail. In production this would be fetched from the backend.
export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  
]

const RANGE_MS: Record<Exclude<DateRangeValue, "all">, number> = {
  "24h": DAY,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
  "90d": 90 * DAY,
}

export function isWithinRange(timestamp: string, range: DateRangeValue): boolean {
  if (range === "all") return true
  const cutoff = Date.now() - RANGE_MS[range]
  return new Date(timestamp).getTime() >= cutoff
}

/** Human-friendly relative time, e.g. "4m ago", "2h ago", "3d ago". */
export function relativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  if (diff < MINUTE) return "just now"
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Absolute formatted timestamp for the title attribute / expanded view. */
export function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function toCsv(entries: AuditLogEntry[]): string {
  const header = ["Timestamp", "Actor", "Email", "Action", "Category", "Resource", "Severity"]
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
  const rows = entries.map((e) =>
    [
      formatTimestamp(e.timestamp),
      e.actor.name,
      e.actor.email,
      e.action,
      e.category,
      e.resource,
      e.severity,
    ]
      .map((v) => escape(String(v)))
      .join(","),
  )
  return [header.map(escape).join(","), ...rows].join("\n")
}
