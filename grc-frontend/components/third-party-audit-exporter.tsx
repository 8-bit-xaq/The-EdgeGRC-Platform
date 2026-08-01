"use client"

import { useEffect, useState } from "react"
import {
  Archive,
  Check,
  Download,
  FileJson,
  FileText,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useOrganization } from "@/lib/organization"

type ExportStep = "configure" | "generating" | "success"
type ExportFormat = "pdf" | "json" | "zip"
type ScopeKey = "controls" | "evidence" | "risks" | "logs" | "summary"

const SCOPES: Array<{ id: ScopeKey; label: string; description: string }> = [
  { id: "controls", label: "Control Matrix Status", description: "Control requirements, owners, and current statuses." },
  { id: "evidence", label: "Supporting Evidence Proofs", description: "Attached proof references and physical evidence files." },
  { id: "risks", label: "Enterprise Risk Register", description: "Inherent and residual risk profiles mapped to controls." },
  { id: "logs", label: "Audit Logs", description: "Chronological activity and change history." },
  { id: "summary", label: "Organization Compliance Summary", description: "High-level posture and framework coverage." },
]

const FORMATS: Array<{ value: ExportFormat; label: string; detail: string; icon: typeof FileText }> = [
  { value: "zip", label: "ZIP Package with Proof Files", detail: "Report and physical attachments", icon: Archive },
  { value: "json", label: "Structured JSON Framework", detail: "Machine-readable data", icon: FileJson },
  { value: "pdf", label: "PDF Executive Summary", detail: "Review-ready document", icon: FileText },
]

const PROGRESS_MESSAGES = [
  "Validating export scope",
  "Applying redaction rules",
  "Packaging compliance records",
  "Finalizing export package",
]

