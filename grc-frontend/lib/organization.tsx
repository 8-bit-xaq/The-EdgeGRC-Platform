"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

export interface Organization {
  companyName: string
  domain: string
  workspaceName: string
  /** Base64 data URL for an uploaded company logo, or null to use the default mark. */
  logoDataUrl: string | null
}

export const DEFAULT_ORGANIZATION: Organization = {
  companyName: "ByteTex",
  domain: "bytetex.com",
  workspaceName: "Compliance Solutions",
  logoDataUrl: null,
}

interface OrganizationContextValue {
  organization: Organization
  /** Merge a partial update into the current organization record. */
  updateOrganization: (patch: Partial<Organization>) => void
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null)

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const [organization, setOrganization] = useState<Organization>(DEFAULT_ORGANIZATION)

  // NEW: Load the saved organization settings on initial mount
  useEffect(() => {
    const stored = localStorage.getItem("grc_organization")
    if (stored) {
      try {
        setOrganization(JSON.parse(stored))
      } catch (e) {
        console.error("Failed to parse stored organization data")
      }
    }
  }, [])

  // NEW: Save to local storage whenever settings are updated
  const updateOrganization = useCallback((patch: Partial<Organization>) => {
    setOrganization((prev) => {
      const next = { ...prev, ...patch }
      localStorage.setItem("grc_organization", JSON.stringify(next))
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