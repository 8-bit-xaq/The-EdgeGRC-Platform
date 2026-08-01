"use client"

import { useEffect, useState } from "react"
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { SidebarContent, type NavView } from "@/components/app-sidebar"
import { FrameworksView } from "@/components/frameworks-view"
import { MetricsDashboard } from "@/components/metrics-dashboard"
import { UserManagement } from "@/components/user-management"
import { AuditLogs } from "@/components/audit-logs"
import { WorkspaceSettings } from "@/components/workspace-settings"
import { NotificationBell } from "@/components/notification-bell"
import { RiskRegister } from "@/components/risk-register"
import { OrganizationProvider } from "@/lib/organization"
import { NotificationsProvider } from "@/lib/notifications"
import { OnboardingWizard } from "@/components/onboarding-wizard"

const VIEW_META: Record<NavView, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Compliance Dashboard",
    subtitle: "Real-time overview of your organization's compliance posture.",
  },
  frameworks: {
    title: "Framework Management",
    subtitle: "Import compliance frameworks and manage their controls.",
  },
  risks: {
    title: "Enterprise Risk Register",
    subtitle: "Map security risks to controls and quantify residual risk.",
  },
  users: {
    title: "Users & Access",
    subtitle: "Manage your profile and administer team access.",
  },
  audit: {
    title: "Audit Logs",
    subtitle: "Track every change across your compliance program.",
  },
  settings: {
    title: "Settings",
    subtitle: "Configure your workspace and organization preferences.",
  },
}

interface GrcAppProps {
  onLogout: () => void
}

export function GrcApp({ onLogout }: GrcAppProps) {
  const [view, setView] = useState<NavView>("frameworks")
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [role, setRole] = useState("")
  const [targetControlId, setTargetControlId] = useState<string | null>(null)
  const [targetFilter, setTargetFilter] = useState<"Passing" | "Failing" | "Awaiting Approval" | "All" | null>(null)
  
  // NEW: Onboarding State
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)

  const meta = VIEW_META[view]

  useEffect(() => {
    const savedRole = localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role") || "Contributor"
    setRole(savedRole)

    // Check if the wizard needs to be run
    const hasCompletedOnboarding = localStorage.getItem("grc_onboarding_complete")
    if (!hasCompletedOnboarding && savedRole === "Admin") {
      setShowOnboarding(true)
    }
    
    setIsInitializing(false)
  }, [])

  function navigate(next: NavView) {
    setView(next)
    setMobileOpen(false)
  }

  function handleDashboardControlClick(controlId: string) {
    setTargetControlId(controlId)
    navigate("frameworks")
  }

  function handleDashboardStatusClick(status: "Passing" | "Failing" | "Awaiting Approval" | "All") {
    setTargetFilter(status)
    navigate("frameworks")
  }

  function completeOnboarding() {
    localStorage.setItem("grc_onboarding_complete", "true")
    setShowOnboarding(false)
    navigate("dashboard") // Route them to the dashboard to see their shiny new appliance
  }

  if (isInitializing) return null

  return (
    <OrganizationProvider>
      <NotificationsProvider>
        {showOnboarding ? (
          <OnboardingWizard onComplete={completeOnboarding} />
        ) : (
          <div className="flex min-h-screen bg-muted/40">
            {/* Desktop sidebar */}
            <aside
              className={`fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border transition-transform duration-300 ease-in-out lg:block ${
                sidebarHidden ? "-translate-x-full" : "translate-x-0"
              }`}
              aria-hidden={sidebarHidden}
            >
              <SidebarContent active={view} role={role} onNavigate={navigate} onLogout={onLogout} />
            </aside>

            {/* Main column */}
            <div
              className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-300 ease-in-out ${
                sidebarHidden ? "lg:pl-0" : "lg:pl-64"
              }`}
            >
              {/* Top bar */}
              <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
                <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                  <SheetTrigger
                    render={
                      <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open navigation" />
                    }
                  >
                    <Menu className="size-5" aria-hidden />
                  </SheetTrigger>
                  <SheetContent side="left" className="w-64 p-0">
                    <SheetTitle className="sr-only">Navigation</SheetTitle>
                    <SidebarContent active={view} role={role} onNavigate={navigate} onLogout={onLogout} />
                  </SheetContent>
                </Sheet>

                <Button
                  variant="outline"
                  size="icon"
                  className="hidden lg:inline-flex"
                  aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
                  aria-pressed={!sidebarHidden}
                  onClick={() => setSidebarHidden((h) => !h)}
                >
                  {sidebarHidden ? (
                    <PanelLeftOpen className="size-5" aria-hidden />
                  ) : (
                    <PanelLeftClose className="size-5" aria-hidden />
                  )}
                </Button>

                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold text-foreground text-balance sm:text-lg">
                    {meta.title}
                  </h1>
                  <p className="hidden truncate text-sm text-muted-foreground sm:block">{meta.subtitle}</p>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <NotificationBell onNotificationClick={handleDashboardControlClick} />
                </div>
              </header>

              {/* Content */}
              <main className="flex-1 p-4 sm:p-6 lg:p-8">
                <div className="mx-auto w-full max-w-6xl">
                  {view === "frameworks" && (
                    <FrameworksView 
                      targetControlId={targetControlId}
                      onClearTarget={() => setTargetControlId(null)}
                      targetFilter={targetFilter}
                      onClearFilter={() => setTargetFilter(null)}
                    />
                  )}
                  {view === "dashboard" && (
                    <MetricsDashboard 
                      onControlClick={handleDashboardControlClick} 
                      onStatusClick={handleDashboardStatusClick}
                    />
                  )}
                  {view === "risks" && <RiskRegister />}
                  {view === "users" && <UserManagement />}
                  {view === "audit" && <AuditLogs />}
                  {view === "settings" && <WorkspaceSettings />}
                </div>
              </main>
            </div>
          </div>
        )}
      </NotificationsProvider>
    </OrganizationProvider>
  )
}