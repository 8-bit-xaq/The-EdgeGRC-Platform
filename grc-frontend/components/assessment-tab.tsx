"use client"

/**
 * @fileoverview Assessment tab for defining test procedures, scheduling audits, and recording evaluation results.
 *
 * Provides a tripartite audit workflow:
 * 1. Test Plan: Defining testing methodologies (Inquiry, Observation, Inspection, Reperformance),
 *    steps, expected evidence, and test plan attachments via `/api/test-plans/`.
 * 2. Schedule: Assigning recurring cadence (Monthly, Quarterly, Annually) and next audit date.
 * 3. Assessment Execution: Logging formal audit activities, testing design and operational
 *    effectiveness, and advancing the control's overarching compliance status.
 */

import { useEffect, useState } from "react"
import { CheckCircle, Send, Trash2, Play, ClipboardCheck, ClipboardList, History, CalendarClock, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { fetchApi } from "@/lib/api"
import {
  EFFECTIVENESS_STATUSES,
  TEST_METHODOLOGIES,
  TESTING_FREQUENCIES,
  type ComplianceControl,
  type ControlStatus,
  type EffectivenessStatus,
  type TestMethodology,
  type TestingFrequency,
  type AssessmentActivity,
  type AssessmentStatus
} from "@/lib/controls"
import { cn } from "@/lib/utils"

interface AssessmentTabProps {
  control: ComplianceControl
  role: string | null
  onRefresh: () => void
  onStatusChange: (status: ControlStatus, design: EffectivenessStatus, op: EffectivenessStatus) => void
}

export function AssessmentTab({ control, role, onRefresh, onStatusChange }: AssessmentTabProps) {
  const isAdmin = role === "Admin"
  const isAuditor = role === "Auditor"
  const isReviewer = role === "Reviewer"

  // Test Plan State
  const [testMethodology, setTestMethodology] = useState<TestMethodology[]>([])
  const [testSteps, setTestSteps] = useState("")
  const [expectedEvidence, setExpectedEvidence] = useState("")
  const [isSavingTestPlan, setIsSavingTestPlan] = useState(false)
  
  // --- NEW: Test Plan Attachment State ---
  const [testPlanFile, setTestPlanFile] = useState<File | null>(null)
  const [existingAttachment, setExistingAttachment] = useState<{name: string, url: string} | null>(null)

  // Scheduling State
  const [testingFrequency, setTestingFrequency] = useState<TestingFrequency>("None")
  const [nextAuditDate, setNextAuditDate] = useState("")
  const [isSavingSchedule, setIsSavingSchedule] = useState(false)

  // Assessment Activity State
  const [assessments, setAssessments] = useState<AssessmentActivity[]>([])
  const [activeAssessment, setActiveAssessment] = useState<AssessmentActivity | null>(null)
  const [auditDesign, setAuditDesign] = useState<EffectivenessStatus>("Not Tested")
  const [auditOp, setAuditOp] = useState<EffectivenessStatus>("Not Tested")
  const [auditNotes, setAuditNotes] = useState("")
  const [isSavingAssessment, setIsSavingAssessment] = useState(false)

  // Admin Clear History State
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [adminPassword, setAdminPassword] = useState("")
  const [isClearingHistory, setIsClearingHistory] = useState(false)

  useEffect(() => {
    // Scheduling
    setTestingFrequency(control.testing_frequency || "None")
    setNextAuditDate(control.next_audit_date || "")

    // Test Plan
    if (control.test_plan) {
      setTestMethodology(control.test_plan.test_methodology || [])
      setTestSteps(control.test_plan.test_steps ?? "")
      setExpectedEvidence(control.test_plan.expected_evidence ?? "")
      
      // Hydrate existing attachment if present
      if (control.test_plan.attachment_name && control.test_plan.attachment_url) {
        setExistingAttachment({ 
          name: control.test_plan.attachment_name, 
          url: control.test_plan.attachment_url 
        })
      } else {
        setExistingAttachment(null)
      }
    } else {
      setTestMethodology([])
      setTestSteps("")
      setExpectedEvidence("")
      setExistingAttachment(null)
    }

    // Assessments
    const sortedAssessments = [...(control.assessments || [])].sort(
      (a, b) => new Date(b.date_started).getTime() - new Date(a.date_started).getTime()
    )
    setAssessments(sortedAssessments)

    const latest = sortedAssessments[0]
    if (latest && latest.status !== "Completed") {
      setActiveAssessment(latest)
      setAuditDesign(latest.design_effectiveness)
      setAuditOp(latest.operating_effectiveness)
      setAuditNotes(latest.auditor_notes ?? "")
    } else {
      setActiveAssessment(null)
      setAuditDesign("Not Tested")
      setAuditOp("Not Tested")
      setAuditNotes("")
    }
  }, [control])

  async function handleSaveSchedule() {
    setIsSavingSchedule(true)
    try {
      const res = await fetchApi(`controls/${control.id}/`, {
        method: "PATCH",
        body: JSON.stringify({
          testing_frequency: testingFrequency,
          next_audit_date: nextAuditDate || null
        })
      })
      if (res.ok) {
        toast.success("Audit schedule updated")
        onRefresh()
      } else {
        toast.error("Failed to save schedule")
      }
    } catch (err) {
      toast.error("Network error saving schedule")
    } finally {
      setIsSavingSchedule(false)
    }
  }

  // --- REFACTORED: Send FormData to handle the file attachment ---
  async function handleSaveTestPlan() {
    setIsSavingTestPlan(true)
    try {
      const formData = new FormData()
      
      // Send the methodology array as a stringified JSON string for the Django JSONField
      formData.append("test_methodology", JSON.stringify(testMethodology))
      formData.append("test_steps", testSteps || "")
      formData.append("expected_evidence", expectedEvidence || "")
      
      if (testPlanFile) {
        formData.append("attachment", testPlanFile)
      }

      // Bypass fetchApi wrapper to allow the browser to auto-set the multipart boundary header
      const res = await fetchApi(`/controls/${control.id}/test-plan/`, {
        method: "PATCH",
        credentials: "include",
        body: formData
      })

      if (res.ok) {
        toast.success("Test Plan saved")
        setTestPlanFile(null)
        onRefresh()
      } else {
        toast.error("Failed to save Test Plan")
      }
    } catch (err) {
      toast.error("Network error saving Test Plan")
    } finally {
      setIsSavingTestPlan(false)
    }
  }

  async function handleStartAssessment() {
    setIsSavingAssessment(true)
    try {
      const res = await fetchApi(`controls/${control.id}/assessments/`, {
        method: "POST",
        body: JSON.stringify({ status: "In Progress" })
      })
      if (res.ok) {
        const newAssessment = await res.json()
        setAssessments([newAssessment, ...assessments])
        setActiveAssessment(newAssessment)
        setAuditDesign("Not Tested")
        setAuditOp("Not Tested")
        setAuditNotes("")
        toast.success("New assessment started")
      } else {
        toast.error("Failed to start assessment")
      }
    } catch (err) {
      toast.error("Network error starting assessment")
    } finally {
      setIsSavingAssessment(false)
    }
  }

  async function handleDeleteAssessment() {
    if (!activeAssessment) return
    if (!window.confirm("Are you sure you want to cancel and discard this assessment draft?")) return
    
    setIsSavingAssessment(true)
    try {
      const res = await fetchApi(`assessments/${activeAssessment.id}/`, {
        method: "DELETE"
      })
      if (res.ok) {
        setAssessments(assessments.filter(a => a.id !== activeAssessment.id))
        setActiveAssessment(null)
        setAuditDesign("Not Tested")
        setAuditOp("Not Tested")
        setAuditNotes("")
        toast.success("Draft assessment canceled")
        onRefresh()
      } else {
        toast.error("Failed to cancel assessment")
      }
    } catch (err) {
      toast.error("Network error canceling assessment")
    } finally {
      setIsSavingAssessment(false)
    }
  }

  async function handleUpdateAssessment(newStatus: AssessmentStatus) {
    if (!activeAssessment) return
    setIsSavingAssessment(true)
    
    const payload = {
      status: newStatus,
      design_effectiveness: auditDesign,
      operating_effectiveness: auditOp,
      auditor_notes: auditNotes,
      ...(newStatus === "Completed" ? { date_completed: new Date().toISOString() } : {})
    }

    try {
      const res = await fetchApi(`assessments/${activeAssessment.id}/`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        const updated = await res.json()
        setAssessments(assessments.map(a => a.id === updated.id ? updated : a))
        setActiveAssessment(newStatus === "Completed" ? null : updated)
        toast.success(newStatus === "Completed" ? "Audit finalized" : "Assessment updated")

        onRefresh()

        if (newStatus === "Completed") {
          let overallStatus: ControlStatus = "Passing"
          if (auditDesign === "Deficient" || auditOp === "Deficient") overallStatus = "Failing"
          onStatusChange(overallStatus, auditDesign, auditOp)
        } else if (newStatus === "In QA Review") {
          onStatusChange("Awaiting Approval", auditDesign, auditOp)
        }
      } else {
        toast.error("Failed to update assessment")
      }
    } catch (err) {
      toast.error("Network error updating assessment")
    } finally {
      setIsSavingAssessment(false)
    }
  }

  async function handleClearHistory(e: React.FormEvent) {
    e.preventDefault()
    if (!adminPassword) return

    setIsClearingHistory(true)
    try {
      const username = localStorage.getItem("grc_username") || sessionStorage.getItem("grc_username")
      const authRes = await fetchApi("login/", {
        method: "POST",
        body: JSON.stringify({ username, password: adminPassword })
      })

      if (!authRes.ok) {
        toast.error("Authentication failed", { description: "Incorrect password." })
        setIsClearingHistory(false)
        return
      }

      const completedAssessments = assessments.filter(a => a.status === "Completed")
      const deletePromises = completedAssessments.map(assessment => 
        fetchApi(`assessments/${assessment.id}/`, { method: "DELETE" })
      )
      
      await Promise.all(deletePromises)

      toast.success("Assessment history cleared")
      setAssessments(assessments.filter(a => a.status !== "Completed"))
      setShowClearConfirm(false)
      setAdminPassword("")
      onRefresh()
    } catch (err) {
      toast.error("Network error while clearing history")
    } finally {
      setIsClearingHistory(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 outline-none">
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="bg-muted/50 px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ClipboardList className="size-4 text-primary" />
            Audit Test Plan
          </h3>
          {isAdmin || isAuditor ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleSaveTestPlan} disabled={isSavingTestPlan}>
              {isSavingTestPlan ? "Saving..." : "Save Plan"}
            </Button>
          ) : null}
        </div>
        <div className="p-4 grid gap-4">
          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Methodology</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {TEST_METHODOLOGIES.map((method) => {
                const isSelected = testMethodology.includes(method)
                return (
                  <Badge
                    key={method}
                    variant={isSelected ? "default" : "outline"}
                    className={cn(
                      "transition-colors",
                      (isAdmin || isAuditor) ? "cursor-pointer hover:bg-primary/80" : "cursor-default pointer-events-none"
                    )}
                    onClick={() => {
                      if (!isAdmin && !isAuditor) return
                      setTestMethodology(prev => 
                        prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
                      )
                    }}
                  >
                    {method}
                  </Badge>
                )
              })}
            </div>
          </div>
          
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Test Steps</Label>
              <Textarea 
                value={testSteps} 
                onChange={(e) => setTestSteps(e.target.value)} 
                placeholder="1. Request population list..." 
                rows={3} 
                className="resize-none" 
                disabled={!isAdmin && !isAuditor}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Expected Artifacts</Label>
              <Textarea 
                value={expectedEvidence} 
                onChange={(e) => setExpectedEvidence(e.target.value)} 
                placeholder="e.g. Screenshot of firewall configuration." 
                rows={3} 
                className="resize-none" 
                disabled={!isAdmin && !isAuditor}
              />
            </div>
          </div>

          {/* --- NEW: Test Plan Attachment Widget --- */}
          <div className="grid gap-3 mt-2 pt-4 border-t border-border/50">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Test Plan Attachment</Label>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <Input 
                type="file" 
                onChange={(e) => setTestPlanFile(e.target.files?.[0] || null)}
                disabled={!isAdmin && !isAuditor}
                className="max-w-sm bg-background"
              />
              {existingAttachment && !testPlanFile && (
                <a href={existingAttachment.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline flex items-center gap-2">
                  <FileText className="size-4" />
                  {existingAttachment.name}
                </a>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">Upload a filled-out testing matrix, evidence request sheet, or auditor workpaper.</p>
          </div>

        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mt-2">
        <div className="bg-muted/50 px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <CalendarClock className="size-4 text-purple-500" />
            Automated Audit Schedule
          </h3>
          {isAdmin || isAuditor ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleSaveSchedule} disabled={isSavingSchedule}>
              {isSavingSchedule ? "Saving..." : "Save Schedule"}
            </Button>
          ) : null}
        </div>
        <div className="p-4 grid sm:grid-cols-2 gap-6">
          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Testing Frequency</Label>
            <Select value={testingFrequency} onValueChange={(v) => setTestingFrequency(v as TestingFrequency)} disabled={!isAdmin && !isAuditor}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TESTING_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Next Audit Date</Label>
            <Input 
              type="date" 
              value={nextAuditDate} 
              onChange={(e) => setNextAuditDate(e.target.value)} 
              disabled={testingFrequency === "None" || (!isAdmin && !isAuditor)}
              className="w-full bg-background"
            />
            <p className="text-[10px] text-muted-foreground">The platform will request evidence 30 days prior to this date.</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex-1 mt-2">
        <div className="bg-muted/50 px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ClipboardCheck className="size-4 text-amber-500" />
            Active Assessment Execution
          </h3>
          {activeAssessment && (
            <Badge variant="outline" className={
              activeAssessment.status === "Completed" ? "bg-success/10 text-success" : 
              activeAssessment.status === "In QA Review" ? "bg-amber-500/10 text-amber-500" : 
              "bg-primary/10 text-primary"
            }>
              {activeAssessment.status}
            </Badge>
          )}
        </div>
        
        <div className="p-4">
          {!activeAssessment ? (
            <div className="py-8 flex flex-col items-center justify-center text-center gap-3">
              <p className="text-sm text-muted-foreground">No active assessment in progress for this control.</p>
              {(isAdmin || isAuditor) && (
                <Button onClick={handleStartAssessment} disabled={isSavingAssessment} className="gap-2">
                  <Play className="size-4" /> Start New Assessment
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                 <History className="size-3.5" />
                 Started by {activeAssessment.assessor_username} on {new Date(activeAssessment.date_started).toLocaleDateString()}
              </div>

              <div className="grid sm:grid-cols-2 gap-6">
                <div className="grid gap-2">
                  <Label className="text-sm">Design Effectiveness</Label>
                  <Select 
                    value={auditDesign} 
                    onValueChange={(v) => setAuditDesign(v as EffectivenessStatus)} 
                    disabled={(activeAssessment.status !== "In Progress" && !isAdmin) || (!isAdmin && !isAuditor)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EFFECTIVENESS_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Does the documented policy adequately address the requirement?</p>
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm">Operational Effectiveness</Label>
                  <Select 
                    value={auditOp} 
                    onValueChange={(v) => setAuditOp(v as EffectivenessStatus)} 
                    disabled={(activeAssessment.status !== "In Progress" && !isAdmin) || (!isAdmin && !isAuditor)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EFFECTIVENESS_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Is there physical evidence proving the control is executed?</p>
                </div>
              </div>

              <div className="grid gap-2">
                <Label className="text-sm">Auditor Field Notes</Label>
                <Textarea 
                  value={auditNotes} 
                  onChange={e => setAuditNotes(e.target.value)} 
                  rows={3} 
                  placeholder="Document findings, exceptions, or missing evidence here..."
                  disabled={(activeAssessment.status !== "In Progress" && !isAdmin) || (!isAdmin && !isAuditor)}
                />
              </div>

              {activeAssessment.status !== "Completed" && (
                <div className="flex flex-wrap gap-3 justify-end pt-4 border-t border-border/50">
                  {(isAdmin || isAuditor) && activeAssessment.status === "In Progress" && (
                    <>
                      <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive mr-auto" onClick={handleDeleteAssessment} disabled={isSavingAssessment}>
                        <Trash2 className="size-4 mr-2" /> Cancel Draft
                      </Button>
                      <Button variant="outline" onClick={() => handleUpdateAssessment("In Progress")} disabled={isSavingAssessment}>
                        Save Draft Notes
                      </Button>
                      <Button onClick={() => handleUpdateAssessment("In QA Review")} disabled={isSavingAssessment} className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
                        <Send className="size-4" /> Submit to QA
                      </Button>
                    </>
                  )}

                  {(isAdmin || isReviewer) && activeAssessment.status === "In QA Review" && (
                    <>
                      <Button variant="destructive" onClick={() => handleUpdateAssessment("In Progress")} disabled={isSavingAssessment}>
                        Reject to Auditor
                      </Button>
                      <Button onClick={() => handleUpdateAssessment("Completed")} disabled={isSavingAssessment} className="bg-success hover:bg-success/90 text-success-foreground gap-2">
                        <CheckCircle className="size-4" /> Finalize Audit
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {assessments.filter(a => a.status === "Completed").length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex-1 mt-2">
          <div className="bg-muted/50 px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <History className="size-4 text-muted-foreground" />
                Assessment History
              </h3>
              <Badge variant="secondary" className="font-mono text-[10px] bg-background">
                {assessments.filter(a => a.status === "Completed").length} Records
              </Badge>
            </div>
            {isAdmin && !showClearConfirm && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" 
                onClick={() => setShowClearConfirm(true)}
              >
                <Trash2 className="size-3 mr-1.5" /> Clear History
              </Button>
            )}
          </div>
          <div className="p-0">
            {showClearConfirm ? (
              <div className="p-4 bg-destructive/5 border-b border-destructive/10">
                <h4 className="text-sm font-semibold text-destructive mb-1">Clear Assessment History?</h4>
                <p className="text-xs text-muted-foreground mb-3">This action will permanently delete all completed assessments for this control. Please enter your password to confirm.</p>
                <form onSubmit={handleClearHistory} className="flex flex-wrap items-center gap-2">
                  <Input 
                    type="password" 
                    placeholder="Admin password" 
                    value={adminPassword} 
                    onChange={e => setAdminPassword(e.target.value)} 
                    className="h-8 max-w-[200px] text-xs bg-background"
                    disabled={isClearingHistory}
                  />
                  <Button type="submit" variant="destructive" size="sm" className="h-8 text-xs" disabled={!adminPassword || isClearingHistory}>
                    {isClearingHistory ? "Clearing..." : "Confirm"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={isClearingHistory} onClick={() => { setShowClearConfirm(false); setAdminPassword(""); }}>
                    Cancel
                  </Button>
                </form>
              </div>
            ) : null}
            <ul className="flex flex-col divide-y divide-border">
              {assessments.filter(a => a.status === "Completed").map(a => (
                <li key={a.id} className="p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <CheckCircle className="size-4 text-success" />
                      Completed {a.date_completed ? new Date(a.date_completed).toLocaleDateString() : 'Unknown Date'}
                    </div>
                    <span className="text-xs text-muted-foreground">Assessor: {a.assessor_username}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className={cn("text-[10px] font-medium border-transparent", a.design_effectiveness === "Deficient" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>
                      Design: {a.design_effectiveness}
                    </Badge>
                    <Badge variant="outline" className={cn("text-[10px] font-medium border-transparent", a.operating_effectiveness === "Deficient" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>
                      Operation: {a.operating_effectiveness}
                    </Badge>
                  </div>
                  {a.auditor_notes && (
                    <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-md border border-border/50">
                      <span className="font-semibold text-foreground">Findings:</span> {a.auditor_notes}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}