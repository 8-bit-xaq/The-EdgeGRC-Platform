export type ControlStatus = "Passing" | "Failing" | "Not Evaluated" | "Ready for Audit" | "Awaiting Approval" | "Not Applicable"
export const CONTROL_STATUSES: ControlStatus[] = ["Passing", "Failing", "Not Evaluated", "Ready for Audit", "Awaiting Approval", "Not Applicable"]

export type EffectivenessStatus = "Effective" | "Deficient" | "Not Tested"
export const EFFECTIVENESS_STATUSES: EffectivenessStatus[] = ["Effective", "Deficient", "Not Tested"]

export type TestMethodology = "Interview" | "Observation" | "Inspection" | "Re-performance"
export const TEST_METHODOLOGIES: TestMethodology[] = ["Interview", "Observation", "Inspection", "Re-performance"]

export type AssessmentStatus = "Planned" | "In Progress" | "In QA Review" | "Completed"

// --- NEW: Scheduling Types ---
export type TestingFrequency = "None" | "Monthly" | "Quarterly" | "Bi-Annual" | "Annual"
export const TESTING_FREQUENCIES: TestingFrequency[] = ["None", "Monthly", "Quarterly", "Bi-Annual", "Annual"]

export interface ProofFile {
  id: string | number
  name: string
  size: number
  type: string
  url?: string
  file?: File
}

export interface RemediationTask {
  id: number
  control: string
  title: string
  description: string
  assigned_to?: number
  assigned_to_username?: string
  requested_by?: number
  requested_by_username?: string
  due_date?: string
  status: "Open" | "In Progress" | "Resolved"
  created_at: string
  updated_at: string
}

// Inside lib/controls.ts
export interface TestPlan {
  id: number
  test_methodology: TestMethodology[]
  test_steps?: string
  expected_evidence?: string
  attachment?: string
  attachment_name?: string
  attachment_url?: string
  updated_at: string
}

export interface AssessmentActivity {
  id: number
  assessor?: number
  assessor_username?: string
  status: AssessmentStatus
  design_effectiveness: EffectivenessStatus
  operating_effectiveness: EffectivenessStatus
  auditor_notes?: string
  date_started: string
  date_completed?: string
}

export interface ComplianceControl {
  id: string
  control_id: string
  requirement_title?: string
  process_mechanism?: string
  description: string
  status: ControlStatus
  control_effectiveness: EffectivenessStatus
  implementation_effectiveness: EffectivenessStatus
  evidence?: string
  tags?: string[]
  cross_walked_control_ids?: string[]
  mitigated_risk_ids?: string[]
  proofs?: ProofFile[]
  remediation_tasks?: RemediationTask[]
  test_plan?: TestPlan
  assessments?: AssessmentActivity[]
  
  // --- NEW ---
  testing_frequency?: TestingFrequency
  next_audit_date?: string | null
}