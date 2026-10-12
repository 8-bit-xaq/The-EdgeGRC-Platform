"use client"

import * as React from "react"
import { Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchApi } from "@/lib/api"
import { toast } from "sonner"

interface ForcePasswordChangeModalProps {
  onPasswordChanged: () => void
  onLogout: () => void
}

export function ForcePasswordChangeModal({
  onPasswordChanged,
  onLogout,
}: ForcePasswordChangeModalProps) {
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showCurrent, setShowCurrent] = React.useState(false)
  const [showNew, setShowNew] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)

    if (!currentPassword) {
      setErrorMessage("Please enter your current temporary password.")
      return
    }

    if (!newPassword || newPassword.length < 8) {
      setErrorMessage("New password must be at least 8 characters long.")
      return
    }

    if (newPassword === currentPassword) {
      setErrorMessage("New password cannot be identical to the temporary password.")
      return
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("New passwords do not match.")
      return
    }

    setIsLoading(true)

    try {
      const res = await fetchApi("users/change-password/", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      })

      const data = await res.json().catch(() => null)

      if (res.ok) {
        toast.success("Password Updated", {
          description: "Your new password has been set. Welcome to Edge GRC.",
        })
        onPasswordChanged()
      } else {
        if (data?.error) {
          if (Array.isArray(data.error)) {
            setErrorMessage(data.error.join(" "))
          } else {
            setErrorMessage(String(data.error))
          }
        } else {
          setErrorMessage("Failed to update password. Please check your credentials.")
        }
      }
    } catch (err) {
      console.error(err)
      setErrorMessage("Network error occurred while connecting to the server.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in-0 duration-200">
      <Card className="w-full max-w-md border-border shadow-2xl bg-card">
        <CardHeader className="space-y-2 text-center pb-4">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <ShieldAlert className="size-6" />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight text-foreground">
            Password Change Required
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground text-balance">
            Your account is currently using a factory default or temporary password. Security policy requires you to set a secure personal password before continuing.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {errorMessage && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                {errorMessage}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="current-pw" className="text-xs">
                Current / Temporary Password
              </Label>
              <div className="relative">
                <Input
                  id="current-pw"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                  required
                  className="pr-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showCurrent ? "Hide password" : "Show password"}
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-pw" className="text-xs">
                New Password (minimum 8 characters)
              </Label>
              <div className="relative">
                <Input
                  id="new-pw"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new strong password"
                  autoComplete="new-password"
                  required
                  className="pr-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showNew ? "Hide password" : "Show password"}
                >
                  {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw" className="text-xs">
                Confirm New Password
              </Label>
              <Input
                id="confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                autoComplete="new-password"
                required
                className="text-sm"
              />
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-2 pt-2">
            <Button type="submit" className="w-full gap-2" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Updating Password...
                </>
              ) : (
                <>
                  <KeyRound className="size-4" />
                  Update Password &amp; Continue
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={onLogout}
              disabled={isLoading}
            >
              <LogOut className="size-3.5 mr-1" />
              Sign Out
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