export function ThirdPartyAuditExporter() {
  const { organization } = useOrganization()

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<ExportStep>("configure")
  const [scope, setScope] = useState<Record<ScopeKey, boolean>>({
    controls: true,
    evidence: true,
    risks: true,
    logs: true,
    summary: true,
  })
  const [format, setFormat] = useState<ExportFormat>("zip")
  const [redact, setRedact] = useState(true)
  
  // File Encryption State
  const [isEncrypted, setIsEncrypted] = useState(false)
  const [filePassword, setFilePassword] = useState("")
  
  const [progress, setProgress] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [downloadFilename, setDownloadFilename] = useState<string>("audit-package.zip")

  const selectedCount = Object.values(scope).filter(Boolean).length

  useEffect(() => {
    if (step !== "generating") return

    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(current + 8, 100)
        if (next === 100) {
          window.clearInterval(timer)
          window.setTimeout(() => setStep("success"), 250)
        }
        return next
      })
    }, 160)

    return () => window.clearInterval(timer)
  }, [step])

  function reset() {
    setStep("configure")
    setProgress(0)
    setFilePassword("")
    setIsEncrypted(false)
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl)
      setDownloadUrl(null)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) window.setTimeout(reset, 150)
  }

  async function generatePackage() {
    if (selectedCount === 0) {
      toast.error("Select at least one section", {
        description: "The audit package needs content before it can be generated.",
      })
      return
    }

    if (isEncrypted && format === "pdf" && !filePassword.trim()) {
      toast.error("Password required", { 
        description: "Please enter a password to encrypt the PDF document." 
      })
      return
    }
    
    setProgress(4)
    setStep("generating")

    try {
      const token = localStorage.getItem("grc_token") || sessionStorage.getItem("grc_token")
      
      const payload = { 
        scope, 
        format, 
        redact, 
        organization,
        password: (isEncrypted && format === "pdf") ? filePassword.trim() : null
      }
      
      const res = await fetch("http://localhost:8000/api/export/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Token ${token}`
        },
        body: JSON.stringify(payload)
      })

      // Fix: Read as text first to avoid locked stream errors on fallback parsing
      if (!res.ok) {
        let errorMsg = `Server Error (${res.status})`
        const responseText = await res.text()
        try {
          const errData = JSON.parse(responseText)
          errorMsg = errData.error || errData.detail || errorMsg
        } catch {
          errorMsg = responseText || errorMsg
        }
        throw new Error(errorMsg)
      }
      
      let blob;
      if (format === "zip" || format === "pdf") {
        blob = await res.blob()
        const extension = format === "zip" ? "zip" : "pdf"
        setDownloadFilename(`audit-package-${Date.now()}.${extension}`)
      } else {
        const responseData = await res.json()
        blob = new Blob([JSON.stringify(responseData.data, null, 2)], { type: "application/json" })
        setDownloadFilename(`audit-package-${Date.now()}.json`)
      }

      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)

    } catch (err: any) {
      console.error(err)
      toast.error("Export Failed", { description: err.message || "Failed to communicate with the export server." })
      setStep("configure")
    }
  }

  function handleDownload() {
    if (!downloadUrl) return
    const a = document.createElement("a")
    a.href = downloadUrl
    a.download = downloadFilename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success("Package download started")
  }

  const progressMessage = PROGRESS_MESSAGES[Math.min(Math.floor(progress / 26), 3)]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="secondary" />}>
        <ShieldCheck data-icon="inline-start" />
        Export audit package
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        {step === "configure" && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <LockKeyhole className="size-5" aria-hidden />
                </div>
                <div className="flex flex-col gap-1">
                  <DialogTitle>Third-Party Compliance Export</DialogTitle>
                  <DialogDescription>
                    Generate a controlled audit package for an external reviewer.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-5">
              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-medium text-foreground">Package scope</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SCOPES.map((item) => (
                    <label
                      key={item.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                        scope[item.id] ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50",
                      )}
                    >
                      <Checkbox
                        checked={scope[item.id]}
                        onCheckedChange={(checked) =>
                          setScope((current) => ({ ...current, [item.id]: checked }))
                        }
                        aria-label={item.label}
                      />
                      <span className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-foreground">{item.label}</span>
                        <span className="text-xs leading-relaxed text-muted-foreground">{item.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <Separator />

              <div className="flex flex-col gap-2">
                <label htmlFor="audit-format" className="text-sm font-medium text-foreground">
                  Export format
                </label>
                <Select value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
                  <SelectTrigger id="audit-format" className="w-full">
                    <SelectValue>{FORMATS.find((item) => item.value === format)?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {FORMATS.map((item) => {
                        const Icon = item.icon
                        return (
                          <SelectItem key={item.value} value={item.value}>
                            <Icon aria-hidden />
                            <span className="flex flex-col">
                              <span>{item.label}</span>
                              <span className="text-xs text-muted-foreground">{item.detail}</span>
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <fieldset className="flex flex-col gap-4">
                <legend className="text-sm font-medium text-foreground">Security and redaction</legend>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="redact-export" className="text-sm font-medium text-foreground">
                      Redact internal user metadata
                    </label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Remove usernames, internal identifiers, and actor details.
                    </p>
                  </div>
                  <Switch id="redact-export" checked={redact} onCheckedChange={setRedact} />
                </div>
                
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="encrypt-export" className={cn("text-sm font-medium", format === "pdf" ? "text-foreground" : "text-muted-foreground")}>
                      Password-protect PDF
                    </label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {format === "pdf" ? "Encrypt the exported PDF file with a password." : "File encryption is only available for PDF exports."}
                    </p>
                  </div>
                  <Switch id="encrypt-export" checked={isEncrypted && format === "pdf"} onCheckedChange={setIsEncrypted} disabled={format !== "pdf"} />
                </div>
                
                {isEncrypted && format === "pdf" && (
                  <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 animate-in slide-in-from-top-2 fade-in">
                    <label htmlFor="pdf-password" className="text-sm font-medium text-foreground">Document Password</label>
                    <Input 
                      id="pdf-password" 
                      type="text" 
                      value={filePassword} 
                      onChange={(e) => setFilePassword(e.target.value)} 
                      placeholder="Enter a secure password..."
                      className="bg-background"
                    />
                  </div>
                )}
              </fieldset>

              <Alert>
                <ShieldCheck aria-hidden />
                <AlertTitle>Secure export controls</AlertTitle>
                <AlertDescription>
                  Exports are generated directly from the live database and include verifiable artifacts. Keep exported files secure.
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={generatePackage} disabled={selectedCount === 0}>
                <LockKeyhole data-icon="inline-start" />
                Generate Audit Package
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "generating" && (
          <div className="flex min-h-80 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LoaderCircle className="size-7 animate-spin" aria-hidden />
            </div>
            <DialogHeader className="items-center">
              <DialogTitle>Generating secure package</DialogTitle>
              <DialogDescription>
                Keep this window open while the selected compliance records are prepared.
              </DialogDescription>
            </DialogHeader>
            <Progress value={progress} className="w-full max-w-md">
              <ProgressLabel>{progressMessage}</ProgressLabel>
              <ProgressValue>{() => `${progress}%`}</ProgressValue>
            </Progress>
            <p className="text-xs text-muted-foreground">Packaging {selectedCount} selected sections</p>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col gap-6 px-1 py-2">
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="size-7" aria-hidden />
              </div>
              <DialogHeader className="items-center">
                <DialogTitle>Audit package is ready</DialogTitle>
                <DialogDescription>
                  Your compliance data has been securely packaged for download.
                </DialogDescription>
              </DialogHeader>
            </div>

            <Alert>
              <LockKeyhole aria-hidden />
              <AlertTitle>Export generated successfully</AlertTitle>
              <AlertDescription>
                {redact ? "Internal user metadata has been redacted." : "Internal user metadata is included."}
                {isEncrypted && format === "pdf" && " The PDF is secured with your provided password."}
              </AlertDescription>
            </Alert>

            <div className="grid gap-2">
              <Button size="lg" className="w-full" onClick={handleDownload} disabled={!downloadUrl}>
                <Download className="mr-2 size-5" />
                {format === "zip" && "Download ZIP Package"}
                {format === "pdf" && "Download PDF Report"}
                {format === "json" && "Download JSON Package"}
              </Button>
            </div>

            <DialogFooter className="mt-4 border-none bg-transparent sm:justify-between p-0">
              <Button variant="ghost" onClick={reset}>Create another export</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}