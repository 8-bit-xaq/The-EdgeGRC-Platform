"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Building2,
  DatabaseBackup,
  Laptop,
  Loader2,
  Monitor,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  ArchiveRestore,
  UploadCloud,
  AlertCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useOrganization } from "@/lib/organization"
import { fetchApi } from "@/lib/api" // <-- NEW: Imported the API wrapper

interface SessionRow {
  id: string
  device: string
  meta: string
  location: string
  lastActive: string
  icon: React.ComponentType<{ className?: string }>
  current?: boolean
}

const SESSION_TIMEOUTS = ["15 minutes", "30 minutes", "1 hour", "4 hours", "8 hours"]

export function WorkspaceSettings() {
  const { organization, updateOrganization } = useOrganization()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const updateInputRef = useRef<HTMLInputElement>(null) // <-- NEW: Ref for OTA updates

  // Role and Tab state
  const [role, setRole] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>("security")

  // Organization draft state
  const [companyName, setCompanyName] = useState(organization.companyName)
  const [workspaceName, setWorkspaceName] = useState(organization.workspaceName)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(organization.logoDataUrl)

  // Sync local form inputs when the global context loads from storage
  useEffect(() => {
    setCompanyName(organization.companyName)
    setWorkspaceName(organization.workspaceName)
    setLogoDataUrl(organization.logoDataUrl)
  }, [organization])

  // Security & Backup draft state
  const [sessionTimeout, setSessionTimeout] = useState("30 minutes")
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [saving, setSaving] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  
  // Backup / Restore / Update state
  const [isBackingUp, setIsBackingUp] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false) // <-- NEW: State for OTA update

  useEffect(() => {
    const savedRole = localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role")
    setRole(savedRole)
    if (savedRole === "Admin") {
      setActiveTab("organization")
      setIsLoadingSessions(true)
      
      // Cleaned up with fetchApi
      fetchApi("sessions/")
        .then(res => res.json())
        .then(data => {
          const formatted = data.map((s: any) => ({
            ...s,
            icon: Monitor 
          }))
          setSessions(formatted)
        })
        .catch(err => console.error("Failed to fetch sessions:", err))
        .finally(() => setIsLoadingSessions(false))
    }
  }, [])

  const isAdmin = role === "Admin";

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Unsupported file", { description: "Please choose an image file." })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large", { description: "Logos must be 5MB or smaller." })
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const MAX_WIDTH = 256
        let width = img.width
        let height = img.height
        
        if (width > MAX_WIDTH) {
          height = height * (MAX_WIDTH / width)
          width = MAX_WIDTH
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext("2d")
        ctx?.drawImage(img, 0, 0, width, height)
        
        const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.8)
        setLogoDataUrl(compressedDataUrl)
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  function revokeSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    toast.success("Session revoked", { description: "That device has been signed out." })
  }

  function handleSave() {
    setSaving(true)
    setTimeout(() => {
      updateOrganization({
        companyName: companyName.trim() || organization.companyName,
        workspaceName: workspaceName.trim() || organization.workspaceName,
        logoDataUrl,
      })
      setSaving(false)
      toast.success("Changes saved", {
        description: "Your workspace settings have been updated.",
      })
    }, 800)
  }

  function handleDeleteWorkspace() {
    toast.error("Workspace deletion requested", {
      description: "An owner must confirm this irreversible action via email.",
    })
  }

  // --- NEW: Refactored with fetchApi ---
  async function handleBackup() {
    setIsBackingUp(true)
    try {
      const res = await fetchApi("backup/")
      if (!res.ok) throw new Error("Backup failed")
        
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `grc_system_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      toast.success("Backup downloaded successfully.")
    } catch (err) {
      toast.error("Backup Failed", { description: "Could not generate the system snapshot." })
    } finally {
      setIsBackingUp(false)
    }
  }

  function handleRestoreFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith(".zip")) {
      toast.error("Invalid file", { description: "Please upload a valid ZIP backup file." })
      return
    }
    setRestoreFile(file)
    setShowRestoreConfirm(true)
    if (backupInputRef.current) backupInputRef.current.value = "" // Reset input
  }

  // --- NEW: Refactored with fetchApi ---
  async function executeRestore() {
    if (!restoreFile) return

    setIsRestoring(true)
    const formData = new FormData()
    formData.append("file", restoreFile)

    try {
      const res = await fetchApi("restore/", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) throw new Error("Restore failed")

      toast.success("System Restored", { description: "Re-authenticating to load the restored state..." })
      
      // Clear sessions and force reload so the client grabs fresh data from the newly restored DB
      setTimeout(() => {
        localStorage.removeItem('grc_token')
        sessionStorage.removeItem('grc_token')
        window.location.reload()
      }, 2000)

    } catch (err) {
      toast.error("Restore Failed", { description: "Could not import the system snapshot." })
      setIsRestoring(false)
      setShowRestoreConfirm(false)
      setRestoreFile(null)
    }
  }

  // --- NEW: OTA System Updater Function ---
  async function handleUpdateFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith(".zip")) {
      toast.error("Invalid file format", { description: "Update packages must be a .zip file." })
      return
    }

    if (!window.confirm(`Are you sure you want to install ${file.name}? The system will go offline for a few minutes.`)) {
      if (updateInputRef.current) updateInputRef.current.value = ""
      return
    }

    setIsUpdating(true)
    const formData = new FormData()
    formData.append("file", file)

    try {
      const res = await fetchApi("update/", {
        method: "POST",
        body: formData,
      })

      if (res.ok) {
        toast.success("Update initialized", { description: "The system is applying the update and will restart shortly. You may lose connection momentarily." })
        // Force a page reload after a delay to grab the new frontend assets
        setTimeout(() => window.location.reload(), 15000) 
      } else {
        const err = await res.json()
        toast.error("Update failed", { description: err.error || "Could not process the update package." })
      }
    } catch (error) {
      toast.error("Network error", { description: "Connection lost during upload." })
    } finally {
      setIsUpdating(false)
      if (updateInputRef.current) updateInputRef.current.value = ""
    }
  }

  return (
    <div className="grid gap-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
        <TabsList className="w-full justify-start sm:w-fit">
          {isAdmin && <TabsTrigger value="organization">Organization</TabsTrigger>}
          <TabsTrigger value="security">Security &amp; Access</TabsTrigger>
        </TabsList>

        {/* Organization */}
        {isAdmin && (
          <TabsContent value="organization" className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Organization profile</CardTitle>
                <CardDescription>
                  These details identify your company and appear in the workspace branding.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                    {logoDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoDataUrl || "/placeholder.svg"} alt="Company logo preview" className="size-full object-cover" />
                    ) : (
                      <Building2 className="size-7 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="size-4" aria-hidden />
                        Upload logo
                      </Button>
                      {logoDataUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setLogoDataUrl(null)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Square PNG or SVG recommended. Max 5MB.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={handleLogoChange}
                    />
                  </div>
                </div>

                <Separator />

                <div className="grid max-w-xl gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="company-name">Company name</Label>
                    <Input
                      id="company-name"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Acme Inc."
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="workspace-name">GRC workspace name</Label>
                    <Input
                      id="workspace-name"
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      placeholder="Compliance Solutions"
                    />
                    <p className="text-xs text-muted-foreground">
                      Shown beneath your company name in the navigation.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Data Management</CardTitle>
                <CardDescription>
                  Generate or restore a complete snapshot of your database and evidence artifacts.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {/* Backup Block */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border bg-muted/40 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">System Backup</p>
                    <p className="text-sm text-muted-foreground text-balance">Downloads an encrypted ZIP containing your SQLite database and physical proof files.</p>
                  </div>
                  <Button onClick={handleBackup} disabled={isBackingUp} className="shrink-0 w-full sm:w-auto">
                    {isBackingUp ? (
                      <><Loader2 className="mr-2 size-4 animate-spin" /> Compiling...</>
                    ) : (
                      <><DatabaseBackup className="mr-2 size-4" /> Download Snapshot</>
                    )}
                  </Button>
                </div>
                
                {/* Restore Block */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                  <div className="space-y-1 pr-4">
                    <p className="text-sm font-medium text-foreground">Import Snapshot</p>
                    <p className="text-sm text-muted-foreground text-balance">Restore the system from a previous backup. This will completely overwrite all current data.</p>
                  </div>
                  <input
                    ref={backupInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="sr-only"
                    onChange={handleRestoreFileSelect}
                  />
                  <Button 
                    variant="destructive" 
                    onClick={() => backupInputRef.current?.click()} 
                    disabled={isRestoring} 
                    className="shrink-0 w-full sm:w-auto"
                  >
                    <ArchiveRestore className="mr-2 size-4" /> Restore Snapshot
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* --- NEW: OTA System Updater Card --- */}
            <Card className="border-purple-500/20 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <UploadCloud className="size-4 text-purple-500" />
                  Platform OTA Updates
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload an official ByteTex release package to upgrade the appliance to the latest version.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <input
                    type="file"
                    ref={updateInputRef}
                    onChange={handleUpdateFileSelect}
                    accept=".zip"
                    className="sr-only"
                    disabled={isUpdating}
                  />
                  <Button 
                    onClick={() => updateInputRef.current?.click()} 
                    disabled={isUpdating}
                    className="bg-purple-600 hover:bg-purple-700 text-white min-w-[140px]"
                  >
                    {isUpdating ? (
                      <><Loader2 className="size-4 mr-2 animate-spin" /> Installing...</>
                    ) : (
                      <><UploadCloud className="size-4 mr-2" /> Upload Package</>
                    )}
                  </Button>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="size-4 text-amber-500" />
                    Active sessions will be temporarily disconnected during the reboot.
                  </div>
                </div>
              </CardContent>
            </Card>

          </TabsContent>
        )}

        {/* Security & Access */}
        <TabsContent value="security" className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Authentication</CardTitle>
              <CardDescription>Strengthen how members prove their identity.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:max-w-xs">
                <Label htmlFor="session-timeout">Session timeout</Label>
                <Select value={sessionTimeout} onValueChange={(v) => setSessionTimeout(v as string)}>
                  <SelectTrigger id="session-timeout" className="w-full">
                    <SelectValue placeholder="Select a timeout" />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_TIMEOUTS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Members are signed out automatically after this period of inactivity.
                </p>
              </div>
            </CardContent>
          </Card>
                  
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Active sessions</CardTitle>
                <CardDescription>
                  Devices currently signed in to this workspace. Revoke any you don&apos;t recognize.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sessions.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No other active sessions.
                  </p>
                ) : (
                  <ul className="grid gap-1">
                    {sessions.map((session, index) => {
                      const Icon = session.icon
                      return (
                        <li key={session.id}>
                          {index > 0 && <Separator className="my-1" />}
                          <div className="flex items-center gap-3 py-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <Icon className="size-4" aria-hidden />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium text-card-foreground">
                                  {session.device}
                                </p>
                                {session.current && (
                                  <Badge variant="secondary" className="shrink-0">
                                    Current
                                  </Badge>
                                )}
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {session.meta} · {session.location} · {session.lastActive}
                              </p>
                            </div>
                            {session.current ? (
                              <span className="hidden text-xs text-muted-foreground sm:inline">
                                This device
                              </span>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => revokeSession(session.id)}
                              >
                                Revoke
                              </Button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Destructive actions */}
      {isAdmin && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>Irreversible actions that affect the entire workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-card-foreground">Delete workspace</p>
                <p className="text-sm text-muted-foreground text-pretty">
                  Permanently remove this workspace, its frameworks, controls, and audit history.
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                className="shrink-0 gap-2"
                onClick={handleDeleteWorkspace}
              >
                <Trash2 className="size-4" aria-hidden />
                Delete workspace
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Restore Confirmation Dialog */}
      <Dialog open={showRestoreConfirm} onOpenChange={setShowRestoreConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <ShieldCheck className="size-5" /> Confirm System Restore
            </DialogTitle>
            <DialogDescription className="text-foreground mt-4 font-medium">
              You are about to restore the system using <span className="font-mono bg-muted px-1 py-0.5 rounded">{restoreFile?.name}</span>.
            </DialogDescription>
            <DialogDescription className="text-muted-foreground mt-2">
              This action will completely overwrite the current database and all uploaded physical evidence. Any progress made since this backup was generated will be permanently lost. You will be logged out upon completion.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => {
              setShowRestoreConfirm(false);
              setRestoreFile(null);
            }} disabled={isRestoring}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={executeRestore} disabled={isRestoring}>
              {isRestoring ? <><Loader2 className="mr-2 size-4 animate-spin" /> Restoring...</> : "Yes, Restore System"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-4 mt-2 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
        <p className="hidden text-sm text-muted-foreground sm:block">
          Changes apply across your entire GRC workspace.
        </p>
        <Button type="button" onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Saving...
            </>
          ) : (
            <>
              <ShieldCheck className="size-4" aria-hidden />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  )
}