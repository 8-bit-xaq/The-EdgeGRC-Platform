"use client"

/**
 * @fileoverview Modal dialog for inspecting and updating a compliance control.
 *
 * Houses three modular tab panels:
 * 1. Evidence Tab: Uploading, downloading, and reviewing supporting documentation/proof files.
 * 2. Assessment Tab: Defining test plans, managing audit schedules, and executing evaluations.
 * 3. POA&M Tab: Tracking Plan of Action and Milestones remediation tasks.
 */

import { Link2, AlertTriangle, FileText, ClipboardCheck, ListTodo } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type ComplianceControl, type ControlStatus, type EffectivenessStatus } from "@/lib/controls"

// Import the extracted child components
import { EvidenceTab } from "@/components/evidence-tab"
import { AssessmentTab } from "@/components/assessment-tab"
import { PoamTab } from "@/components/poam-tab"

interface EditEvidenceDialogProps {
  control: ComplianceControl | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (control: ComplianceControl) => void
  onRefresh?: () => void
  userRole?: string | null
  onRiskClick?: (riskId: string) => void
}

export function EditEvidenceDialog({ control, open, onOpenChange, onSave, onRefresh, userRole, onRiskClick }: EditEvidenceDialogProps) {
  const isAuditor = userRole === "Auditor"
  const isExecutive = userRole === "Executive"

  // Handler for when the Assessment tab determines a status needs to be updated globally
  function handleStatusChangeFromAssessment(status: ControlStatus, design: EffectivenessStatus, op: EffectivenessStatus) {
    if (control) {
      onSave({
        ...control,
        status,
        control_effectiveness: design,
        implementation_effectiveness: op,
      })
    }
  }

  if (!control) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl flex flex-col h-[90vh] sm:h-auto max-h-[90vh] p-0 gap-0 overflow-hidden">
        
        {/* Static Header Section */}
        <DialogHeader className="shrink-0 p-5 pb-4 border-b border-border bg-card">
          <DialogTitle className="flex items-center gap-2">
            {isAuditor || isExecutive ? "View Control" : "Evaluate Control"}
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground">
              {control.id}
            </span>
          </DialogTitle>
          <DialogDescription className="text-pretty mt-1.5">
            {control.description}
          </DialogDescription>
          
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
            {control.cross_walked_control_ids && control.cross_walked_control_ids.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 className="size-3.5" aria-hidden="true" />
                <span className="font-medium text-foreground">Cross-walked:</span>
                {control.cross_walked_control_ids.map((cwId) => (
                  <Badge key={cwId} variant="secondary" className="font-mono text-[10px] h-5 px-1.5 border-primary/20 bg-primary/5 text-primary">
                    {cwId}
                  </Badge>
                ))}
              </div>
            )}

            {control.mitigated_risk_ids && control.mitigated_risk_ids.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="size-3.5 text-amber-500" aria-hidden="true" />
                <span className="font-medium text-foreground">Mitigates Risk:</span>
                {control.mitigated_risk_ids.map((rId) => (
                  <button
                    key={rId}
                    type="button"
                    onClick={() => onRiskClick?.(rId)}
                    className="inline-flex h-5 items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 font-mono text-[10px] text-amber-600 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400"
                    aria-label={`View risk ${rId} in the Risk Register`}
                  >
                    {rId}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Tab Navigation & Content */}
        <Tabs defaultValue="evidence" className="flex flex-col flex-1 min-h-0 bg-muted/10">
          <div className="px-5 py-3 border-b border-border bg-card flex justify-center sm:justify-start">
            <TabsList className="h-9 bg-muted/60 p-1">
              <TabsTrigger value="evidence" className="text-xs font-medium px-4 transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                <FileText className="size-3.5 mr-1.5" aria-hidden="true" /> Evidence Context
              </TabsTrigger>
              <TabsTrigger value="assessment" className="text-xs font-medium px-4 transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                <ClipboardCheck className="size-3.5 mr-1.5" aria-hidden="true" /> Formal Assessment
              </TabsTrigger>
              <TabsTrigger value="poam" className="text-xs font-medium px-4 transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                <ListTodo className="size-3.5 mr-1.5" aria-hidden="true" /> POA&M
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <TabsContent value="evidence" className="mt-0">
              <EvidenceTab control={control} role={userRole ?? null} onSave={onSave} />
            </TabsContent>

            <TabsContent value="assessment" className="mt-0">
              <AssessmentTab 
                control={control} 
                role={userRole ?? null} 
                onRefresh={onRefresh || (() => {})} 
                onStatusChange={handleStatusChangeFromAssessment} 
              />
            </TabsContent>

            <TabsContent value="poam" className="mt-0">
              <PoamTab control={control} role={userRole ?? null} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}