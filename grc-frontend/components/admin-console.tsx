"use client"

import { useMemo, useState, useEffect } from "react"
import { toast } from "sonner"
import { Pencil, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { UserFormDialog } from "@/components/user-form-dialog"
import {
  initials,
  type ManagedUser,
  type UserRole,
  type UserStatus,
} from "@/lib/users"
import { cn } from "@/lib/utils"
import { fetchApi } from "@/lib/api" // <-- NEW: Imported the API wrapper

function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    Admin: "border-transparent bg-primary/12 text-primary",
    Auditor: "border-transparent bg-accent text-accent-foreground",
    Contributor: "border-transparent bg-muted text-muted-foreground",
    Reviewer: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
    Executive: "border-transparent bg-purple-500/15 text-purple-600 dark:text-purple-400",
  }
  return (
    <Badge variant="outline" className={cn("font-medium", styles[role])}>
      {role}
    </Badge>
  )
}

function StatusBadge({ status }: { status: UserStatus }) {
  const isActive = status === "Active"
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        isActive
          ? "border-transparent bg-success/15 text-success"
          : "border-transparent bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", isActive ? "bg-success" : "bg-muted-foreground/60")}
        aria-hidden
      />
      {status}
    </Badge>
  )
}

export function AdminConsole() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [query, setQuery] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ManagedUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loggedInUser, setLoggedInUser] = useState("")

  useEffect(() => {
    // Keep username to prevent self-deletion
    setLoggedInUser(localStorage.getItem("grc_username") || sessionStorage.getItem("grc_username") || "")

    // API Wrapper automatically handles URLs and Tokens
    fetchApi("users/")
      .then((res) => res.json())
      .then((data) => {
        const fetchedUsers = data.map((u: any) => ({
          id: String(u.id),
          name: `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username,
          username: u.username,
          role: (u.role || "Contributor") as UserRole, 
          status: u.is_active ? "Active" : "Inactive" as UserStatus, 
        }))
        setUsers(fetchedUsers)
      })
      .catch((err) => {
        console.error("Failed to fetch users:", err)
        toast.error("Failed to load users from backend")
      })
      .finally(() => setIsLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    )
  }, [users, query])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(user: ManagedUser) {
    setEditing(user)
    setFormOpen(true)
  }

  async function handleSubmit(data: {
    name: string
    username: string
    password?: string
    role: UserRole
    status?: UserStatus
  }) {
    const firstName = data.name.split(" ")[0] || ""
    const lastName = data.name.substring(firstName.length).trim()
    const isActive = data.status === "Active"

    if (editing) {
      try {
        const response = await fetchApi(`users/${editing.id}/`, {
          method: "PUT",
          body: JSON.stringify({
            username: data.username,
            first_name: firstName,
            last_name: lastName,
            is_active: isActive,
            role: data.role,
            ...(data.password ? { password: data.password } : {})
          }),
        })

        if (response.ok) {
          const userDetails = {
            name: data.name,
            username: data.username,
            role: data.role,
            status: isActive ? "Active" : "Inactive" as UserStatus,
          }
          setUsers((prev) => prev.map((u) => (u.id === editing.id ? { ...u, ...userDetails } : u)))
          toast.success("User updated", { description: `${data.name}'s details were saved.` })
          setFormOpen(false)
          setEditing(null)
        } else {
          toast.error("Failed to update user")
        }
      } catch (error) {
        console.error("Network error:", error)
        toast.error("Network error saving user.")
      }
    } else {
      try {
        const response = await fetchApi("users/", {
          method: "POST",
          body: JSON.stringify({
            username: data.username,
            first_name: firstName,
            last_name: lastName,
            email: "",
            password: data.password || "ChangeMe123!", 
            is_active: true,
            role: data.role
          }),
        });

        if (response.ok) {
          const responseData = await response.json();
          const newUser: ManagedUser = {
            id: String(responseData.id || `u-${Date.now()}`),
            name: data.name, 
            username: data.username,
            role: data.role,
            status: "Active",
          }
          setUsers((prev) => [newUser, ...prev])
          toast.success("User created", {
            description: `${data.name} was created as ${data.role}.`,
          })
          setFormOpen(false)
          setEditing(null)
        } else {
          const errorData = await response.json();
          console.error("Failed to create user:", errorData);
          toast.error("Failed to create user. Ensure username is unique.");
        }
      } catch (error) {
        console.error("Network error:", error);
        toast.error("Network error. Is the Django server running?");
      }
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return

    try {
      const response = await fetchApi(`users/${pendingDelete.id}/`, {
        method: "DELETE",
      });

      if (response.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id))
        toast.success("User removed", { description: `${pendingDelete.name} no longer has access.` })
      } else {
        toast.error("Failed to delete user.", { description: "You might not have permission." })
      }
    } catch (error) {
      console.error("Network error:", error)
      toast.error("Network error. Is the Django server running?")
    } finally {
      setPendingDelete(null)
    }
  }

  const activeCount = users.filter((u) => u.status === "Active").length

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-4 border-b border-border bg-primary/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold tracking-tight text-card-foreground">
              User Management
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              {users.length} team members · {activeCount} active
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <UserPlus className="size-4" aria-hidden />
          Create user
        </Button>
      </div>

      <div className="border-b border-border p-4">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or username..."
            className="pl-9"
            aria-label="Search users by name or username"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-[200px]">Name</TableHead>
              <TableHead className="min-w-[220px]">Username</TableHead>
              <TableHead className="w-[140px]">Role</TableHead>
              <TableHead className="w-[130px]">Status</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  {users.length === 0
                    ? "No users yet. Create one to get started."
                    : `No users match "${query}".`}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => {
                const isSelf = user.username === loggedInUser;
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar size="sm">
                          <AvatarFallback>{initials(user.name)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground">{user.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {user.username}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={user.role} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={user.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(user)}
                          aria-label={`Edit ${user.name}`}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive disabled:opacity-50"
                          onClick={() => setPendingDelete(user)}
                          aria-label={`Delete ${user.name}`}
                          disabled={isSelf}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
        Showing {filtered.length} of {users.length} users
      </div>

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editing}
        onSubmit={handleSubmit}
      />

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription className="text-pretty">
              This will permanently revoke access for{" "}
              <span className="font-medium text-foreground">{pendingDelete?.name}</span> (
              {pendingDelete?.username}). This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} className="gap-2">
              <Trash2 className="size-4" aria-hidden />
              Delete user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}