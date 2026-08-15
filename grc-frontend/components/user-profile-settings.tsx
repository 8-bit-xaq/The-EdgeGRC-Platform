"use client"

import { useEffect, useState, useRef } from "react"
import { toast } from "sonner"
import { Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { initials } from "@/lib/users"
import { fetchApi } from "@/lib/api"

interface NotificationPref {
  id: string
  label: string
  description: string
  enabled: boolean
}

export function UserProfileSettings() {
  const [name, setName] = useState("Loading...")
  const [userId, setUserId] = useState<string | null>(null)
  const [role, setRole] = useState("Contributor")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)

  // Real system notifications mapped directly to the backend models
  const [notifications, setNotifications] = useState<NotificationPref[]>([
    { id: "notify_assessments", label: "Assessment Alerts", description: "Notify when assessments are ready for QA or finalized.", enabled: true },
    { id: "notify_tasks", label: "Task Assignments", description: "Notify when remediation tasks are assigned or resolved.", enabled: true },
    { id: "notify_schedules", label: "Audit Schedules", description: "Notify when recurring audits are approaching and evidence is needed.", enabled: false },
  ])

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const username = localStorage.getItem("grc_username") || sessionStorage.getItem("grc_username")

    fetchApi("users/")
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data)) {
        const currentUser = data.find((u: any) => u.username === username)
        if (currentUser) {
          setName(`${currentUser.first_name || ""} ${currentUser.last_name || ""}`.trim() || username || "User")
          setUserId(String(currentUser.id))
          setRole(currentUser.role || "Contributor")

          // Hydrate notification preferences from the DB
          setNotifications([
            { id: "notify_assessments", label: "Assessment Alerts", description: "Notify when assessments are ready for QA or finalized.", enabled: currentUser.notify_assessments ?? false },
            { id: "notify_tasks", label: "Task Assignments", description: "Notify when remediation tasks are assigned or resolved.", enabled: currentUser.notify_tasks ?? false },
            { id: "notify_schedules", label: "Audit Schedules", description: "Notify when recurring audits are approaching and evidence is needed.", enabled: currentUser.notify_schedules ?? false },
          ])

          if (currentUser.avatar) {
            setAvatarUrl(currentUser.avatar)
            if (localStorage.getItem("grc_token")) localStorage.setItem("grc_avatar", currentUser.avatar)
              if (sessionStorage.getItem("grc_token")) sessionStorage.setItem("grc_avatar", currentUser.avatar)
          }
        }
      } else {
        toast.error("Could not load profile data.")
      }
    })
    .catch((err) => {
      console.error("Fetch error:", err)
      toast.error("Failed to fetch user profile.")
    })
    .finally(() => setIsLoading(false))
  }, [])

  function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    toast.success("Profile updated", { description: "Your account details have been saved." })
  }

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !userId) return

      if (file.size > 5 * 1024 * 1024) {
        toast.error("File too large", { description: "Avatars must be 5MB or smaller." })
        return
      }

      const objectUrl = URL.createObjectURL(file)
      setAvatarUrl(objectUrl)

      setIsUploadingAvatar(true)
      const token = localStorage.getItem("grc_token") || sessionStorage.getItem("grc_token")

      const formData = new FormData()
      formData.append("avatar", file)

        try {
          // Bypass fetchApi wrapper to allow the browser to auto-set the multipart boundary header
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "/api"}/users/${userId}/`, {
            method: "PATCH",
            headers: {
              "Authorization": `Token ${token}`
            },
            body: formData,
          })

          if (response.ok) {
            const updatedUser = await response.json()
            const finalAvatarUrl = updatedUser.avatar || objectUrl

            setAvatarUrl(finalAvatarUrl)

            if (localStorage.getItem("grc_token")) localStorage.setItem("grc_avatar", finalAvatarUrl)
              if (sessionStorage.getItem("grc_token")) sessionStorage.setItem("grc_avatar", finalAvatarUrl)
                window.dispatchEvent(new Event("avatarUpdated"))

                toast.success("Avatar updated", { description: "Your profile picture has been changed." })
          } else {
            toast.error("Upload failed", { description: "Could not save the avatar to the server." })
          }
        } catch (error) {
          console.error("Avatar upload error:", error)
          toast.error("Network error", { description: "Check your connection to the server." })
        } finally {
          setIsUploadingAvatar(false)
          if (fileInputRef.current) fileInputRef.current.value = ""
        }
  }

  async function handlePasswordUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)

      const newPassword = formData.get("newPassword") as string
      const confirmPassword = formData.get("confirmPassword") as string

      if (!newPassword || newPassword.length < 8) {
        toast.error("Invalid password", { description: "Your new password must be at least 8 characters." })
        return
      }

      if (newPassword !== confirmPassword) {
        toast.error("Passwords do not match", { description: "Ensure both new password fields match exactly." })
        return
      }

      setIsUpdatingPassword(true)

      try {
        const response = await fetchApi(`users/${userId}/`, {
          method: "PATCH",
          body: JSON.stringify({
            password: newPassword
          }),
        })

        if (response.ok) {
          form.reset()
            toast.success("Password changed", {
              description: "Use your new password the next time you sign in.",
            })
        } else {
          toast.error("Failed to update password", { description: "You may not have permission to perform this action." })
        }
      } catch (error) {
        console.error("Network error saving password:", error)
        toast.error("Network error", { description: "Could not connect to the backend server." })
      } finally {
        setIsUpdatingPassword(false)
      }
  }

  async function toggleNotification(id: string, enabled: boolean) {
    // 1. Optimistic UI update
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, enabled } : n)))

    if (!userId) return

      try {
        // 2. Transmit PATCH directly to the DB
        const res = await fetchApi(`users/${userId}/`, {
          method: "PATCH",
          body: JSON.stringify({ [id]: enabled })
        })

        if (res.ok) {
          const pref = notifications.find((n) => n.id === id)
          if (pref) toast.success(`${pref.label} ${enabled ? "enabled" : "disabled"}`)
        } else {
          // 3. Rollback UI on failure
          setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, enabled: !enabled } : n)))
          toast.error("Failed to update preference")
        }
      } catch (err) {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, enabled: !enabled } : n)))
        toast.error("Network error saving preference")
      }
  }

  // Determine which toggles to show based on the user's role
  const showAssessments = ["Admin", "Auditor", "Reviewer"].includes(role);
  const showTasks = ["Admin", "Reviewer", "Contributor"].includes(role);
  const showSchedules = ["Admin", "Contributor"].includes(role);

  const visibleNotifications = notifications.filter(n => {
    if (n.id === "notify_assessments") return showAssessments;
    if (n.id === "notify_tasks") return showTasks;
    if (n.id === "notify_schedules") return showSchedules;
    return false;
  });

  return (
    <div className="grid gap-6">
    <Card>
    <CardHeader>
    <CardTitle>Profile details</CardTitle>
    <CardDescription>Update how your name appears across the workspace.</CardDescription>
    </CardHeader>
    <CardContent>
    <form onSubmit={handleProfileSave} className="grid gap-6">
    <div className="flex items-center gap-4">
    <Avatar size="lg">
    {avatarUrl && <AvatarImage src={avatarUrl} alt={name} className="object-cover" />}
    <AvatarFallback>{isLoading ? "..." : initials(name)}</AvatarFallback>
    </Avatar>
    <div className="flex flex-col gap-2">
    <input
    type="file"
    ref={fileInputRef}
    onChange={handleAvatarSelect}
    accept="image/jpeg, image/png, image/gif, image/webp"
    className="sr-only"
    aria-label="Upload new avatar"
    />
    <Button
    type="button"
    variant="outline"
    size="sm"
    className="gap-2"
    onClick={() => fileInputRef.current?.click()}
    disabled={isUploadingAvatar || !userId}
    >
    {isUploadingAvatar ? (
      <Loader2 className="size-4 animate-spin" aria-hidden />
    ) : (
      <Upload className="size-4" aria-hidden />
    )}
    {isUploadingAvatar ? "Uploading..." : "Change avatar"}
    </Button>
    <p className="text-xs text-muted-foreground">JPG, PNG or GIF. Max 5MB.</p>
    </div>
    </div>

    <div className="grid max-w-xl gap-2">
    <Label htmlFor="profile-name">Full name</Label>
    <Input
    id="profile-name"
    value={name}
    onChange={(e) => setName(e.target.value)}
    placeholder="Your name"
    />
    </div>

    <div className="flex justify-end">
    <Button type="submit">Save changes</Button>
    </div>
    </form>
    </CardContent>
    </Card>

    <Card>
    <CardHeader>
    <CardTitle>Security</CardTitle>
    <CardDescription>Manage the password you use to sign in.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-8">
    <form onSubmit={handlePasswordUpdate} className="grid gap-4">
    <h3 className="text-sm font-semibold text-card-foreground">Password management</h3>
    <div className="grid gap-4 sm:grid-cols-3">
    <div className="grid gap-2">
    <Label htmlFor="current-password">Current</Label>
    <Input
    id="current-password"
    name="currentPassword"
    type="password"
    placeholder="••••••••"
    autoComplete="current-password"
    />
    </div>
    <div className="grid gap-2">
    <Label htmlFor="new-password">New</Label>
    <Input
    id="new-password"
    name="newPassword"
    type="password"
    placeholder="••••••••"
    autoComplete="new-password"
    />
    </div>
    <div className="grid gap-2">
    <Label htmlFor="confirm-password">Confirm</Label>
    <Input
    id="confirm-password"
    name="confirmPassword"
    type="password"
    placeholder="••••••••"
    autoComplete="new-password"
    />
    </div>
    </div>
    <div className="flex justify-end">
    <Button type="submit" variant="outline" disabled={isUpdatingPassword || !userId} className="min-w-36">
    {isUpdatingPassword ? (
      <>
      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
      Updating...
      </>
    ) : (
      "Update password"
    )}
    </Button>
    </div>
    </form>
    </CardContent>
    </Card>

    <Card>
    <CardHeader>
    <CardTitle>Notifications</CardTitle>
    <CardDescription>
    Choose which alerts appear in your in-app notification bell.
    </CardDescription>
    </CardHeader>
    <CardContent>
    {role === "Executive" ? (
      <p className="text-sm text-muted-foreground bg-muted p-4 rounded-md text-center">
      Executive accounts do not receive operational alerts.
      </p>
    ) : (
      <ul className="grid gap-1">
      {visibleNotifications.map((pref, index) => (
        <li key={pref.id}>
        {index > 0 && <Separator className="my-1" />}
        <div className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0">
        <Label htmlFor={`notif-${pref.id}`} className="text-sm font-medium cursor-pointer">
        {pref.label}
        </Label>
        <p className="text-sm text-muted-foreground text-pretty">{pref.description}</p>
        </div>
        <Switch
        id={`notif-${pref.id}`}
        checked={pref.enabled}
        onCheckedChange={(checked) => toggleNotification(pref.id, checked)}
        />
        </div>
        </li>
      ))}
      </ul>
    )}
    </CardContent>
    </Card>
    </div>
  )
}
