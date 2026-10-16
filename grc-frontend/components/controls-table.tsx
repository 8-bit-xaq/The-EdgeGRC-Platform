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
import { Search, Pencil, ListFilter, Eye, ChevronDown, AlertTriangle, ListTodo, X, ClipboardCheck, CalendarClock } from "lucide-react"
import { Input } from "@/components/ui/input"
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

interface ControlsTableProps {
  targetControlId?: string | null
  onClearTarget?: () => void
  targetFilter?: "Passing" | "Failing" | "Awaiting Approval" | "All" | null
  onClearFilter?: () => void
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

export function ControlsTable({ targetControlId, onClearTarget, targetFilter, onClearFilter }: ControlsTableProps = {}) {
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

  useEffect(() => {
    setRole(localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role"));
  }, []);

  useEffect(() => {
    if (targetControlId && controls.length > 0) {
      const targetControl = controls.find((c) => c.id === targetControlId)
      if (targetControl) {
        setEditing(targetControl)
        const groupName = targetControl.requirement_title || "General Requirements"
        setExpandedGroups((prev) => ({ ...prev, [groupName]: true }))
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return controls.filter((c) => {
      const matchesQuery =
        !q || 
        c.id.toLowerCase().includes(q) || 
        c.description.toLowerCase().includes(q) ||
        c.requirement_title?.toLowerCase().includes(q) ||
        c.process_mechanism?.toLowerCase().includes(q) ||
        c.framework?.toLowerCase().includes(q)
      
      const matchesFramework = frameworkFilter === "All" || c.framework === frameworkFilter
      const matchesStatus = statusFilter === "All" || c.status === statusFilter
      const matchesDesign = designFilter === "All" || c.control_effectiveness === designFilter
      const matchesOperating = operatingFilter === "All" || c.implementation_effectiveness === operatingFilter

      return matchesQuery && matchesFramework && matchesStatus && matchesDesign && matchesOperating
    })
  }, [controls, query, frameworkFilter, statusFilter, designFilter, operatingFilter])

  const groupedControls = useMemo(() => {
    const groups: Record<string, ComplianceControl[]> = {}
    filtered.forEach((c) => {
      const groupName = c.requirement_title || "General Requirements"
      if (!groups[groupName]) groups[groupName] = []
      groups[groupName].push(c)
    })
    return groups
  }, [filtered])

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }))
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
              if (!uploadRes.ok) toast.error(`Failed to upload ${proof.name}.`);
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
              Object.entries(groupedControls).map(([groupName, groupControls]) => {
                const isExpanded = query.trim() !== "" || designFilter !== "All" || operatingFilter !== "All" || expandedGroups[groupName]

                return (
                  <Fragment key={groupName}>
                    <TableRow 
                      className="bg-muted/40 hover:bg-muted/60 cursor-pointer border-b border-border"
                      onClick={() => toggleGroup(groupName)}
                    >
                      <TableCell colSpan={4} className="py-3">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <ChevronDown 
                            className={cn("size-4 text-muted-foreground transition-transform duration-200", isExpanded ? "" : "-rotate-90")} 
                            aria-hidden 
                          />
                          {groupName}
                          <Badge variant="secondary" className="ml-2 bg-background font-mono text-[10px]">
                            {groupControls.length}
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>

                    {isExpanded && groupControls.map((control) => {
                      const openTasksCount = control.remediation_tasks?.filter(t => t.status !== 'Resolved').length || 0;
                      const isPendingQA = control.assessments?.some(a => a.status === 'In QA Review');
                      
                      return (
                        <TableRow key={control.id} className="bg-background">
                          <TableCell className="align-top font-mono text-sm font-medium pl-9">
                            <div>{control.id}</div>
                            {control.framework && (
                              <div className="mt-1">
                                <Badge variant="outline" className="text-[10px] font-normal tracking-tight px-1.5 py-0 bg-muted/40 text-muted-foreground border-border max-w-[120px] truncate block" title={control.framework}>
                                  {control.framework}
                                </Badge>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-normal break-words text-pretty align-top text-muted-foreground">
                            {control.process_mechanism && (
                              <p className="text-[13px] font-semibold text-foreground mb-1">
                                {control.process_mechanism}
                              </p>
                            )}
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
                                  <span key={rId} className="flex items-center gap-0.5 text-amber-600 dark:text-amber-500 font-medium bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                    <AlertTriangle className="size-3" />
                                    {rId}
                                  </span>
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
      />
    </section>
  )
}