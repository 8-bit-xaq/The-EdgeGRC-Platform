"use client"

/**
 * @fileoverview Metrics & Executive Compliance Dashboard component.
 *
 * Visualizes organizational posture via interactive Recharts:
 * - Real-time compliance health score (% Passing).
 * - Design and Operational effectiveness distributions (Donut charts).
 * - Comparative Inherent vs. Residual risk scores (Bar chart).
 * - Operational task queues (Open POA&Ms, Upcoming Audits, Approvals pending review).
 * - Interactive click-throughs allowing direct filtering into the Controls Table.
 */

import { useEffect, useMemo, useState } from "react"
import { Label, Pie, PieChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts"
import { ShieldCheck, TrendingUp, AlertTriangle, Loader2, Target, ListTodo, ClipboardCheck, ClipboardList, CalendarClock } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { type ComplianceControl, type RemediationTask } from "@/lib/controls"
import { type RiskItem, getRiskLevel } from "@/lib/risks"
import { cn } from "@/lib/utils"

// --- NEW: React Query Hooks ---
import { useControls, useRisks, useTasks } from "@/hooks/use-grc-data"

const chartConfig = {
  effective: { label: "Strong / Effective", color: "#22c55e" },
  deficient: { label: "Weak / Deficient", color: "#ef4444" },
  notTested: { label: "Not Yet Evaluated", color: "#94a3b8" },
  inherent: { label: "Inherent Risk", color: "#f87171" },
  residual: { label: "Residual Risk", color: "#3b82f6" }, 
} satisfies ChartConfig

interface MetricsDashboardProps {
  onControlClick?: (controlId: string) => void
  onStatusClick?: (status: "Passing" | "Failing" | "Awaiting Approval" | "All") => void
  onRiskClick: (riskId: string) => void
}

function DashboardPagination({ page, totalItems, onPageChange }: { page: number, totalItems: number, onPageChange: (p: number) => void }) {
  const pageSize = 5
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  
  if (totalPages <= 1) return null
  
  return (
    <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2.5 mt-auto">
      <span className="text-xs font-medium text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="xs"
          onClick={(e) => { e.stopPropagation(); onPageChange(page - 1) }}
          disabled={page === 1}
        >
          Prev
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={(e) => { e.stopPropagation(); onPageChange(page + 1) }}
          disabled={page === totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export function MetricsDashboard({ onControlClick, onStatusClick, onRiskClick }: MetricsDashboardProps) {
  // 1. Fetch data utilizing the shared React Query cache
  const { data: controls = [], isLoading: loadingControls } = useControls()
  const { data: risks = [], isLoading: loadingRisks } = useRisks()
  const { data: tasks = [], isLoading: loadingTasks } = useTasks()

  const isLoading = loadingControls || loadingRisks || loadingTasks

  const [role, setRole] = useState("Contributor")

  // Pagination States for each widget
  const [vulnPage, setVulnPage] = useState(1)
  const [auditInboxPage, setAuditInboxPage] = useState(1)
  const [qaInboxPage, setQaInboxPage] = useState(1)
  const [tasksPage, setTasksPage] = useState(1)
  const [failuresPage, setFailuresPage] = useState(1)
  const [upcomingPage, setUpcomingPage] = useState(1)

  useEffect(() => {
    const savedRole = localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role") || "Contributor"
    setRole(savedRole)
  }, [])

  // RBAC Visibility Flags
  const showRisk = role === "Admin" || role === "Executive"
  const showTopVulnerabilities = showRisk || role === "Reviewer"
  const showHealth = role === "Admin" || role === "Executive" || role === "Auditor"
  const showQA = role === "Admin" || role === "Reviewer"
  const showAuditInbox = role === "Admin" || role === "Auditor" || role === "Executive"

  const metrics = useMemo(() => {
    const total = controls.length
    const passing = controls.filter((c) => c.status === "Passing").length
    const notApplicable = controls.filter((c) => c.status === "Not Applicable").length
    
    const evaluatableTotal = total - notApplicable
    const score = evaluatableTotal === 0 ? 0 : Math.round((passing / evaluatableTotal) * 100)
    
    const designEffective = controls.filter((c) => c.control_effectiveness === "Effective").length
    const designDeficient = controls.filter((c) => c.control_effectiveness === "Deficient").length
    const designNotTested = controls.filter((c) => c.control_effectiveness === "Not Tested" || !c.control_effectiveness).length

    const operatingEffective = controls.filter((c) => c.implementation_effectiveness === "Effective").length
    const operatingDeficient = controls.filter((c) => c.implementation_effectiveness === "Deficient").length
    const operatingNotTested = controls.filter((c) => c.implementation_effectiveness === "Not Tested" || !c.implementation_effectiveness).length
    
    const recentFailures = controls.filter((c) => c.status === "Failing")

    const totalInherent = risks.reduce((acc, curr) => acc + curr.inherent_score, 0)
    const totalResidual = risks.reduce((acc, curr) => acc + curr.residual_score, 0)
    const riskMitigatedPercent = totalInherent === 0 ? 0 : Math.round(((totalInherent - totalResidual) / totalInherent) * 100)

    const topVulnerabilities = [...risks].sort((a, b) => b.residual_score - a.residual_score)
    
    const openTasks = tasks.filter(t => t.status !== "Resolved")

    const pendingQA = controls.flatMap((c) => 
      (c.assessments || [])
        .filter((a) => a.status === "In QA Review")
        .map((a) => ({ ...a, control_id: c.id }))
    ).sort((a, b) => new Date(b.date_started).getTime() - new Date(a.date_started).getTime())
    
    const readyForAudit = controls.filter((c) => c.status === "Ready for Audit")

    const upcomingAudits = controls
      .filter((c) => c.testing_frequency && c.testing_frequency !== "None" && c.next_audit_date)
      .sort((a, b) => new Date(a.next_audit_date!).getTime() - new Date(b.next_audit_date!).getTime())

    return { 
      total, passing, notApplicable, score, 
      designEffective, designDeficient, designNotTested,
      operatingEffective, operatingDeficient, operatingNotTested,
      recentFailures,
      totalInherent, totalResidual, riskMitigatedPercent, topVulnerabilities,
      openTasks, pendingQA, readyForAudit, upcomingAudits
    }
  }, [controls, risks, tasks])

  const designData = useMemo(() => [
    { key: "deficient", label: "Flawed Policy", value: metrics.designDeficient, fill: chartConfig.deficient.color },
    { key: "effective", label: "Sound Policy", value: metrics.designEffective, fill: chartConfig.effective.color },
    { key: "notTested", label: "Unassessed", value: metrics.designNotTested, fill: chartConfig.notTested.color },
  ].filter(d => d.value > 0), [metrics])

  const operatingData = useMemo(() => [
    { key: "deficient", label: "Execution Failure", value: metrics.operatingDeficient, fill: chartConfig.deficient.color },
    { key: "effective", label: "Consistently Followed", value: metrics.operatingEffective, fill: chartConfig.effective.color },
    { key: "notTested", label: "Unassessed", value: metrics.operatingNotTested, fill: chartConfig.notTested.color },
  ].filter(d => d.value > 0), [metrics])

  const roiData = useMemo(() => [
    { 
      name: "Risk Exposure", 
      inherent: metrics.totalInherent, 
      residual: metrics.totalResidual 
    }
  ], [metrics])

  if (isLoading) {
    return (
      <section className="flex w-full items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 size-6 animate-spin" aria-hidden />
        Loading dashboard metrics...
      </section>
    )
  }

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-balance">Executive Dashboard</h2>
        <p className="text-sm text-muted-foreground text-pretty">
          Real-time visibility into compliance health and active business risks.
        </p>
      </div>

      {/* Top Scores Row */}
      <div className={cn("grid gap-4", showRisk ? "md:grid-cols-2" : "grid-cols-1")}>
        <Card className="overflow-hidden border-success/20">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <ShieldCheck className="size-6" aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <CardDescription className="text-sm font-medium">Compliance Coverage</CardDescription>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-tight tabular-nums">{metrics.score}%</span>
                {metrics.total > 0 && (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
                    <TrendingUp className="size-4" aria-hidden />
                    {metrics.passing} / {metrics.total - metrics.notApplicable} Controls Passing
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {showRisk && (
          <Card className="overflow-hidden border-blue-500/20">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
                <Target className="size-6" aria-hidden />
              </div>
              <div className="flex flex-col gap-1">
                <CardDescription className="text-sm font-medium">Total Risk Mitigated</CardDescription>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-tight tabular-nums">{metrics.riskMitigatedPercent}%</span>
                  {risks.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-blue-500">
                      <TrendingUp className="size-4" aria-hidden />
                      {metrics.totalInherent - metrics.totalResidual} pts reduced
                    </span>
                  )}
                  </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Health & ROI Charts Row */}
      {(showHealth || showRisk) && (
        <div className={cn("grid gap-4", showHealth && showRisk ? "md:grid-cols-3" : showHealth ? "md:grid-cols-2" : "md:grid-cols-1")}>
          {showHealth && (
            <>
              <Card className="flex flex-col">
                <CardHeader className="items-center pb-0 text-center">
                  <CardTitle className="text-base">Design Health</CardTitle>
                  <CardDescription className="text-xs">Policy Documentation</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 pb-4">
                  <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[200px]">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie data={designData} dataKey="value" nameKey="label" innerRadius={55} strokeWidth={4}>
                        <Label
                          content={({ viewBox }) => {
                            if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                              return (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={viewBox.cx} y={viewBox.cy} className="fill-destructive text-2xl font-bold">
                                    {metrics.designDeficient}
                                  </tspan>
                                  <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 16} className="fill-muted-foreground text-[10px]">
                                    Flaws
                                  </tspan>
                                </text>
                              )
                            }
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="items-center pb-0 text-center">
                  <CardTitle className="text-base">Operational Health</CardTitle>
                  <CardDescription className="text-xs">Execution & Evidence</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 pb-4">
                  <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[200px]">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie data={operatingData} dataKey="value" nameKey="label" innerRadius={55} strokeWidth={4}>
                        <Label
                          content={({ viewBox }) => {
                            if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                              return (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={viewBox.cx} y={viewBox.cy} className="fill-destructive text-2xl font-bold">
                                    {metrics.operatingDeficient}
                                  </tspan>
                                  <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 16} className="fill-muted-foreground text-[10px]">
                                    Failures
                                  </tspan>
                                </text>
                              )
                            }
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </>
          )}

          {showRisk && (
            <Card className="flex flex-col">
              <CardHeader className="items-center pb-2 text-center">
                <CardTitle className="text-base">Control ROI</CardTitle>
                <CardDescription className="text-xs">Inherent vs. Residual Score</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 px-2 pb-4">
                <ChartContainer config={chartConfig} className="mx-auto w-full max-h-[190px] mt-4">
                  <BarChart data={roiData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" hide />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <ChartTooltip cursor={{ fill: "transparent" }} content={<ChartTooltipContent />} />
                    <Legend verticalAlign="bottom" height={20} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                    <Bar dataKey="inherent" fill="var(--color-inherent)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="residual" fill="var(--color-residual)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Risk Matrix Row */}
      {(showRisk || showTopVulnerabilities) && (
        <div className={cn("grid gap-4", showRisk && showTopVulnerabilities ? "md:grid-cols-2" : "grid-cols-1")}>
          {showRisk && (
            <Card>
            <CardHeader>
              <CardTitle className="text-base">Inherent Risk Matrix</CardTitle>
              <CardDescription className="text-xs">Current threat landscape before mitigations.</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center pb-6">
              <div className="flex gap-2 items-center">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  Likelihood
                </div>
                <div>
                  <div className="grid grid-cols-5 gap-1 bg-muted/20 p-1 border border-border rounded-md">
                    {[5, 4, 3, 2, 1].map((likelihood) => (
                      [1, 2, 3, 4, 5].map((impact) => {
                        const score = likelihood * impact;
                        const count = risks.filter(r => r.inherent_likelihood === likelihood && r.inherent_impact === impact).length;
                        
                        let bgColor = "bg-success/20 text-success-foreground"
                        if (score >= 15) bgColor = "bg-destructive text-destructive-foreground shadow-sm"
                        else if (score >= 10) bgColor = "bg-orange-500 text-white shadow-sm"
                        else if (score >= 5) bgColor = "bg-yellow-400 text-yellow-950"

                        return (
                          <div 
                            key={`${likelihood}-${impact}`} 
                            className={cn(
                              "flex items-center justify-center size-10 sm:size-12 rounded-sm text-sm font-bold transition-all",
                              bgColor,
                              count === 0 && "opacity-30 !bg-muted !text-transparent shadow-none"
                            )}
                            title={`Likelihood: ${likelihood}, Impact: ${impact} | Risks: ${count}`}
                          >
                            {count > 0 ? count : ""}
                          </div>
                        )
                      })
                    ))}
                  </div>
                  <div className="text-center mt-2 text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                    Impact
                  </div>
                </div>
              </div>
            </CardContent>
            </Card>
          )}

          {showTopVulnerabilities && (
          <Card className="flex flex-col">
            <CardHeader>
               <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="size-4 text-destructive" />
                  Top Vulnerabilities
               </CardTitle>
               <CardDescription className="text-xs">Highest remaining residual risks.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
               {metrics.topVulnerabilities.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No active risks mapped.</p>
               ) : (
                  <ul className="flex flex-col gap-3">
                     {metrics.topVulnerabilities.slice((vulnPage - 1) * 5, vulnPage * 5).map((risk) => {
                        const resLevel = getRiskLevel(risk.residual_score)
                        return (
                           <li key={risk.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                              <button
                                type="button"
                                onClick={() => onRiskClick(risk.risk_id)}
                                className="flex w-full items-center justify-between gap-3 rounded-md text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`View ${risk.title} in the Risk Register`}
                              >
                                <span className="min-w-0 pr-1">
                                   <span className="block truncate text-sm font-medium text-foreground">{risk.title}</span>
                                   <span className="mt-0.5 block text-xs font-mono text-muted-foreground">{risk.risk_id}</span>
                                </span>
                                <Badge variant="outline" className={cn("shrink-0 whitespace-nowrap", resLevel.badge)}>
                                   {resLevel.label} ({risk.residual_score})
                                </Badge>
                              </button>
                           </li>
                        )
                     })}
                  </ul>
               )}
            </CardContent>
            <DashboardPagination page={vulnPage} totalItems={metrics.topVulnerabilities.length} onPageChange={setVulnPage} />
          </Card>
          )}
        </div>
      )}

      {/* Action Inboxes Row */}
      <div className={cn("grid gap-4", 
        (showQA && showAuditInbox) ? "lg:grid-cols-3 md:grid-cols-2" : 
        (showQA || showAuditInbox) ? "md:grid-cols-2" : 
        "grid-cols-1"
      )}>
        
        {/* Audit Inbox (For Auditors / Admins / Executives) */}
        {showAuditInbox && (
          <Card className="flex flex-col">
            <CardHeader>
               <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="size-4 text-blue-500" />
                  Audit Inbox
               </CardTitle>
               <CardDescription className="text-xs">Controls submitted and ready for evaluation.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
               {metrics.readyForAudit.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No controls waiting for audit.</p>
               ) : (
                  <ul className="flex flex-col gap-3">
                     {metrics.readyForAudit.slice((auditInboxPage - 1) * 5, auditInboxPage * 5).map((c) => (
                       <li 
                         key={c.id} 
                         className="flex flex-col justify-center border-b border-border pb-3 last:border-0 last:pb-0 cursor-pointer hover:bg-muted/50 rounded-md p-2 -mx-2 transition-colors"
                         onClick={() => onControlClick?.(c.id)}
                       >
                         <div className="flex justify-between items-start gap-2">
                           <p className="text-sm font-medium text-foreground truncate">{c.id}</p>
                           <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-transparent dark:text-blue-400">
                             Ready for Audit
                           </Badge>
                         </div>
                         <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{c.description}</p>
                       </li>
                     ))}
                  </ul>
               )}
            </CardContent>
            <DashboardPagination page={auditInboxPage} totalItems={metrics.readyForAudit.length} onPageChange={setAuditInboxPage} />
          </Card>
        )}

        {/* Existing: QA Review Inbox (For Reviewers / Admins) */}
        {showQA && (
          <Card className="flex flex-col">
            <CardHeader>
               <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardCheck className="size-4 text-amber-500" />
                  QA Review Inbox
               </CardTitle>
               <CardDescription className="text-xs">Assessments pending reviewer sign-off.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
               {metrics.pendingQA.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No assessments pending QA review.</p>
               ) : (
                  <ul className="flex flex-col gap-3">
                     {metrics.pendingQA.slice((qaInboxPage - 1) * 5, qaInboxPage * 5).map((qa) => (
                       <li 
                         key={qa.id} 
                         className="flex flex-col justify-center border-b border-border pb-3 last:border-0 last:pb-0 cursor-pointer hover:bg-muted/50 rounded-md p-2 -mx-2 transition-colors"
                         onClick={() => onControlClick?.(qa.control_id)}
                       >
                         <div className="flex justify-between items-start gap-2">
                           <p className="text-sm font-medium text-foreground truncate">{qa.control_id} Assessment</p>
                           <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-transparent">
                             {qa.status}
                           </Badge>
                         </div>
                         <p className="text-xs text-muted-foreground font-mono mt-0.5">Assessor: {qa.assessor_username}</p>
                       </li>
                     ))}
                  </ul>
               )}
            </CardContent>
            <DashboardPagination page={qaInboxPage} totalItems={metrics.pendingQA.length} onPageChange={setQaInboxPage} />
          </Card>
        )}

        {/* Existing: Open Action Items (For Everyone) */}
        <Card className="flex flex-col">
          <CardHeader>
             <CardTitle className="text-base flex items-center gap-2">
                <ListTodo className="size-4 text-primary" />
                Open Action Items
             </CardTitle>
             <CardDescription className="text-xs">Your organization's pending POA&M tasks.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
             {metrics.openTasks.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No active remediation tasks right now.</p>
             ) : (
                <ul className="flex flex-col gap-3">
                   {metrics.openTasks.slice((tasksPage - 1) * 5, tasksPage * 5).map((task) => (
                     <li 
                       key={task.id} 
                       className="flex flex-col justify-center border-b border-border pb-3 last:border-0 last:pb-0 cursor-pointer hover:bg-muted/50 rounded-md p-2 -mx-2 transition-colors"
                       onClick={() => onControlClick?.(task.control)}
                     >
                       <div className="flex justify-between items-start gap-2">
                         <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                         <Badge variant="outline" className={cn(
                           "border-transparent",
                           task.status === "In Progress" ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"
                         )}>
                           {task.status}
                         </Badge>
                       </div>
                       <p className="text-xs text-muted-foreground font-mono mt-0.5">Target: {task.control}</p>
                     </li>
                   ))}
                </ul>
             )}
          </CardContent>
          <DashboardPagination page={tasksPage} totalItems={metrics.openTasks.length} onPageChange={setTasksPage} />
        </Card>
      </div>

      {/* Remediation Plan & Upcoming Audits Row */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="size-4 text-primary" aria-hidden />
                  Control Remediation Plan
                </CardTitle>
                <CardDescription className="text-xs">Controls exhibiting active weaknesses.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            {metrics.recentFailures.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No weaknesses or failing controls detected. Your framework is operating smoothly.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {metrics.recentFailures.slice((failuresPage - 1) * 5, failuresPage * 5).map((control) => (
                  <li 
                    key={control.id} 
                    onClick={() => onControlClick?.(control.id)}
                    className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0 cursor-pointer transition-colors hover:bg-muted/30 rounded-md px-2"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 rounded-md bg-destructive/10 px-2 py-1 font-mono text-xs font-medium text-destructive">
                        {control.id}
                      </span>
                      <p className="flex-1 text-sm text-pretty text-muted-foreground line-clamp-2">
                        {control.description}
                      </p>
                    </div>
                    <div className="ml-16 flex flex-wrap gap-2 text-[10px] uppercase font-semibold mt-1">
                       {control.control_effectiveness === "Deficient" && (
                         <span className="text-destructive bg-destructive/10 px-2 py-0.5 rounded border border-destructive/20">
                           Flawed Policy (Design Weakness)
                         </span>
                       )}
                       {control.implementation_effectiveness === "Deficient" && (
                         <span className="text-destructive bg-destructive/10 px-2 py-0.5 rounded border border-destructive/20">
                           Failed Execution (Operational Weakness)
                         </span>
                       )}
                       {control.control_effectiveness !== "Deficient" && control.implementation_effectiveness !== "Deficient" && (
                         <span className="text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                           General Control Failure
                         </span>
                       )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          <DashboardPagination page={failuresPage} totalItems={metrics.recentFailures.length} onPageChange={setFailuresPage} />
        </Card>

        {/* --- NEW: Upcoming Scheduled Audits Card --- */}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="size-4 text-purple-500" aria-hidden />
                  Upcoming Scheduled Audits
                </CardTitle>
                <CardDescription className="text-xs">Controls approaching their automated re-evaluation date.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            {metrics.upcomingAudits.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No scheduled audits are currently on the calendar.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {metrics.upcomingAudits.slice((upcomingPage - 1) * 5, upcomingPage * 5).map((control) => {
                  const auditDate = new Date(control.next_audit_date + "T12:00:00Z")
                  const reqDate = new Date(auditDate)
                  reqDate.setDate(reqDate.getDate() - 30)

                  return (
                    <li 
                      key={control.id} 
                      onClick={() => onControlClick?.(control.id)}
                      className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0 cursor-pointer transition-colors hover:bg-muted/30 rounded-md px-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded-md bg-purple-500/10 px-2 py-1 font-mono text-xs font-medium text-purple-600 dark:text-purple-400">
                            {control.id}
                          </span>
                          <Badge variant="outline" className="text-[10px] bg-background">
                            {control.testing_frequency}
                          </Badge>
                        </div>
                        <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                          Due: {auditDate.toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                         <span className="truncate">Evidence opens on {reqDate.toLocaleDateString()}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
          <DashboardPagination page={upcomingPage} totalItems={metrics.upcomingAudits.length} onPageChange={setUpcomingPage} />
        </Card>
      </div>
    </section>
  )
}