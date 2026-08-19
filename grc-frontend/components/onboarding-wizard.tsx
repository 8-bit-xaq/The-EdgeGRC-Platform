"use client"

import { useEffect, useRef, useState } from "react"
import { Building2, Upload, ArrowRight, ShieldCheck, CheckCircle2, ChevronRight, LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useOrganization } from "@/lib/organization"
import { FrameworkUploader } from "@/components/framework-uploader"
import { fetchApi } from "@/lib/api"
import { toast } from "sonner"

interface OnboardingWizardProps {
  onComplete: () => void
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { organization, updateOrganization } = useOrganization()
  const [step, setStep] = useState(1)

  // Security State
  const [userId, setUserId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)

  // Organization State (Starts completely empty)
  const [companyName, setCompanyName] = useState("")
  const [workspaceName, setWorkspaceName] = useState("")
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch the current user's ID so we can PATCH their password
  useEffect(() => {
    const username = localStorage.getItem("grc_username") || sessionStorage.getItem("grc_username")
    const token = localStorage.getItem("grc_token") || sessionStorage.getItem("grc_token")

    if (username && token) {
      // Changed to fetchApi and removed the "/api/" prefix
      fetchApi("users/")
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch users")
          return res.json()
      })
      .then(data => {
        if (Array.isArray(data)) {
          const currentUser = data.find((u: any) => u.username === username)
          if (currentUser) {
            setUserId(String(currentUser.id))
          }
        }
      })
      .catch(err => console.error("Failed to fetch user ID:", err))
    }
  }, [])

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

  async function handleNextStep() {
    if (step === 1) {
      if (newPassword.length < 8) {
        toast.error("Invalid Password", { description: "Password must be at least 8 characters long." })
        return
      }
      if (newPassword !== confirmPassword) {
        toast.error("Passwords Mismatch", { description: "The new password fields do not match." })
        return
      }

      setIsUpdatingPassword(true)

      try {
        // Changed to fetchApi, removed the "/api/" prefix, and removed the manual token injection
        const response = await fetchApi(`users/${userId}/`, {
          method: "PATCH",
          body: JSON.stringify({ password: newPassword }),
        })

        if (response.ok) {
          toast.success("Appliance Secured")
          setStep(2)
        } else {
          toast.error("Failed to update password")
        }
      } catch (error) {
        toast.error("Network Error", { description: "Could not connect to the appliance backend." })
      } finally {
        setIsUpdatingPassword(false)
      }
    } else if (step === 2) {
      if (!companyName.trim()) {
        toast.error("Company Name Required")
        return
      }
      updateOrganization({
        companyName: companyName.trim(),
                         workspaceName: workspaceName.trim(),
                         logoDataUrl,
      })
      setStep(3)
    } else if (step === 3) {
      setStep(4)
    }
  }

  return (
    <div className="min-h-screen w-full bg-muted/40 flex flex-col items-center justify-center p-4 sm:p-8">

    <div className="w-full max-w-2xl flex items-center justify-center mb-8 gap-3">
    <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
    <ShieldCheck className="size-6" aria-hidden />
    </div>
    <div>
    <h1 className="text-xl font-bold tracking-tight">Edge GRC Appliance Setup</h1>
    <p className="text-sm text-muted-foreground font-medium">Out-of-the-box Configuration</p>
    </div>
    </div>

    <div className="w-full max-w-2xl mb-6">
    <div className="flex items-center justify-between relative">
    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-border rounded-full" />
    <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full transition-all duration-500" style={{ width: step === 1 ? '0%' : step === 2 ? '33%' : step === 3 ? '66%' : '100%' }} />

    {[1, 2, 3, 4].map((num) => (
      <div key={num} className={`relative z-10 flex flex-col items-center justify-center gap-2 transition-all duration-300 ${step >= num ? 'text-primary' : 'text-muted-foreground'}`}>
      <div className={`size-8 rounded-full flex items-center justify-center text-sm font-bold border-2 bg-background transition-colors ${step >= num ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
      {step > num ? <CheckCircle2 className="size-5 text-primary" /> : num}
      </div>
      </div>
    ))}
    </div>
    <div className="flex justify-between mt-2 text-xs font-semibold px-1 text-muted-foreground">
    <span className={step >= 1 ? 'text-foreground' : ''}>Security</span>
    <span className={step >= 2 ? 'text-foreground' : ''}>Branding</span>
    <span className={step >= 3 ? 'text-foreground' : ''}>Framework</span>
    <span className={step >= 4 ? 'text-foreground' : ''}>Complete</span>
    </div>
    </div>

    <Card className="w-full max-w-2xl shadow-lg border-border/60">

    {step === 1 && (
      <>
      <CardHeader className="text-center pb-8 pt-8">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 mb-4">
      <LockKeyhole className="size-7" />
      </div>
      <CardTitle className="text-2xl">Secure Your Appliance</CardTitle>
      <CardDescription className="text-base mt-2">
      You are currently using the factory default credentials. Please change the master password to secure the appliance before continuing.
      </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 px-8 sm:px-16">
      <div className="grid gap-2">
      <Label htmlFor="new-password">New Master Password</Label>
      <Input
      id="new-password"
      type="password"
      value={newPassword}
      onChange={(e) => setNewPassword(e.target.value)}
      placeholder="At least 8 characters"
      className="h-10"
      />
      </div>
      <div className="grid gap-2">
      <Label htmlFor="confirm-password">Confirm Password</Label>
      <Input
      id="confirm-password"
      type="password"
      value={confirmPassword}
      onChange={(e) => setConfirmPassword(e.target.value)}
      placeholder="Type password again"
      className="h-10"
      />
      </div>
      </CardContent>
      <CardFooter className="px-8 pb-8 pt-4 flex justify-end border-t border-border mt-4 bg-muted/20 rounded-b-xl">
      <Button size="lg" onClick={handleNextStep} disabled={isUpdatingPassword || !newPassword || !confirmPassword || !userId}>
      {isUpdatingPassword ? "Securing Appliance..." : "Save & Continue"} <ArrowRight className="ml-2 size-4" />
      </Button>
      </CardFooter>
      </>
    )}

    {step === 2 && (
      <>
      <CardHeader className="text-center pb-8 pt-8">
      <CardTitle className="text-2xl">Welcome to your GRC Workspace</CardTitle>
      <CardDescription className="text-base mt-2">Let&apos;s brand this appliance for your organization.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8 px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted shadow-inner">
      {logoDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoDataUrl} alt="Company logo" className="size-full object-cover" />
      ) : (
        <Building2 className="size-8 text-muted-foreground/50" aria-hidden />
      )}
      </div>
      <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
      <Upload className="size-4" aria-hidden />
      Upload Company Logo
      </Button>
      {logoDataUrl && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setLogoDataUrl(null)}>Remove</Button>
      )}
      </div>
      <p className="text-xs text-muted-foreground">Square PNG or SVG recommended. Max 5MB.</p>
      <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={handleLogoChange} />
      </div>
      </div>

      <div className="grid gap-5">
      <div className="grid gap-2">
      <Label htmlFor="company-name" className="text-sm font-semibold">Legal Company Name *</Label>
      <Input id="company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Corporation" className="h-10" />
      </div>
      <div className="grid gap-2">
      <Label htmlFor="workspace-name" className="text-sm font-semibold">Workspace Title</Label>
      <Input id="workspace-name" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="e.g. Compliance Solutions" className="h-10" />
      <p className="text-xs text-muted-foreground">This title appears beneath your logo in the navigation menu.</p>
      </div>
      </div>
      </CardContent>
      <CardFooter className="px-8 pb-8 pt-4 flex justify-end border-t border-border mt-4 bg-muted/20 rounded-b-xl">
      <Button size="lg" onClick={handleNextStep} disabled={!companyName.trim()}>
      Continue <ArrowRight className="ml-2 size-4" />
      </Button>
      </CardFooter>
      </>
    )}

    {step === 3 && (
      <>
      <CardHeader className="text-center pb-6 pt-8">
      <CardTitle className="text-2xl">Seed your First Framework</CardTitle>
      <CardDescription className="text-base mt-2">Upload a structured JSON file containing your baseline controls (e.g. SOC 2, PCI-DSS).</CardDescription>
      </CardHeader>
      <CardContent className="px-8 pb-8">
      <FrameworkUploader onImported={() => setTimeout(() => setStep(4), 2000)} />
      </CardContent>
      <CardFooter className="px-8 py-4 flex justify-between border-t border-border bg-muted/20 rounded-b-xl">
      <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
      <Button variant="outline" onClick={handleNextStep}>Skip for now <ChevronRight className="ml-1 size-4" /></Button>
      </CardFooter>
      </>
    )}

    {step === 4 && (
      <div className="flex flex-col items-center justify-center py-16 px-8 text-center animate-in fade-in zoom-in duration-500">
      <div className="size-20 bg-success/15 text-success rounded-full flex items-center justify-center mb-6 ring-8 ring-success/5">
      <CheckCircle2 className="size-10" />
      </div>
      <h2 className="text-3xl font-bold tracking-tight mb-3">Appliance Ready</h2>
      <p className="text-muted-foreground max-w-md text-base mb-8">
      Your identity management is secure, your branding is set, and your database is initialized.
      </p>
      <Button size="lg" onClick={onComplete} className="w-full sm:w-auto min-w-[200px] h-12 text-base shadow-lg">
      Enter Dashboard <ArrowRight className="ml-2 size-5" />
      </Button>
      </div>
    )}
    </Card>
    </div>
  )
}
