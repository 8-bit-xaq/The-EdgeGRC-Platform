"use client"

/**
 * @fileoverview Plan of Action and Milestones (POA&M) remediation tracker component.
 *
 * Enables creating, tracking, and completing corrective action items for deficient
 * controls via `/api/tasks/`. Enforces role-based permissions to ensure read-only
 * viewers (Auditors, Executives) cannot modify remediation milestones.
 */

import { useEffect, useState } from "react"
import { Check, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { fetchApi } from "@/lib/api"
import { type ComplianceControl, type RemediationTask } from "@/lib/controls"

interface PoamTabProps {
  control: ComplianceControl
  role: string | null
}

export function PoamTab({ control, role }: PoamTabProps) {
  const isAdmin = role === "Admin"
  const isAuditor = role === "Auditor"
  const isExecutive = role === "Executive"

  const [tasks, setTasks] = useState<RemediationTask[]>([])
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [newTaskDesc, setNewTaskDesc] = useState("")
  const [isTaskSubmitting, setIsTaskSubmitting] = useState(false)

  useEffect(() => {
    setTasks(control.remediation_tasks ?? [])
    setNewTaskTitle("")
    setNewTaskDesc("")
  }, [control])

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTaskTitle.trim()) return
    setIsTaskSubmitting(true)
    
    try {
      const res = await fetchApi("tasks/", {
        method: "POST",
        body: JSON.stringify({
          control: control.id,
          title: newTaskTitle,
          description: newTaskDesc,
          status: "Open"
        })
      })
      if (res.ok) {
        const newTask = await res.json()
        setTasks([newTask, ...tasks])
        setNewTaskTitle("")
        setNewTaskDesc("")
        toast.success("Task added to POA&M")
      } else {
        toast.error("Failed to create task")
      }
    } catch (err) {
      toast.error("Network error while creating task.")
    } finally {
      setIsTaskSubmitting(false)
    }
  }

  async function handleResolveTask(taskId: number) {
    try {
      const res = await fetchApi(`tasks/${taskId}/`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Resolved" })
      })
      if (res.ok) {
        setTasks(tasks.map(t => t.id === taskId ? { ...t, status: "Resolved" as const } : t))
        toast.success("Task resolved")
      } else {
        toast.error("Failed to update task status.")
      }
    } catch (err) {
      toast.error("Network error while resolving task.")
    }
  }

  async function handleDeleteTask(taskId: number) {
    try {
      const res = await fetchApi(`tasks/${taskId}/`, {
        method: "DELETE",
      })
      if (res.ok) {
        setTasks(tasks.filter(t => t.id !== taskId))
        toast.success("Task deleted")
      } else {
        toast.error("Failed to delete task")
      }
    } catch (err) {
      toast.error("Network error while deleting task.")
    }
  }

  return (
    <div className="flex flex-col gap-6 outline-none">
      <div className="flex flex-col gap-4">
        {tasks.length === 0 ? (
          <div className="py-10 text-center bg-card border border-border rounded-lg border-dashed">
            <p className="text-sm text-muted-foreground">No remediation tasks currently mapped.</p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {tasks.map(task => (
              <li key={task.id} className="p-4 border border-border rounded-lg bg-card shadow-sm flex flex-col gap-2">
                <div className="flex justify-between items-start gap-2">
                  <h4 className="font-semibold text-sm leading-tight text-foreground">{task.title}</h4>
                  <Badge variant="outline" className={task.status === 'Resolved' ? 'bg-success/15 text-success' : 'bg-amber-500/15 text-amber-500'}>
                    {task.status}
                  </Badge>
                </div>
                {task.description && (
                  <p className="text-xs text-muted-foreground text-pretty">{task.description}</p>
                )}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                   <span className="text-[10px] text-muted-foreground">
                     Requested by <span className="font-medium text-foreground">{task.requested_by_username || "System"}</span> on {new Date(task.created_at).toLocaleDateString()}
                   </span>
                   <div className="flex gap-2">
                     {isAdmin && (
                       <Button variant="ghost" size="xs" onClick={() => handleDeleteTask(task.id)} className="h-7 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive">
                         <Trash2 className="size-3 mr-1.5" />
                         Delete
                       </Button>
                     )}
                     {task.status !== "Resolved" && !isAuditor && !isExecutive && (
                       <Button variant="secondary" size="xs" onClick={() => handleResolveTask(task.id)} className="h-7 text-[11px] gap-1.5">
                         <Check className="size-3" />
                         Mark Resolved
                       </Button>
                     )}
                   </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!isAuditor && !isExecutive && (
        <div className="rounded-lg border border-border bg-card shadow-sm p-4">
          <h4 className="text-sm font-semibold mb-3">Add Remediation Task</h4>
          <form onSubmit={handleCreateTask} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="task-title" className="text-xs">Task Objective</Label>
              <Input 
                id="task-title"
                placeholder="e.g. Implement MFA on DB" 
                value={newTaskTitle} 
                onChange={e => setNewTaskTitle(e.target.value)} 
                disabled={isTaskSubmitting}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="task-desc" className="text-xs">Technical Details</Label>
              <Textarea 
                id="task-desc"
                placeholder="Describe the steps, scripts, or policy updates required to fix this weakness..." 
                value={newTaskDesc} 
                onChange={e => setNewTaskDesc(e.target.value)} 
                rows={3} 
                className="resize-none" 
                disabled={isTaskSubmitting}
              />
            </div>
            <Button type="submit" disabled={!newTaskTitle.trim() || isTaskSubmitting} className="w-full sm:w-auto sm:justify-self-end mt-1">
              {isTaskSubmitting ? "Creating..." : "Create Task"}
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}