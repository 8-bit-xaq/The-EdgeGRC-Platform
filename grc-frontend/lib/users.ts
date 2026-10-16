/**
 * @fileoverview User management types, constants, and helper utilities.
 * 
 * Defines the core role-based access control (RBAC) roles ("Admin", "Auditor",
 * "Contributor", "Reviewer", "Executive"), user status types, and the interfaces
 * for both frontend state representations (`ManagedUser`) and backend API payloads
 * (`RawApiUser`).
 */

export type UserRole = "Admin" | "Auditor" | "Contributor" | "Reviewer" | "Executive"
export type UserStatus = "Active" | "Inactive"

/**
 * Representation of a user in the frontend state and UI tables.
 */
export interface ManagedUser {
  id: string
  name: string
  username: string
  role: UserRole
  status: UserStatus
  notify_schedules?: boolean
}

/**
 * Raw user model returned from the backend Django REST API (`/api/users/`).
 */
export interface RawApiUser {
  id: number | string
  username: string
  first_name?: string
  last_name?: string
  email?: string
  role?: string
  is_active?: boolean
  must_change_password?: boolean
  avatar?: string
  notify_assessments?: boolean
  notify_tasks?: boolean
  notify_schedules?: boolean
}

export const USER_ROLES: UserRole[] = ["Admin", "Auditor", "Contributor", "Reviewer", "Executive"]
export const USER_STATUSES: UserStatus[] = ["Active", "Inactive"]

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  Admin: "Full access to settings, users, and all compliance data.",
  Auditor: "Read-only access to evidence and audit trails.",
  Contributor: "Can update controls and attach evidence.",
  Reviewer: "Can review evidence and approve controls as Passing.",
  Executive: "Read-only access to dashboards and reports.",
}

// Seed team members for the Admin Console. In production this would come from
// an API; the shape mirrors what the backend would return.
export const INITIAL_USERS: ManagedUser[] = [

]

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}
