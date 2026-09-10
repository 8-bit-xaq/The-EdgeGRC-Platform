import re
with open("grc-frontend/components/user-form-dialog.tsx", "r") as f:
    content = f.read()

new_content = """"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
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

const userSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().optional(),
  role: z.enum([...USER_ROLES] as [string, ...string[]]),
  status: z.enum([...USER_STATUSES] as [string, ...string[]]).optional(),
}).superRefine((data, ctx) => {
  if (data.password && data.password.length < 8) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Password must be at least 8 characters",
      path: ["password"],
    });
  }
});

type UserFormValues = z.infer<typeof userSchema>

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

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      name: "",
      username: "",
      password: "",
      role: "Contributor",
      status: "Inactive",
    },
  })

  const currentRole = watch("role")
  const currentStatus = watch("status")

  useEffect(() => {
    if (open) {
      if (user) {
        reset({
          name: user.name ?? "",
          username: user.username ?? "",
          password: "",
          role: user.role ?? "Contributor",
          status: user.status ?? "Inactive",
        })
      } else {
        reset({
          name: "",
          username: "",
          password: "",
          role: "Contributor",
          status: "Inactive",
        })
      }
    }
  }, [open, user, reset])

  function handleFormSubmit(data: UserFormValues) {
    if (!isEdit && !data.password) {
      // Manual error if password is empty on create
      return;
    }
    
    onSubmit({
      name: data.name,
      username: data.username,
      password: data.password || undefined,
      role: data.role as UserRole,
      status: isEdit ? (data.status as UserStatus) : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit(handleFormSubmit)}>
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
                placeholder="Full name"
                aria-invalid={Boolean(errors.name)}
                {...register("name")}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                type="text"
                autoComplete="username"
                placeholder="Enter a username"
                aria-invalid={Boolean(errors.username)}
                {...register("username")}
              />
              {errors.username && <p className="text-sm text-destructive">{errors.username.message}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-password">{isEdit ? "Change password" : "Password"}</Label>
              <Input
                id="user-password"
                type="password"
                autoComplete="new-password"
                placeholder={isEdit ? "Enter a new password" : "Create a password"}
                aria-invalid={Boolean(errors.password)}
                {...register("password")}
                required={!isEdit}
              />
              {errors.password ? (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {isEdit
                    ? "Leave blank to keep the current password. New passwords require at least 8 characters."
                    : "Use at least 8 characters."}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-role">Role</Label>
              <Select value={currentRole} onValueChange={(v) => setValue("role", v)}>
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
              {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
              <p className="text-xs text-muted-foreground text-pretty">{ROLE_DESCRIPTIONS[currentRole as UserRole]}</p>
            </div>
            {isEdit && (
              <div className="grid gap-2">
                <Label htmlFor="user-status">Status</Label>
                <Select value={currentStatus} onValueChange={(value) => setValue("status", value)}>
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
                {errors.status && <p className="text-sm text-destructive">{errors.status.message}</p>}
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
"""

with open("grc-frontend/components/user-form-dialog.tsx", "w") as f:
    f.write(new_content)
