"use client"

/**
 * @fileoverview Main compliance controls table component.
 *
 * Displays all compliance controls across imported frameworks (e.g., SOC 2, NIST, PCI-DSS).
 * Provides multi-faceted filtering (framework, implementation status, effectiveness),
 * full-text search, expandable detail drawers with mapped crosswalk relationships,
 * and launches modal dialogs for evidence upload and approval workflows.
 */

import { useEffect, useMemo, useState, Fragment } from "react"
import { Search, Pencil, ListFilter, Eye, ChevronDown, AlertTriangle, ListTodo, X, ClipboardCheck, CalendarClock, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EditEvidenceDialog } from "@/components/edit-evidence-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CONTROL_STATUSES,
  EFFECTIVENESS_STATUSES,
  type ComplianceControl,
  type ControlStatus,
  type EffectivenessStatus,
} from "@/lib/controls"
import { fetchApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// --- NEW: React Query Imports ---
import { useControls } from "@/hooks/use-grc-data"
import { useQueryClient } from "@tanstack/react-query"

type StatusFilter = "All" | ControlStatus

interface FrameworkRemovalCheck {
  error?: string
  framework: string
  has_work: boolean
  work_summary: Record<string, number>
  affected_control_count: number
  affected_controls: Array<{ control_id: string; work: string[] }>
  controls_truncated: boolean
  confirmation_token: string
}

function isFrameworkRemovalCheck(value: unknown): value is FrameworkRemovalCheck {
  if (!value || typeof value !== "object") return false
  const check = value as Record<string, unknown>
  return (
    typeof check.confirmation_token === "string"
    && typeof check.framework === "string"
    && typeof check.has_work === "boolean"
    && typeof check.work_summary === "object"
    && check.work_summary !== null
    && typeof check.affected_control_count === "number"
    && Array.isArray(check.affected_controls)
    && typeof check.controls_truncated === "boolean"
  )
}

const FRAMEWORK_WORK_LABELS: Record<string, string> = {
  evaluation: "Evaluated controls",
  evidence: "Controls with evidence or proof files",
  audit: "Controls with audit schedules, test plans, or assessments",
  remediation: "Controls with remediation tasks",
  risk: "Controls linked to risks",
}

function getControlGroupKey(framework: string | null | undefined, requirementTitle: string | null | undefined) {
  return JSON.stringify([framework || null, requirementTitle || "General Requirements"])
}

interface ControlsTableProps {
  targetControlId?: string | null
  onClearTarget?: () => void
  targetFilter?: "Passing" | "Failing" | "Awaiting Approval" | "All" | null
  onClearFilter?: () => void
  onRiskClick?: (riskId: string) => void
}

function StatusBadge({ status }: { status: ControlStatus }) {
  const styles: Record<ControlStatus, string> = {
    Passing: "border-transparent bg-success/15 text-success",
    Failing: "border-transparent bg-destructive/15 text-destructive",
    "Not Evaluated": "border-transparent bg-muted text-muted-foreground",
    "Ready for Audit": "border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400",
    "Awaiting Approval": "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
    "Not Applicable": "border-transparent bg-secondary/60 text-secondary-foreground opacity-80",
  }
  const dot: Record<ControlStatus, string> = {
    Passing: "bg-success",
    Failing: "bg-destructive",
    "Not Evaluated": "bg-muted-foreground/60",
    "Ready for Audit": "bg-blue-500",
    "Awaiting Approval": "bg-amber-500",
    "Not Applicable": "bg-secondary-foreground/50",
  }
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", styles[status])}>
      <span className={cn("size-1.5 rounded-full", dot[status])} aria-hidden />
      {status}
    </Badge>
  )
}

