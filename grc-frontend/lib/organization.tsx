"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { fetchApi } from "@/lib/api"

export interface Organization {
  companyName: string
  domain: string
  workspaceName: string
  logoDataUrl: string | null
}

export const DEFAULT_ORGANIZATION: Organization = {
  companyName: "Edge GRC",
  domain: "edgegrc.com",
  workspaceName: "The Edge GRC Platform",
  logoDataUrl: null,
}

interface OrganizationContextValue {
  organization: Organization
  updateOrganization: (patch: Partial<Organization>) => void
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null)

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const [organization, setOrganization] = useState<Organization>(DEFAULT_ORGANIZATION)

  // Fetch the global settings from the database on mount
  useEffect(() => {
    fetchApi("organization/")
      .then(res => {
        if (res.ok) return res.json()
        throw new Error("Failed to fetch organization settings")
      })
      .then(data => {
        setOrganization({
          companyName: data.company_name || DEFAULT_ORGANIZATION.companyName,
          workspaceName: data.workspace_name || DEFAULT_ORGANIZATION.workspaceName,
          logoDataUrl: data.logo_data_url || null,
          domain: DEFAULT_ORGANIZATION.domain, 
        })
      })
      .catch(err => console.error(err))
  }, [])

  // Save to backend whenever the Admin updates the settings
  const updateOrganization = useCallback((patch: Partial<Organization>) => {
    setOrganization((prev) => {
      const next = { ...prev, ...patch }
      
      fetchApi("organization/", {
        method: "PUT",
        body: JSON.stringify({
          company_name: next.companyName,
          workspace_name: next.workspaceName,
          logo_data_url: next.logoDataUrl
        })
      }).catch(err => console.error("Failed to sync organization settings", err))
      
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ organization, updateOrganization }),
    [organization, updateOrganization],
  )

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}

export function useOrganization() {
  const ctx = useContext(OrganizationContext)
  if (!ctx) {
    throw new Error("useOrganization must be used within an OrganizationProvider")
  }
  return ctx
}