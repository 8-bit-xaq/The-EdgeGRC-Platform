/**
 * @fileoverview Risk register types and risk scoring heuristics.
 *
 * Provides interfaces for enterprise risk definitions (`RiskItem`) and risk
 * level qualitative thresholds (Critical >= 15, High >= 10, Medium >= 5, Low < 5).
 */

import { ComplianceControl } from "./controls"

/**
 * Representation of an enterprise or compliance risk item.
 */
export interface RiskItem {
  id: number
  risk_id: string
  title: string
  description?: string
  attachment_name?: string | null
  attachment_url?: string | null
  inherent_likelihood: number
  inherent_impact: number
  inherent_score: number
  residual_score: number
  mitigating_controls_detail?: ComplianceControl[]
  mitigating_control_ids?: string[]
}

/**
 * Maps a numeric risk score (likelihood × impact, scale 1-25) to qualitative styling and labels.
 */
export function getRiskLevel(score: number): { label: string; color: string; badge: string } {
  if (score >= 15) {
    return { label: "Critical", color: "#ef4444", badge: "bg-destructive/15 text-destructive border-destructive/20" }
  }
  if (score >= 10) {
    return { label: "High", color: "#f97316", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20" }
  }
  if (score >= 5) {
    return { label: "Medium", color: "#eab308", badge: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" }
  }
  return { label: "Low", color: "#22c55e", badge: "bg-success/15 text-success border-success/20" }
}