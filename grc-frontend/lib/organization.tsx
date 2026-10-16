"use client"

/**
 * @fileoverview Organization Context & Branding Synchronization.
 * Provides global state management for company name, workspace title, and logo.
 * - Hydrates instantly on mount from local browser cache (`localStorage`) to avoid visual flicker.
 * - Fetches authoritative server settings from `/api/organization` asynchronously.
 * - Automatically synchronizes dynamic tab favicon and document title with the company logo.
 */

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
  const [organization, setOrganization] = useState<Organization>(() => {
    if (typeof window !== "undefined") {
      try {
        const cachedLogo = localStorage.getItem("grc_org_logo")
        const cachedName = localStorage.getItem("grc_org_name")
        const cachedWorkspace = localStorage.getItem("grc_workspace_name")
        if (cachedLogo || cachedName) {
          return {
            companyName: cachedName || DEFAULT_ORGANIZATION.companyName,
            workspaceName: cachedWorkspace || DEFAULT_ORGANIZATION.workspaceName,
            logoDataUrl: cachedLogo || null,
            domain: DEFAULT_ORGANIZATION.domain,
          }
        }
      } catch (e) {}
    }
    return DEFAULT_ORGANIZATION
  })

  // Fetch the global settings from the database on mount
  useEffect(() => {
    fetchApi("organization")
      .then(res => {
        if (res.ok) return res.json()
        return null
      })
      .then(data => {
        if (!data) return
        if (typeof window !== "undefined") {
          try {
            if (data.logo_data_url) {
              localStorage.setItem("grc_org_logo", data.logo_data_url)
            } else {
              localStorage.removeItem("grc_org_logo")
            }
            if (data.company_name) {
              localStorage.setItem("grc_org_name", data.company_name)
            }
            if (data.workspace_name) {
              localStorage.setItem("grc_workspace_name", data.workspace_name)
            }
          } catch (e) {}
        }
        setOrganization({
          companyName: data.company_name || DEFAULT_ORGANIZATION.companyName,
          workspaceName: data.workspace_name || DEFAULT_ORGANIZATION.workspaceName,
          logoDataUrl: data.logo_data_url || null,
          domain: DEFAULT_ORGANIZATION.domain, 
        })
      })
      .catch(err => console.error(err))
  }, [])

  // Synchronize browser tab favicon and title dynamically with organization branding
  useEffect(() => {
    if (typeof window === "undefined") return

    const faviconUrl = organization.logoDataUrl || "/api/organization/favicon"

    // Remove existing favicon links to force browser cache reset and re-evaluation
    const existingIcons = document.querySelectorAll<HTMLLinkElement>(
      "link[rel*='icon'], link[rel='apple-touch-icon']"
    )
    existingIcons.forEach((el) => el.parentNode?.removeChild(el))

    // Create fresh link elements
    const link = document.createElement("link")
    link.rel = "icon"
    link.href = faviconUrl
    if (organization.logoDataUrl?.startsWith("data:image/svg")) {
      link.type = "image/svg+xml"
    } else if (organization.logoDataUrl?.startsWith("data:image/png")) {
      link.type = "image/png"
    } else if (organization.logoDataUrl?.startsWith("data:image/jpeg")) {
      link.type = "image/jpeg"
    }
    document.head.appendChild(link)

    const appleLink = document.createElement("link")
    appleLink.rel = "apple-touch-icon"
    appleLink.href = faviconUrl
    document.head.appendChild(appleLink)

    if (organization.companyName && organization.companyName !== DEFAULT_ORGANIZATION.companyName) {
      document.title = `${organization.companyName} | Edge GRC`
    }
  }, [organization.logoDataUrl, organization.companyName])

  // Save to backend whenever the Admin updates the settings
  const updateOrganization = useCallback((patch: Partial<Organization>) => {
    setOrganization((prev) => {
      const next = { ...prev, ...patch }
      
      if (typeof window !== "undefined") {
        try {
          if (next.logoDataUrl) {
            localStorage.setItem("grc_org_logo", next.logoDataUrl)
          } else {
            localStorage.removeItem("grc_org_logo")
          }
          if (next.companyName) {
            localStorage.setItem("grc_org_name", next.companyName)
          }
          if (next.workspaceName) {
            localStorage.setItem("grc_workspace_name", next.workspaceName)
          }
        } catch (e) {}
      }

      fetchApi("organization", {
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