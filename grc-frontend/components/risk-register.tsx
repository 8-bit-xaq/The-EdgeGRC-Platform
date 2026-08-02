"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Plus, ShieldCheck, Trash2, Pencil, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type ComplianceControl } from "@/lib/controls"
import { type RiskItem, getRiskLevel } from "@/lib/risks"
import { fetchApi } from "@/lib/api" // <-- NEW: Imported the API wrapper
import { toast } from "sonner"

export function RiskRegister() {
  const [risks, setRisks] = useState<RiskItem[]>([])
  const [controls, setControls] = useState<ComplianceControl[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRisk, setEditingRisk] = useState<RiskItem | null>(null)
  
  // Role State
  const [role, setRole] = useState<string | null>(null)

  // Form State
  const [riskId, setRiskId] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [likelihood, setLikelihood] = useState("3")
  const [impact, setImpact] = useState("3")
  const [selectedControlIds, setSelectedControlIds] = useState<string[]>([])

  const fetchRisksAndControls = async () => {
    try {
      // Cleaned up with fetchApi
      const [risksRes, controlsRes] = await Promise.all([
        fetchApi("risks/", { cache: "no-store" }),
        fetchApi("controls/", { cache: "no-store" })
      ])

      if (risksRes.ok && controlsRes.ok) {
        const risksData = await risksRes.json()
        const controlsData = await controlsRes.json()
        setRisks(risksData)
        setControls(controlsData.map((c: any) => ({ ...c, id: c.control_id })))
      }
    } catch (err) {
      toast.error("Failed to load risk register data.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setRole(localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role"))
    fetchRisksAndControls()
  }, [])

  const isExecutive = role === "Executive"

  const openCreateDialog = () => {
    setEditingRisk(null)
    setRiskId(`RSK-${Date.now().toString().slice(-4)}`)
    setTitle("")
    setDescription("")
    setLikelihood("3")
    setImpact("3")
    setSelectedControlIds([])
    setDialogOpen(true)
  }

  const openEditDialog = (risk: RiskItem) => {
    setEditingRisk(risk)
    setRiskId(risk.risk_id)
    setTitle(risk.title)
    setDescription(risk.description || "")
    setLikelihood(String(risk.inherent_likelihood))
    setImpact(String(risk.inherent_impact))
    setSelectedControlIds(risk.mitigating_controls_detail?.map((c) => c.control_id || (c as any).id) || [])
    setDialogOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()

    const payload = {
      risk_id: riskId,
      title,
      description,
      inherent_likelihood: parseInt(likelihood),
      inherent_impact: parseInt(impact),
      mitigating_control_ids: selectedControlIds,
    }

    // Cleaned up with fetchApi
    const url = editingRisk ? `risks/${editingRisk.id}/` : "risks/"
    const method = editingRisk ? "PUT" : "POST"

    try {
      const res = await fetchApi(url, {
        method,
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        toast.success(editingRisk ? "Risk record updated" : "Risk created")
        setDialogOpen(false)
        fetchRisksAndControls()
      } else {
        toast.error("Failed to save risk record")
      }
    } catch (err) {
      toast.error("Network error while saving risk")
    }
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await fetchApi(`risks/${id}/`, {
        method: "DELETE",
      })

      if (res.ok) {
        toast.success("Risk record deleted")
        fetchRisksAndControls()
      }
    } catch {
      toast.error("Failed to delete risk")
    }
  }

  // SMART CLUSTER SELECTION: Selecting one control selects its cross-walked siblings
  const toggleControlSelection = (cId: string) => {
    const targetControl = controls.find((c) => c.id === cId)
    const clusterIds = [cId, ...(targetControl?.cross_walked_control_ids || [])]

    setSelectedControlIds((prev) => {
      const isSelected = prev.includes(cId)
      if (isSelected) {
        // Remove the whole cluster if the clicked control is already selected
        return prev.filter((id) => !clusterIds.includes(id))
      } else {
        // Add the whole cluster, preventing duplicates
        return Array.from(new Set([...prev, ...clusterIds]))
      }
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" /> Enterprise Risk Register
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Map identified business risks to compensating controls.
          </p>
        </div>
        {!isExecutive && (
          <Button onClick={openCreateDialog} className="gap-2">
            <Plus className="size-4" /> Add Risk Scenario
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Risk ID</TableHead>
              <TableHead className="min-w-[250px]">Scenario Description</TableHead>
              <TableHead className="w-[120px]">Inherent</TableHead>
              <TableHead className="min-w-[200px]">Compensating Controls</TableHead>
              <TableHead className="w-[120px]">Residual</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  Loading risk register...
                </TableCell>
              </TableRow>
            ) : risks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No risks identified. Add a scenario to begin tracking.
                </TableCell>
              </TableRow>
            ) : (
              risks.map((risk) => {
                const inherent = getRiskLevel(risk.inherent_score)
                const residual = getRiskLevel(risk.residual_score)

                return (
                  <TableRow key={risk.id}>
                    <TableCell className="font-mono text-sm font-medium align-top">
                      {risk.risk_id}
                    </TableCell>
                    <TableCell className="align-top">
                      <p className="font-medium text-foreground text-sm">{risk.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 text-pretty line-clamp-2">
                        {risk.description}
                      </p>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline" className={inherent.badge}>
                        {inherent.label} ({risk.inherent_score})
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      {risk.mitigating_controls_detail && risk.mitigating_controls_detail.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {risk.mitigating_controls_detail.map(ctrl => (
                            <Badge key={ctrl.control_id} variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/20 flex items-center gap-1">
                              <ShieldCheck className="size-3" />
                              {ctrl.control_id}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No controls mapped</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline" className={residual.badge}>
                        {residual.label} ({risk.residual_score})
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {!isExecutive && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => openEditDialog(risk)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(risk.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRisk ? "Edit Risk Scenario" : "Add Risk Scenario"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="grid gap-5 py-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-1 grid gap-2">
                <Label htmlFor="riskId">Risk ID</Label>
                <Input id="riskId" value={riskId} onChange={(e) => setRiskId(e.target.value)} required />
              </div>
              <div className="col-span-3 grid gap-2">
                <Label htmlFor="title">Scenario Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unauthorized Database Access" required />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Impact Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>

            <div className="grid grid-cols-2 gap-4 bg-muted/40 p-4 rounded-lg border border-border">
              <div className="grid gap-2">
                <Label>Inherent Likelihood</Label>
                <Select value={likelihood} onValueChange={(v) => setLikelihood(v as string)}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 - Rare</SelectItem>
                    <SelectItem value="2">2 - Unlikely</SelectItem>
                    <SelectItem value="3">3 - Possible</SelectItem>
                    <SelectItem value="4">4 - Likely</SelectItem>
                    <SelectItem value="5">5 - Almost Certain</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Inherent Impact</Label>
                <Select value={impact} onValueChange={(v) => setImpact(v as string)}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 - Negligible</SelectItem>
                    <SelectItem value="2">2 - Minor</SelectItem>
                    <SelectItem value="3">3 - Moderate</SelectItem>
                    <SelectItem value="4">4 - Major</SelectItem>
                    <SelectItem value="5">5 - Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3">
              <Label>Map Compensating Controls</Label>
              <div className="border border-border rounded-md max-h-[200px] overflow-y-auto p-2 bg-muted/20">
                {controls.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center p-4">No controls available to map.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {controls.map((control) => {
                      const isSelected = selectedControlIds.includes(control.id)
                      const hasSiblings = control.cross_walked_control_ids && control.cross_walked_control_ids.length > 0
                      
                      return (
                        <div 
                          key={control.id} 
                          onClick={() => toggleControlSelection(control.id)}
                          className={`flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors border ${
                            isSelected ? "bg-primary/5 border-primary/30" : "hover:bg-accent border-transparent"
                          }`}
                        >
                          <div className="mt-0.5">
                            <input type="checkbox" checked={isSelected} readOnly className="size-4 rounded border-input accent-primary" />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold">{control.id}</span>
                              {hasSiblings && (
                                <Badge variant="secondary" className="text-[9px] h-4 px-1 flex items-center gap-1 bg-background border-border">
                                  <Link2 className="size-3" /> Auto-syncs {control.cross_walked_control_ids?.length} siblings
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground line-clamp-1">{control.description}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Save Risk</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}