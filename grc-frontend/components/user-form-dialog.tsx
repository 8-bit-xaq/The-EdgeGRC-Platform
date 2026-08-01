"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ROLE_DESCRIPTIONS,
  USER_ROLES,
  USER_STATUSES,
  type ManagedUser,
  type UserRole,
  type UserStatus,
} from "@/lib/users"

interface UserFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, the dialog edits this user; otherwise it creates a new one. */
  user?: ManagedUser | null
  onSubmit: (data: {
    name: string
    username: string
    password?: string
    role: UserRole
    status?: UserStatus
  }) => void
}

export function UserFormDialog({ open, onOpenChange, user, onSubmit }: UserFormDialogProps) {
  const isEdit = Boolean(user)
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<UserRole>("Contributor")
  const [status, setStatus] = useState<UserStatus>("Inactive")

  // Prefill when editing, reset when creating.
  useEffect(() => {
    if (open) {
      setName(user?.name ?? "")
      setUsername(user?.username ?? "")
      setPassword("")
      setRole(user?.role ?? "Contributor")
      setStatus(user?.status ?? "Inactive")
    }
  }, [open, user])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !username.trim() || (!isEdit && !password)) return
    onSubmit({
      name: name.trim(),
      username: username.trim(),
      password: password || undefined,
      role,
      status: isEdit ? status : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit user" : "Create new user"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update this team member's details and role."
                : "Create a teammate account and assign its access level."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-5">
            <div className="grid gap-2">
              <Label htmlFor="user-name">Full name</Label>
              <Input
                id="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter a username"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-password">{isEdit ? "Change password" : "Password"}</Label>
              <Input
                id="user-password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? "Enter a new password" : "Create a password"}
                minLength={8}
                required={!isEdit}
              />
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? "Leave blank to keep the current password. New passwords require at least 8 characters."
                  : "Use at least 8 characters."}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger id="user-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground text-pretty">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
            {isEdit && (
              <div className="grid gap-2">
                <Label htmlFor="user-status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as UserStatus)}>
                  <SelectTrigger id="user-status">
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_STATUSES.map((userStatus) => (
                      <SelectItem key={userStatus} value={userStatus}>
                        {userStatus}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground text-pretty">
                  Inactive users cannot access the workspace.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create user"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
