"use client"

/**
 * @fileoverview Evidence documentation and proof attachment tab component.
 *
 * Provides evidence management for a compliance control:
 * - Textual rationale and categorization tags.
 * - Multi-file upload for physical audit artifacts (PDF, PNG, JPG, JSON) to `/api/proofs/upload/`.
 * - Role-based editing locks (Contributors cannot modify approved controls; Auditors and Executives are read-only).
 */

import { useState, useRef, useEffect } from "react"
import { Upload, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { fetchApi } from "@/lib/api"
import {
  CONTROL_STATUSES,
  type ComplianceControl,
  type ControlStatus,
  type ProofFile
} from "@/lib/controls"

interface EvidenceTabProps {
  control: ComplianceControl
  role: string | null
  onSave: (control: ComplianceControl) => void
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function EvidenceTab({ control, role, onSave }: EvidenceTabProps) {
  const isAdmin = role === "Admin"
  const isReviewer = role === "Reviewer"
  const isAuditor = role === "Auditor"
  const isExecutive = role === "Executive"
  const isContributor = role === "Contributor"

  const [status, setStatus] = useState<ControlStatus>("Not Evaluated")
  const [evidence, setEvidence] = useState("")
  const [proofs, setProofs] = useState<ProofFile[]>([])
  const [tagsString, setTagsString] = useState("")
  const [tags, setTags] = useState<string[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const isLockedForContributor = isContributor && (
    control.status === "Ready for Audit" ||
    control.status === "Awaiting Approval" ||
    control.status === "Passing" ||
    (control.assessments?.some(assessment => assessment.status === "In QA Review") ?? false)
  )
  const isEvidenceLocked = isReviewer || isAuditor || isLockedForContributor || isExecutive

  useEffect(() => {
    setStatus(control.status)
    setEvidence(control.evidence ?? "") 
    setProofs(control.proofs ?? [])
    setTags(control.tags ?? [])
    setTagsString((control.tags ?? []).join(", "))
  }, [control])

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const next: ProofFile[] = Array.from(fileList).map((file) => ({
      id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      name: file.name, size: file.size, type: file.type || "application/octet-stream", file: file,
    }))
    setProofs((prev) => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeProof(id: string | number) {
    setProofs((prev) => prev.filter((p) => String(p.id) !== String(id)))
  }

  function handleSaveGeneral(targetStatus: ControlStatus = status) {
    if (isAuditor) return
    
    const updatedTags = isAdmin 
      ? tagsString.split(',').map(t => t.trim()).filter(Boolean)
      : tags

    onSave({ 
      ...control, 
      status: targetStatus, 
      evidence, 
      proofs,
      tags: updatedTags 
    })
  }

  return (
    <div className="grid gap-6 outline-none">
      {isAdmin ? (
        <div className="grid gap-2">
          <Label>Admin Status Override</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as ControlStatus)}>
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONTROL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Overall Status</span>
            <span className="text-xs text-muted-foreground">
              Determined by the latest completed Assessment.
            </span>
          </div>
          <Badge variant="outline" className="bg-background shadow-sm text-sm">{status}</Badge>
        </div>
      )}

      <div className="grid gap-2">
        <Label>Control Tags</Label>
        {isAdmin ? (
          <>
            <Input 
              value={tagsString} 
              onChange={(e) => setTagsString(e.target.value)} 
              placeholder="AccessControl, Encryption, Privacy"
              className="bg-background"
            />
            <p className="text-[10px] text-muted-foreground">Comma-separated tags used for automated cross-walking.</p>
          </>
        ) : (
           <div className="flex flex-wrap gap-1 p-3 border border-border rounded-md bg-card">
             {tags.length > 0 ? tags.map(t => (
               <Badge key={t} variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/20">#{t}</Badge>
             )) : <span className="text-sm text-muted-foreground">No tags assigned.</span>}
           </div>
        )}
      </div>

      <div className="grid gap-2">
        <Label>Implementation Narrative</Label>
        {isEvidenceLocked ? (
          <p className="whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
            {evidence || "No narrative provided."}
          </p>
        ) : (
          <Textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Describe how this control is implemented in your environment..."
            rows={4}
            className="resize-none bg-background"
          />
        )}
      </div>

      <div className="grid gap-2">
        <Label>Supporting Proof Files</Label>
        {!isEvidenceLocked && (
          <>
            <input ref={fileInputRef} type="file" multiple className="sr-only" onChange={(e) => handleFilesSelected(e.target.files)} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center hover:border-primary/50 hover:bg-accent/50 transition-colors">
              <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium text-card-foreground">Upload physical evidence</span>
            </button>
          </>
        )}
        {proofs.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-2">
            {proofs.map((proof) => {
              const fileHref = proof.url || (proof.file ? URL.createObjectURL(proof.file) : "#")
              return (
                <li key={proof.id} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 shadow-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <a href={fileHref} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium text-primary hover:underline">{proof.name}</a>
                    <p className="text-xs text-muted-foreground">{formatSize(proof.size)}</p>
                  </div>
                  {!isEvidenceLocked && (
                    <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => removeProof(proof.id)}>
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          isEvidenceLocked ? <p className="text-sm text-muted-foreground p-3 border border-border rounded-md bg-card">No proof files attached.</p> : null
        )}
      </div>

      {!isEvidenceLocked && (
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={() => handleSaveGeneral(status)}>
            Save
          </Button>
          {status !== "Ready for Audit" && (
            <Button
              type="button"
              onClick={() => handleSaveGeneral("Ready for Audit")}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Submit for Audit
            </Button>
          )}
        </div>
      )}
    </div>
  )
}