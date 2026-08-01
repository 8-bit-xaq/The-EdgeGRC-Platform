"use client"

import { useEffect, useState } from "react"
import { ShieldCheck, UserCog } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UserProfileSettings } from "@/components/user-profile-settings"
import { AdminConsole } from "@/components/admin-console"

export function UserManagement() {
  const [tab, setTab] = useState("profile")
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    // Safely fetch the role on the client side after mounting
    const savedRole = localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role")
    setRole(savedRole)
  }, [])

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="gap-6">
      <TabsList className="h-9">
        <TabsTrigger value="profile" className="gap-1.5">
          <UserCog className="size-4" aria-hidden />
          User Profile
        </TabsTrigger>
        
        {/* Only show the Admin trigger if the user is an Admin */}
        {role === "Admin" && (
          <TabsTrigger value="admin" className="gap-1.5">
            <ShieldCheck className="size-4" aria-hidden />
            Admin Console
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="profile">
        <UserProfileSettings />
      </TabsContent>

      {/* Only render the Admin Console content if the user is an Admin */}
      {role === "Admin" && (
        <TabsContent value="admin">
          <AdminConsole />
        </TabsContent>
      )}
    </Tabs>
  )
}