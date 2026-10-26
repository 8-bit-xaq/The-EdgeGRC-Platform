"use client"

/**
 * @fileoverview Main navigation sidebar component.
 *
 * Provides primary view switching (Dashboard, Frameworks, Risk Register, Users,
 * Audit Logs, Settings) and displays active user avatar, role badge, organization
 * branding, and logout action.
 */

import { useEffect, useState } from "react"
import { AlertTriangle, LayoutDashboard, Layers, LogOut, ScrollText, Settings, ShieldCheck, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { useOrganization } from "@/lib/organization"
import { initials } from "@/lib/users"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export type NavView = "dashboard" | "frameworks" | "risks" | "users" | "audit" | "settings"

interface NavItem {
  view: NavView
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "frameworks", label: "Frameworks", icon: Layers },
  { view: "risks", label: "Risk Register", icon: AlertTriangle },
  { view: "users", label: "User", icon: Users },
  { view: "audit", label: "Audit Logs", icon: ScrollText },
  { view: "settings", label: "Settings", icon: Settings },
]

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    Admin: "border-transparent bg-primary/12 text-primary",
    Auditor: "border-transparent bg-accent text-accent-foreground",
    Contributor: "border-transparent bg-muted text-muted-foreground",
    Reviewer: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
    Executive: "border-transparent bg-purple-500/15 text-purple-600 dark:text-purple-400",
  }
  return (
    <Badge 
      variant="outline" 
      className={cn("mt-0.5 text-[10px] h-[18px] px-1.5 font-medium tracking-wide", styles[role] || styles.Contributor)}
    >
      {role || "Loading..."}
    </Badge>
  )
}

interface SidebarContentProps {
  active: NavView
  role: string 
  onNavigate: (view: NavView) => void
  onLogout: () => void
}

export function SidebarContent({ active, role, onNavigate, onLogout }: SidebarContentProps) {
  const { organization } = useOrganization()
  const [username, setUsername] = useState("User")
  const [avatar, setAvatar] = useState<string | null>(null)
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => item.view !== "audit" || ["Admin", "Auditor", "Executive"].includes(role)
  )

  useEffect(() => {
    const storedUser = localStorage.getItem("grc_username") || sessionStorage.getItem("grc_username")
    const storedAvatar = localStorage.getItem("grc_avatar") || sessionStorage.getItem("grc_avatar")
    
    if (storedUser) setUsername(storedUser)
    if (storedAvatar) setAvatar(storedAvatar)

    const handleAvatarUpdate = () => {
      const updatedAvatar = localStorage.getItem("grc_avatar") || sessionStorage.getItem("grc_avatar")
      setAvatar(updatedAvatar)
    }

    window.addEventListener("avatarUpdated", handleAvatarUpdate)
    return () => window.removeEventListener("avatarUpdated", handleAvatarUpdate)
  }, [])

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          {organization.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={organization.logoDataUrl || "/placeholder.svg"}
              alt={`${organization.companyName} logo`}
              className="size-full object-cover"
            />
          ) : (
            <ShieldCheck className="size-5" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
            {organization.companyName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{organization.workspaceName}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-3" aria-label="Primary">
        {visibleNavItems.map((item) => {
          const Icon = item.icon
          const isActive = active === item.view
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={() => onNavigate("users")}
          aria-current={active === "users" ? "page" : undefined}
          aria-label="Open your user profile"
          className={cn(
            "flex w-full items-center gap-3 rounded-md p-2 text-left outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            active === "users"
              ? "bg-sidebar-accent"
              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Avatar className="size-9 ring-2 ring-transparent transition-all">
            {avatar && <AvatarImage src={avatar} alt={username} className="object-cover" />}
            <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground uppercase">
              {initials(username)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{username}</p>
            <RoleBadge role={role} />
          </div>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          Log out
        </button>
      </div>
    </div>
  )
}