export function ControlsTable({ targetControlId, onClearTarget, targetFilter, onClearFilter, onRiskClick }: ControlsTableProps = {}) {
  // Connect to the global cache
  const { data: controls = [], isLoading } = useControls()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState("")
  const [frameworkFilter, setFrameworkFilter] = useState<string>("All")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")
  const [designFilter, setDesignFilter] = useState<"All" | EffectivenessStatus>("All")
  const [operatingFilter, setOperatingFilter] = useState<"All" | EffectivenessStatus>("All")
  const [editing, setEditing] = useState<ComplianceControl | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [frameworkToRemove, setFrameworkToRemove] = useState<string | null>(null)
  const [removalCheck, setRemovalCheck] = useState<FrameworkRemovalCheck | null>(null)
  const [isRemovingFramework, setIsRemovingFramework] = useState(false)
  const [removalUsername, setRemovalUsername] = useState("")
  const [removalPassword, setRemovalPassword] = useState("")

  useEffect(() => {
    setRole(localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role"));
  }, []);

  useEffect(() => {
    if (targetControlId && controls.length > 0) {
      const targetControl = controls.find((c) => c.id === targetControlId)
      if (targetControl) {
        setEditing(targetControl)
        const groupKey = getControlGroupKey(targetControl.framework, targetControl.requirement_title)
        setExpandedGroups((prev) => ({ ...prev, [groupKey]: true }))
        onClearTarget?.() 
      }
    }
  }, [targetControlId, controls, onClearTarget])

  useEffect(() => {
    if (targetFilter) {
      setStatusFilter(targetFilter)
      onClearFilter?.() 
    }
  }, [targetFilter, onClearFilter])

  const availableFrameworks = useMemo(() => {
    const set = new Set<string>()
    controls.forEach((c) => {
      if (c.framework) set.add(c.framework)
    })
    return Array.from(set).sort()
  }, [controls])

  const frameworkControlCounts = useMemo(() => {
    const counts = new Map<string, number>()
    controls.forEach((control) => {
      if (control.framework) {
        counts.set(control.framework, (counts.get(control.framework) ?? 0) + 1)
      }
    })
    return counts
  }, [controls])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return controls.filter((c) => {
      const matchesQuery =
        !q || 
        c.id.toLowerCase().includes(q) || 
        c.description.toLowerCase().includes(q) ||
        c.requirement_title?.toLowerCase().includes(q) ||
        c.framework?.toLowerCase().includes(q)
      
      const matchesFramework = frameworkFilter === "All" || c.framework === frameworkFilter
      const matchesStatus = statusFilter === "All" || c.status === statusFilter
      const matchesDesign = designFilter === "All" || c.control_effectiveness === designFilter
      const matchesOperating = operatingFilter === "All" || c.implementation_effectiveness === operatingFilter

      return matchesQuery && matchesFramework && matchesStatus && matchesDesign && matchesOperating
    })
  }, [controls, query, frameworkFilter, statusFilter, designFilter, operatingFilter])

  const groupedControls = useMemo(() => {
    const groups: Record<string, { framework: string | null; title: string; controls: ComplianceControl[] }> = {}
    filtered.forEach((c) => {
      const title = c.requirement_title || "General Requirements"
      const framework = c.framework || null
      const groupKey = getControlGroupKey(framework, title)
      if (!groups[groupKey]) groups[groupKey] = { framework, title, controls: [] }
      groups[groupKey].controls.push(c)
    })
    return groups
  }, [filtered])

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }))
  }

  function closeFrameworkRemoval() {
    if (isRemovingFramework) return
    setFrameworkToRemove(null)
    setRemovalCheck(null)
    setRemovalUsername("")
    setRemovalPassword("")
  }

  async function handleRemoveFramework(
    confirmationToken?: string,
    credentials?: { username: string; password: string },
  ) {
    if (!frameworkToRemove) return

    setIsRemovingFramework(true)
    try {
      const response = await fetchApi("frameworks/remove/", {
        method: "POST",
        body: JSON.stringify({
          framework: frameworkToRemove,
          ...(confirmationToken ? { confirmation_token: confirmationToken } : {}),
          ...(credentials ? credentials : {}),
        }),
      })
      const data = await response.json()

      if (response.status === 409 && isFrameworkRemovalCheck(data)) {
        setRemovalCheck(data)
        return
      }

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Framework removal failed.",
        )
      }

      setFrameworkToRemove(null)
      setRemovalCheck(null)
      setRemovalUsername("")
      setRemovalPassword("")
      setFrameworkFilter("All")
      await queryClient.invalidateQueries({ queryKey: ["controls"] })
      toast.success(`${frameworkToRemove} removed`, {
        description: typeof data.warning === "string"
          ? data.warning
          : `${data.deleted_controls} controls were removed.`,
      })
    } catch (error) {
      console.error("Failed to remove framework", error)
      toast.error(
        error instanceof Error ? error.message : "Framework removal failed.",
      )
    } finally {
      setIsRemovingFramework(false)
      setRemovalPassword("")
    }
  }

  async function handleSave(updated: ComplianceControl) {
    try {
      const originalControl = controls.find((c) => c.id === updated.id);
      
      const originalProofIds = originalControl?.proofs?.map((p) => String(p.id)) || [];
      const currentProofIds = updated.proofs?.map((p) => String(p.id)) || [];
      const idsToDelete = originalProofIds.filter((id) => !currentProofIds.includes(id));

      for (const proofId of idsToDelete) {
        const delRes = await fetchApi(`proofs/${proofId}/`, { method: "DELETE" });
        if (!delRes.ok) toast.error("Failed to delete proof artifact.");
      }
      
      const response = await fetchApi(`controls/${updated.id}/`, {
        method: "PUT",
        body: JSON.stringify({
          control_id: updated.id,
          description: updated.description,
          status: updated.status,
          control_effectiveness: updated.control_effectiveness,
          implementation_effectiveness: updated.implementation_effectiveness,
          evidence: updated.evidence,
          tags: updated.tags,
        }),
      });

      if (response.ok) {
        if (updated.proofs) {
          for (const proof of updated.proofs) {
            if (proof.file) { 
              const formData = new FormData();
              formData.append('file', proof.file);
              const uploadRes = await fetchApi(`/controls/${updated.id}/proofs/`, {
                method: "POST",
                credentials: "include",
                body: formData, 
              });
              if (!uploadRes.ok) {
                const responseBody = await uploadRes.json().catch(() => null);
                const apiError = responseBody && typeof responseBody === "object" && "error" in responseBody
                  ? responseBody.error
                  : null;
                const errorMessage = Array.isArray(apiError)
                  ? apiError.join(" ")
                  : typeof apiError === "string"
                    ? apiError
                    : `Request failed with status ${uploadRes.status}.`;
                toast.error(`Failed to upload ${proof.name}: ${errorMessage}`);
                return;
              }
            }
          }
        }
        
        // --- NEW: Invalidate the global cache so all components refresh instantly ---
        queryClient.invalidateQueries({ queryKey: ["controls"] })
        setEditing(null);
      } else {
        toast.error("Failed to save changes. You may not have permission.");
      }
    } catch (error) {
      console.error("Failed to update control", error);
      toast.error("Network error occurred while saving.");
    }
  }

  const isReadOnlyRole = role === "Auditor" || role === "Executive";

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-4 border-b border-border p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-card-foreground text-balance">
            Control Matrix
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            Imported compliance controls and their current evaluation status.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center">
          <div className="relative w-full lg:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID or text..."
              className="pl-9 h-9"
              aria-label="Search controls by ID or text"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-muted/40 border border-border rounded-lg p-1.5">
            <div className="flex items-center gap-1.5 pl-2 pr-1">
              <ListFilter className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-xs font-medium text-muted-foreground hidden xl:inline-block">Filter By:</span>
            </div>

            {availableFrameworks.length > 0 && (
              <Select value={frameworkFilter} onValueChange={(v) => setFrameworkFilter(v ?? "All")}>
                <SelectTrigger className="min-w-[145px] w-auto h-7 bg-background text-xs" aria-label="Filter by framework">
                  <SelectValue placeholder="Framework" />
                </SelectTrigger>
                <SelectContent className="min-w-[200px]">
                  <SelectItem value="All">Framework: All</SelectItem>
                  {availableFrameworks.map((fw) => (
                    <SelectItem key={fw} value={fw}>
                      {fw}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="min-w-[155px] w-auto h-7 bg-background text-xs" aria-label="Filter by status">
                <SelectValue placeholder="Workflow Status" />
              </SelectTrigger>
              <SelectContent className="min-w-[220px]">
                <SelectItem value="All">Status: All</SelectItem>
                {CONTROL_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    Status: {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={designFilter} onValueChange={(v) => setDesignFilter(v as "All" | EffectivenessStatus)}>
              <SelectTrigger className="min-w-[145px] w-auto h-7 bg-background text-xs" aria-label="Filter by design evaluation">
                <SelectValue placeholder="Design Eval" />
              </SelectTrigger>
              <SelectContent className="min-w-[200px]">
                <SelectItem value="All">Design: All</SelectItem>
                {EFFECTIVENESS_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    Design: {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={operatingFilter} onValueChange={(v) => setOperatingFilter(v as "All" | EffectivenessStatus)}>
              <SelectTrigger className="min-w-[145px] w-auto h-7 bg-background text-xs" aria-label="Filter by operational evaluation">
                <SelectValue placeholder="Operational Eval" />
              </SelectTrigger>
              <SelectContent className="min-w-[200px]">
                <SelectItem value="All">Operation: All</SelectItem>
                {EFFECTIVENESS_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    Operation: {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(frameworkFilter !== "All" || statusFilter !== "All" || designFilter !== "All" || operatingFilter !== "All") && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setFrameworkFilter("All")
                  setStatusFilter("All")
                  setDesignFilter("All")
                  setOperatingFilter("All")
                }}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {availableFrameworks.length > 0 && (
        <div className="border-b border-border px-5 py-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">Imported frameworks</h3>
            <p className="text-xs text-muted-foreground">Select a framework to focus the controls matrix.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <button
              type="button"
              aria-pressed={frameworkFilter === "All"}
              aria-label={`Show all frameworks, ${controls.length} controls`}
              onClick={() => setFrameworkFilter("All")}
              className={cn(
                "flex min-h-[76px] min-w-0 flex-col items-start justify-center rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                frameworkFilter === "All"
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border bg-background hover:border-primary/40 hover:bg-accent/50",
              )}
            >
              <span className="text-sm font-medium text-foreground">All frameworks</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {controls.length.toLocaleString()} controls
              </span>
            </button>
            {availableFrameworks.map((framework) => {
              const isSelected = frameworkFilter === framework
              const count = frameworkControlCounts.get(framework) ?? 0
              return (
                <div
                  key={framework}
                  className={cn(
                    "flex min-h-[76px] min-w-0 items-center rounded-lg border transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border bg-background hover:border-primary/40",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Show ${framework}, ${count} controls`}
                    onClick={() => setFrameworkFilter(framework)}
                    className="flex min-h-[74px] min-w-0 flex-1 flex-col items-start justify-center rounded-l-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="w-full truncate text-sm font-medium text-foreground" title={framework}>
                      {framework}
                    </span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      {count.toLocaleString()} {count === 1 ? "control" : "controls"}
                    </span>
                  </button>
                  {role === "Admin" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mr-2 size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${framework}`}
                      title={`Remove ${framework}`}
                      onClick={() => {
                        setFrameworkToRemove(framework)
                        setRemovalCheck(null)
                        setRemovalUsername(
                          localStorage.getItem("grc_username")
                            || sessionStorage.getItem("grc_username")
                            || "",
                        )
                        setRemovalPassword("")
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table className="min-w-[720px] table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[140px]">Control ID</TableHead>
              <TableHead className="min-w-[280px]">Requirement Description</TableHead>
              <TableHead className="w-[150px]">Current Status</TableHead>
              <TableHead className="w-[90px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
               <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  Loading controls from database...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  {controls.length === 0
                    ? "No controls yet. Add one in your Django admin panel to see it here."
                    : "No controls match the current search and filter."}
                </TableCell>
              </TableRow>
            ) : (
              Object.entries(groupedControls)
                .sort(([, left], [, right]) => (left.framework ?? "").localeCompare(right.framework ?? ""))
                .map(([groupKey, group]) => {
                  const isExpanded = query.trim() !== "" || designFilter !== "All" || operatingFilter !== "All" || expandedGroups[groupKey]

                  return (
                    <Fragment key={groupKey}>
                      <TableRow
                        className="bg-muted/40 hover:bg-muted/60 cursor-pointer border-b border-border"
                        onClick={() => toggleGroup(groupKey)}
                      >
                        <TableCell colSpan={4} className="py-3">
                          <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                            <ChevronDown
                              className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", isExpanded ? "" : "-rotate-90")}
                              aria-hidden
                            />
                            {group.framework && (
                              <Badge variant="outline" className="max-w-[220px] border-primary/25 bg-primary/10 text-xs font-medium text-primary" title={group.framework}>
                                <span className="min-w-0 truncate">{group.framework}</span>
                              </Badge>
                            )}
                            <span>{group.title}</span>
                            <Badge variant="secondary" className="ml-2 bg-background font-mono text-[10px]">
                              {group.controls.length}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>

                      {isExpanded && group.controls.map((control) => {
                        const openTasksCount = control.remediation_tasks?.filter(t => t.status !== 'Resolved').length || 0;
                        const isPendingQA = control.assessments?.some(a => a.status === 'In QA Review');

                        return (
                          <TableRow key={control.id} className="bg-background">
                            <TableCell className="align-top font-mono text-sm font-medium pl-9">
                              <div>{control.id}</div>
                              {control.framework && (
                                <div className="mt-1">
                                  <Badge variant="outline" className="max-w-[120px] border-primary/25 bg-primary/10 px-1.5 py-0 text-[10px] font-medium tracking-tight text-primary" title={control.framework}>
                                    <span className="min-w-0 truncate">{control.framework}</span>
                                  </Badge>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-normal break-words text-pretty align-top text-muted-foreground">
                              <p className="mb-2">{control.description}</p>

                              {/* Render Tags */}
                              {control.tags && control.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {control.tags.map(tag => (
                                    <Badge key={tag} variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                                      #{tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {/* Render Automated Cross-Walk Links */}
                              {control.cross_walked_control_ids && control.cross_walked_control_ids.length > 0 && (
                                <div className="mb-1 text-[11px] text-muted-foreground">
                                  <span className="font-semibold text-foreground">Cross-walked to: </span>
                                  {control.cross_walked_control_ids.join(", ")}
                                </div>
                              )}

                              {/* Render Tied Risks */}
                              {control.mitigated_risk_ids && control.mitigated_risk_ids.length > 0 && (
                                <div className="mb-2 flex items-center flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                  <span className="font-semibold text-foreground">Mitigates Risk: </span>
                                  {control.mitigated_risk_ids.map(rId => (
                                    <button
                                      key={rId}
                                      type="button"
                                      onClick={() => onRiskClick?.(rId)}
                                      className="flex items-center gap-0.5 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-500"
                                      aria-label={`View risk ${rId} in the Risk Register`}
                                    >
                                      <AlertTriangle className="size-3" />
                                      {rId}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* --- Upcoming Schedule Indicator --- */}
                              {control.testing_frequency && control.testing_frequency !== "None" && control.next_audit_date && (
                                <div className="mb-2 flex items-center flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                  <span className="font-semibold text-foreground">Audit Schedule: </span>
                                  <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400 font-medium bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                                    <CalendarClock className="size-3" />
                                    {control.testing_frequency}
                                  </span>
                                  <span className="text-muted-foreground font-medium">
                                    Next Due: {new Date(control.next_audit_date + "T12:00:00Z").toLocaleDateString()}
                                  </span>
                                  <span className="text-muted-foreground opacity-75">
                                    (Evidence requested: {new Date(new Date(control.next_audit_date + "T12:00:00Z").setDate(new Date(control.next_audit_date + "T12:00:00Z").getDate() - 30)).toLocaleDateString()})
                                  </span>
                                </div>
                              )}

                              {/* Render Open POA&M Tasks Indicator */}
                              {openTasksCount > 0 && (
                                <div className="mb-2 flex items-center flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                  <span className="font-semibold text-foreground">Active POA&M: </span>
                                  <span className="flex items-center gap-0.5 text-destructive font-medium bg-destructive/10 px-1.5 py-0.5 rounded border border-destructive/20">
                                    <ListTodo className="size-3" />
                                    {openTasksCount} Unresolved Task{openTasksCount !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              )}

                              {/* Render Pending QA Indicator */}
                              {isPendingQA && (
                                <div className="mb-2 flex items-center flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                  <span className="font-semibold text-foreground">Active Audit: </span>
                                  <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-500 font-medium bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                    <ClipboardCheck className="size-3" />
                                    Pending QA Review
                                  </span>
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2 mt-2">
                                {control.control_effectiveness && control.control_effectiveness !== "Not Tested" && (
                                  <Badge variant="outline" className={cn("text-[10px] font-medium border-transparent", control.control_effectiveness === "Deficient" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>
                                    Design: {control.control_effectiveness}
                                  </Badge>
                                )}
                                {control.implementation_effectiveness && control.implementation_effectiveness !== "Not Tested" && (
                                  <Badge variant="outline" className={cn("text-[10px] font-medium border-transparent", control.implementation_effectiveness === "Deficient" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>
                                    Operation: {control.implementation_effectiveness}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="align-top">
                              <StatusBadge status={control.status} />
                            </TableCell>
                            <TableCell className="text-right align-top">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => setEditing(control)}
                                aria-label={isReadOnlyRole ? `View control ${control.id}` : `Edit control ${control.id}`}
                                title={isReadOnlyRole ? "View control" : "Edit control"}
                              >
                                {isReadOnlyRole ? <Eye className="size-4" aria-hidden="true" /> : <Pencil className="size-4" aria-hidden="true" />}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </Fragment>
                  )
                })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground">
        <span>Showing {filtered.length} of {controls.length} controls</span>
      </div>

      <EditEvidenceDialog
        control={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={handleSave}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["controls"] })}
        userRole={role}
        onRiskClick={onRiskClick}
      />

      <Dialog
        open={frameworkToRemove !== null}
        onOpenChange={(open) => !open && closeFrameworkRemoval()}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-4" aria-hidden />
              {removalCheck?.has_work ? "Work found in this framework" : "Remove framework?"}
            </DialogTitle>
            <DialogDescription className="text-pretty">
              {removalCheck?.has_work
                ? `Removing ${frameworkToRemove} will permanently delete its controls and associated work. Review the affected controls before continuing.`
                : `Remove ${frameworkToRemove} and all of its controls? This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>

          {removalCheck && (
            <div className="space-y-3">
              {removalCheck.error && (
                <p className="text-sm text-muted-foreground">{removalCheck.error}</p>
              )}
              {removalCheck.has_work ? (
                <>
                  <ul className="space-y-1 text-sm text-foreground">
                    {Object.entries(removalCheck.work_summary)
                      .filter(([, count]) => count > 0)
                      .map(([type, count]) => (
                        <li key={type}>
                          <span className="font-medium">{count}</span>{" "}
                          {FRAMEWORK_WORK_LABELS[type] ?? type}
                        </li>
                      ))}
                  </ul>
                  <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 p-3">
                    <p className="mb-2 text-xs font-medium text-foreground">
                      Affected controls ({removalCheck.affected_control_count})
                    </p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {removalCheck.affected_controls.map((control) => (
                        <li key={control.control_id}>
                          <span className="font-mono text-foreground">{control.control_id}</span>
                          <span>: {control.work.map((type) => FRAMEWORK_WORK_LABELS[type] ?? type).join(", ")}</span>
                        </li>
                      ))}
                    </ul>
                    {removalCheck.controls_truncated && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Additional affected controls are not shown.
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Linked risk records will remain, but their links to these controls will be removed.
                  </p>
                  <div className="space-y-3 rounded-md border border-border p-3">
                    <p className="text-sm font-medium text-foreground">
                      Verify administrator credentials to continue.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="framework-removal-username">Administrator username</Label>
                      <Input
                        id="framework-removal-username"
                        autoComplete="username"
                        value={removalUsername}
                        onChange={(event) => setRemovalUsername(event.target.value)}
                        disabled={isRemovingFramework}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="framework-removal-password">Administrator password</Label>
                      <Input
                        id="framework-removal-password"
                        type="password"
                        autoComplete="current-password"
                        value={removalPassword}
                        onChange={(event) => setRemovalPassword(event.target.value)}
                        disabled={isRemovingFramework}
                      />
                    </div>
                  </div>
                </>
              ) : removalCheck.error ? (
                <p className="text-sm text-muted-foreground">
                  No work is currently recorded on these controls. Review the changed state before confirming removal.
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isRemovingFramework}
              onClick={closeFrameworkRemoval}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                isRemovingFramework
                || Boolean(removalCheck?.has_work && (!removalUsername.trim() || !removalPassword))
              }
              onClick={() => handleRemoveFramework(
                removalCheck?.confirmation_token,
                removalCheck?.has_work
                  ? { username: removalUsername.trim(), password: removalPassword }
                  : undefined,
              )}
            >
              {isRemovingFramework
                ? "Removing..."
                : removalCheck?.has_work
                  ? "Remove anyway"
                  : removalCheck?.error
                    ? "Confirm removal"
                    : "Check and remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}