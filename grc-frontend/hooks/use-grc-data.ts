/**
 * @fileoverview React Query hooks for GRC data caching and synchronized state management.
 *
 * Provides query hooks for controls (`useControls`), risks (`useRisks`),
 * and remediation tasks (`useTasks`) backed by TanStack Query.
 */

import { useQuery } from "@tanstack/react-query"
import { fetchApi } from "@/lib/api"
import type { ComplianceControl, RemediationTask } from "@/lib/controls"
import type { RiskItem } from "@/lib/risks"

export function useControls() {
  return useQuery<ComplianceControl[]>({
    queryKey: ["controls"],
    queryFn: async () => {
      const res = await fetchApi("controls/")
      if (!res.ok) throw new Error("Failed to fetch controls")
      const data = await res.json()
      // Normalize the ID field globally before caching
      return data.map((c: ComplianceControl) => ({ ...c, id: c.control_id }))
    },
  })
}

export function useRisks() {
  return useQuery<RiskItem[]>({
    queryKey: ["risks"],
    queryFn: async () => {
      const res = await fetchApi("risks/")
      if (!res.ok) throw new Error("Failed to fetch risks")
      return res.json()
    },
  })
}

export function useTasks() {
  return useQuery<RemediationTask[]>({
    queryKey: ["tasks"],
    queryFn: async () => {
      const res = await fetchApi("tasks/")
      if (!res.ok) throw new Error("Failed to fetch tasks")
      return res.json()
    },
  })
}