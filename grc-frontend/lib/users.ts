export type UserRole = "Admin" | "Auditor" | "Contributor" | "Reviewer" | "Executive"
export type UserStatus = "Active" | "Inactive"

export interface ManagedUser {
  id: string
  name: string
  username: string
  role: UserRole
  status: UserStatus
  notify_schedules?: boolean;
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
