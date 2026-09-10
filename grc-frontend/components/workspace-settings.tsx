"use client"

/**
 * @fileoverview Workspace Settings UI Component.
 * Handles organization profile customization, appliance backup/restore, 
 * platform updates, session management, and SSL certificate generation.
 */

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Building2,
  DatabaseBackup,
  Loader2,
  Monitor,
  ShieldCheck,
  Trash2,
  Upload,
  ArchiveRestore,
  UploadCloud,
  AlertCircle,
  KeyRound,
  Download,
  Info
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
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
import { fetchApi } from "@/lib/api"

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

/**
 * WorkspaceSettings Component
 */
export function WorkspaceSettings() {
  const { organization, updateOrganization } = useOrganization()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const updateInputRef = useRef<HTMLInputElement>(null)

  // Version state
  const [appVersion, setAppVersion] = useState("Unknown")

  // Role and Tab state
  const [role, setRole] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>("security")

  // Organization draft state
  const [companyName, setCompanyName] = useState(organization.companyName)
  const [workspaceName, setWorkspaceName] = useState(organization.workspaceName)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(organization.logoDataUrl)

  // Security & Backup draft state
  const [sessionTimeout, setSessionTimeout] = useState("4 hours") // Default fallback
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [saving, setSaving] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  
  // Backup / Restore / Update state
  const [isBackingUp, setIsBackingUp] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  // HTTPS & Trust State
  const [isHttpsEnabled, setIsHttpsEnabled] = useState(
    typeof window !== "undefined" && window.location.protocol === "https:"
  )
  const [isGeneratingSSL, setIsGeneratingSSL] = useState(false)
  const [isDownloadingCert, setIsDownloadingCert] = useState(false)

  // SSL Certificate Form State
  const [showSslDialog, setShowSslDialog] = useState(false)
  const [sslCommonName, setSslCommonName] = useState("")
  const [sslOrganization, setSslOrganization] = useState("")
  const [sslCountry, setSslCountry] = useState("US")
  const [sslState, setSslState] = useState("")
  const [sslLocality, setSslLocality] = useState("")

  // Allow and confirm deletion
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteUsername, setDeleteUsername] = useState("")
  const [deletePassword, setDeletePassword] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  // Fetch initial organization settings and session timeout from API on mount
  useEffect(() => {
    fetchApi("organization/")
      .then((res) => res.json())
      .then((data) => {
        if (data.session_timeout) {
          // Convert database minutes back to UI string
          const mins = data.session_timeout
          if (mins === 15) setSessionTimeout("15 minutes")
          else if (mins === 30) setSessionTimeout("30 minutes")
          else if (mins === 60) setSessionTimeout("1 hour")
          else if (mins === 240) setSessionTimeout("4 hours")
          else if (mins === 480) setSessionTimeout("8 hours")
          else setSessionTimeout(`${mins} minutes`)
        }
      })
      .catch((err) => console.error("Failed to fetch org settings:", err))
  }, [])

  // Sync local form inputs when the global context loads from storage
  useEffect(() => {
    setCompanyName(organization.companyName)
    setWorkspaceName(organization.workspaceName)
    setLogoDataUrl(organization.logoDataUrl)
  }, [organization])

  // Fetch Version on load with dynamic cache-busting timestamp
  useEffect(() => {
    fetch(`/version.json?t=${new Date().getTime()}`)
      .then((res) => res.json())
      .then((data) => setAppVersion(data.version))
      .catch(() => setAppVersion("1.0.0"))
  }, [])

  useEffect(() => {
    const savedRole = localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role")
    setRole(savedRole)
    if (savedRole === "Admin") {
      setActiveTab("organization")
      setIsLoadingSessions(true)
      
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

  async function revokeSession(id: string) {
    try {
      const res = await fetchApi("sessions/", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      })
      
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id))
        toast.success("Session revoked", { description: "That device has been securely signed out." })
      } else {
        toast.error("Failed to revoke session.", { description: "You may not have permission." })
      }
    } catch (err) {
      toast.error("Network error while revoking session.")
    }
  }

  async function handleSave() {
    setSaving(true)
    
    // Convert UI string to integer minutes for the database
    let timeoutMinutes = 240
    if (sessionTimeout === "15 minutes") timeoutMinutes = 15
    if (sessionTimeout === "30 minutes") timeoutMinutes = 30
    if (sessionTimeout === "1 hour") timeoutMinutes = 60
    if (sessionTimeout === "4 hours") timeoutMinutes = 240
    if (sessionTimeout === "8 hours") timeoutMinutes = 480

    try {
      const response = await fetchApi("organization/", {
        method: "PUT",
        body: JSON.stringify({
          company_name: companyName.trim() || organization.companyName,
          workspace_name: workspaceName.trim() || organization.workspaceName,
          logo_data_url: logoDataUrl,
          session_timeout: timeoutMinutes
        }),
      })

      if (!response.ok) throw new Error("Failed to save organization settings")

      // Update the frontend context so the navbar and UI update instantly
      updateOrganization({
        companyName: companyName.trim() || organization.companyName,
        workspaceName: workspaceName.trim() || organization.workspaceName,
        logoDataUrl,
      })

      toast.success("Changes saved", {
        description: "Your workspace settings have been updated.",
      })
    } catch (error) {
      toast.error("Save failed", {
        description: "Could not update settings. Please check your permissions.",
      })
    } finally {
      setSaving(false)
    }
  }

  function handleDeleteWorkspace() {
    setShowDeleteConfirm(true)
  }

  async function executeDeleteWorkspace() {
    const currentUsername = localStorage.getItem("grc_username") || sessionStorage.getItem("grc_username")
    
    if (deleteUsername !== currentUsername) {
      toast.error("Invalid username", { description: "The username entered does not match your active account." })
      return
    }

    if (!deletePassword) {
      toast.error("Password required", { description: "Please enter your password to confirm." })
      return
    }

    setIsDeleting(true)
    try {
      const res = await fetchApi("factory-reset/", {
        method: "POST",
        body: JSON.stringify({ password: deletePassword })
      })

      if (res.ok) {
        toast.success("Workspace Deleted", { description: "The appliance has been reset to factory defaults. Reloading..." })
        setTimeout(() => {
          localStorage.removeItem('grc_token')
          sessionStorage.removeItem('grc_token')
          window.location.reload()
        }, 2000)
      } else {
        const err = await res.json()
        toast.error("Reset Failed", { description: err.error || "Authentication failed." })
      }
    } catch (err) {
      toast.error("Network Error", { description: "Could not connect to the backend server." })
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
      setDeleteUsername("")
      setDeletePassword("")
    }
  }

  async function handleBackup() {
    setIsBackingUp(true)
    try {
      const res = await fetchApi("backup/")
      if (!res.ok) throw new Error("Backup request failed")
      
      const data = await res.json()
      if (data.task_id) {
        let isComplete = false
        while (!isComplete) {
          await new Promise(r => setTimeout(r, 2000))
          const statusRes = await fetchApi(`jobs/${data.task_id}/status/`)
          if (statusRes.ok) {
            const taskStatus = await statusRes.json()
            if (taskStatus.status === "SUCCESS") {
              isComplete = true
              const downloadRes = await fetchApi(`jobs/${data.task_id}/download/`)
              if (downloadRes.ok) {
                const blob = await downloadRes.blob()
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = `grc_system_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                toast.success("Backup downloaded successfully.")
              } else {
                throw new Error("Download failed")
              }
            } else if (taskStatus.status === "FAILED") {
              throw new Error("Task failed: " + taskStatus.error)
            }
          }
        }
      }
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
    if (backupInputRef.current) backupInputRef.current.value = ""
  }

  async function executeRestore() {
    if (!restoreFile) return

    setIsRestoring(true)
    const formData = new FormData()
    formData.append("file", restoreFile)

    try {
      const token = localStorage.getItem("grc_token") || sessionStorage.getItem("grc_token")
      const res = await fetchApi("restore/", {
        method: "POST",
        headers: {
          "Authorization": `Token ${token}`
        },
        body: formData,
      })

      if (!res.ok) throw new Error("Restore failed")

      toast.success("System Restored", { description: "Re-authenticating to load the restored state..." })
      
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
      const token = localStorage.getItem("grc_token") || sessionStorage.getItem("grc_token")
      const res = await fetchApi("update/", {
        method: "POST",
        headers: {
          "Authorization": `Token ${token}`
        },
        body: formData,
      })

      if (res.ok) {
        toast.success("Update initialized", { description: "The system is applying the update and will restart shortly." })
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

  function handleEnableHTTPS(checked: boolean) {
    if (!checked) {
      toast.info("HTTPS cannot be disabled via the UI for security reasons.")
      return
    }
    
    // Pre-fill sensible defaults for the user
    setSslCommonName(window.location.hostname || "edge-grc.local")
    setSslOrganization(organization.companyName || "Edge GRC")
    setShowSslDialog(true)
  }

  async function executeEnableHTTPS() {
    if (!sslCommonName) {
      toast.error("Common Name required", { description: "You must provide the domain or IP for the certificate." })
      return
    }

    setIsGeneratingSSL(true)
    try {
      const res = await fetchApi("system/https-config/", {
        method: "POST",
        body: JSON.stringify({ 
          common_name: sslCommonName,
          organization: sslOrganization,
          country: sslCountry,
          state: sslState,
          locality: sslLocality
        }),
      })

      if (!res.ok) throw new Error("Failed to configure HTTPS")

      toast.success("HTTPS Enabled", { description: "Nginx reloaded. The page will refresh securely in 3 seconds." })
      setIsHttpsEnabled(true)
      setShowSslDialog(false)
      
      setTimeout(() => {
        window.location.href = `https://${window.location.host}${window.location.pathname}`
      }, 3000)

    } catch (err) {
      toast.error("Configuration Failed", { description: "Ensure the backend has permissions to write files and reload Nginx." })
      setIsHttpsEnabled(false)
    } finally {
      setIsGeneratingSSL(false)
    }
  }

  async function handleDownloadPublicCert() {
    setIsDownloadingCert(true)
    try {
      const res = await fetchApi("system/https-config/", { method: "GET" })
      
      if (res.status === 404) {
        toast.error("Certificate missing", { description: "You must enable HTTPS before downloading the certificate." })
        return
      }
      if (!res.ok) throw new Error("Failed to download certificate")

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "edge-grc-root.pem"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success("Certificate downloaded", { description: "Install this in your OS Trusted Root store." })
    } catch (err) {
      toast.error("Download Failed", { description: "Could not retrieve the certificate." })
    } finally {
      setIsDownloadingCert(false)
    }
  }

  return (
    <div className="grid gap-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
        <TabsList className="w-full justify-start sm:w-fit">
          {isAdmin && <TabsTrigger value="organization">Organization</TabsTrigger>}
          <TabsTrigger value="security">Security &amp; Access</TabsTrigger>
        </TabsList>

        {/* Organization Tab */}
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
            
            {/* Data Management Card */}
            <Card>
              <CardHeader>
                <CardTitle>Data Management</CardTitle>
                <CardDescription>
                  Generate or restore a complete snapshot of your database and evidence artifacts.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
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

            {/* Platform Updates Card */}
            <Card className="border-purple-500/20 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <UploadCloud className="size-4 text-purple-500" />
                  Edge-GRC Platform Updates
                  <Badge variant="outline" className="ml-2 bg-muted text-muted-foreground">
                    v{appVersion}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload an official Edge-GRC release package to upgrade the appliance to the latest version.
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

        {/* Security & Access Tab */}
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
            <>
              {/* Appliance HTTPS & Trust Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <KeyRound className="size-4 text-primary" />
                    Appliance HTTPS & Trust
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Automate local HTTPS configuration and download the root certificate for your machine.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-4">
                    <div className="space-y-1 pr-4">
                      <p className="text-sm font-medium text-foreground">Enforce HTTPS</p>
                      <p className="text-xs text-muted-foreground text-balance">
                        Automatically generates cryptographic assets and restarts the proxy to listen on port 443.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {isGeneratingSSL && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                      <Switch 
                        checked={isHttpsEnabled} 
                        onCheckedChange={handleEnableHTTPS}
                        disabled={isGeneratingSSL || isHttpsEnabled}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <p className="text-sm font-medium text-foreground">Local Machine Trust</p>
                      <p className="text-xs text-muted-foreground">
                        Download the public <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">.pem</code> file and install it in your operating system's Trusted Root Certification Authorities store to eliminate browser security warnings.
                      </p>
                    </div>
                    <Button 
                      variant="outline" 
                      onClick={handleDownloadPublicCert}
                      disabled={isDownloadingCert || !isHttpsEnabled}
                      className="shrink-0 w-full sm:w-auto"
                    >
                      {isDownloadingCert ? (
                        <><Loader2 className="mr-2 size-4 animate-spin" /> Fetching...</>
                      ) : (
                        <><Download className="mr-2 size-4" /> Download Trust Certificate</>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

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
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Danger Zone */}
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

      {/* Confirmation Dialog for System Restore */}
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

      {/* SSL Configuration Dialog */}
      <Dialog open={showSslDialog} onOpenChange={setShowSslDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" /> Configure HTTPS Certificate
            </DialogTitle>
            <DialogDescription className="mt-2">
              Please provide the details for the self-signed X.509 certificate. 
              This information will be embedded in the public key you download for trust.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="ssl-common-name">Domain or IP (Common Name) *</Label>
              <Input
                id="ssl-common-name"
                value={sslCommonName}
                onChange={(e) => setSslCommonName(e.target.value)}
                placeholder="e.g. edge-grc.local or 192.168.1.100"
                disabled={isGeneratingSSL}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="ssl-org">Organization</Label>
              <Input
                id="ssl-org"
                value={sslOrganization}
                onChange={(e) => setSslOrganization(e.target.value)}
                placeholder="e.g. Acme Corp"
                disabled={isGeneratingSSL}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2 col-span-1">
                <Label htmlFor="ssl-country">Country</Label>
                <Input
                  id="ssl-country"
                  value={sslCountry}
                  onChange={(e) => setSslCountry(e.target.value)}
                  placeholder="US"
                  maxLength={2}
                  disabled={isGeneratingSSL}
                />
              </div>
              <div className="grid gap-2 col-span-2">
                <Label htmlFor="ssl-state">State / Province</Label>
                <Input
                  id="ssl-state"
                  value={sslState}
                  onChange={(e) => setSslState(e.target.value)}
                  placeholder="e.g. California"
                  disabled={isGeneratingSSL}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ssl-locality">City / Locality</Label>
              <Input
                id="ssl-locality"
                value={sslLocality}
                onChange={(e) => setSslLocality(e.target.value)}
                placeholder="e.g. San Francisco"
                disabled={isGeneratingSSL}
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowSslDialog(false)} disabled={isGeneratingSSL}>
              Cancel
            </Button>
            <Button onClick={executeEnableHTTPS} disabled={isGeneratingSSL}>
              {isGeneratingSSL ? <><Loader2 className="mr-2 size-4 animate-spin" /> Generating...</> : "Generate & Enable HTTPS"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Workspace Deletion */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <ShieldCheck className="size-5" /> Confirm Workspace Deletion
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2">
              This action is permanent and irreversible. All controls, risks, assessments, and evidence files will be wiped from the database.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="delete-username">Confirm your Username</Label>
              <Input
                id="delete-username"
                value={deleteUsername}
                onChange={(e) => setDeleteUsername(e.target.value)}
                placeholder="Enter your username"
                disabled={isDeleting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="delete-password">Confirm your Password</Label>
              <Input
                id="delete-password"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter your password"
                disabled={isDeleting}
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => {
              setShowDeleteConfirm(false);
              setDeleteUsername("");
              setDeletePassword("");
            }} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={executeDeleteWorkspace} disabled={isDeleting}>
              {isDeleting ? <><Loader2 className="mr-2 size-4 animate-spin" /> Purging...</> : "Permanently Delete Workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Save Action Bar */}
      <div className="sticky bottom-6 z-40 mt-8 flex flex-col items-center justify-between gap-4 rounded-xl border border-border bg-card px-6 py-4 shadow-lg sm:flex-row">
        <p className="text-sm text-muted-foreground text-center sm:text-left">
          Changes apply across your entire GRC workspace.
        </p>
        <Button 
          type="button" 
          onClick={handleSave} 
          disabled={saving} 
          className="w-full gap-2 sm:w-auto"
        >
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