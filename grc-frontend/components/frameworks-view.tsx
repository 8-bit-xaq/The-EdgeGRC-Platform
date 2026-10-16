"use client"

/**
 * @fileoverview Frameworks & Controls parent view component.
 *
 * Coordinates framework ingestion and control browsing:
 * - Automatically renders the FrameworkUploader when the database has zero controls.
 * - Collapses the importer once controls exist, maintaining an on-demand modal trigger for Admins.
 * - Bridges deep-linked control IDs and status filters from the Metrics Dashboard to the Controls Table.
 */

import { useEffect, useState } from "react"
import { Plus, X, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FrameworkUploader } from "@/components/framework-uploader"
import { ControlsTable } from "@/components/controls-table"
import { fetchApi } from "@/lib/api"

interface FrameworksViewProps {
  targetControlId?: string | null
  onClearTarget?: () => void
  targetFilter?: "Passing" | "Failing" | "Awaiting Approval" | "All" | null
  onClearFilter?: () => void
}

export function FrameworksView({ targetControlId, onClearTarget, targetFilter, onClearFilter }: FrameworksViewProps) {
  const [importOpen, setImportOpen] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    // 1. Get role from storage
    const savedRole = localStorage.getItem("grc_role") || sessionStorage.getItem("grc_role");
    setRole(savedRole);

    // 2. Fetch controls to decide if we should show the importer
    fetchApi("controls/")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch API")
        return res.json()
      })
      .then((data) => {
        const hasControls = Array.isArray(data) && data.length > 0;
        
        // 3. Only auto-minimize if we actually have controls
        if (hasControls) {
          setImportOpen(false);
        } else {
          setImportOpen(true);
        }
      })
      .catch((err) => {
        console.error("Error fetching controls:", err);
        // Fallback: Show importer if API fails so the user isn't locked out
        setImportOpen(true);
      });
  }, []);

  const isAdmin = role === "Admin"

  return (
    <div className="space-y-6">
      {/* Only render the upload/import sections if the user is an Admin */}
      {isAdmin && (
        importOpen ? (
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-card-foreground text-balance">
                  Import Framework
                </h2>
                <p className="text-sm text-muted-foreground text-pretty">
                  Upload a JSON framework file to parse its controls into the matrix below.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setImportOpen(false)}
                aria-label="Close importer"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            <FrameworkUploader 
              onImported={(count, fileName) => {
                setRefreshKey(prev => prev + 1);
                setTimeout(() => setImportOpen(false), 2000);
              }} 
            />
          </section>
        ) : (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <UploadCloud className="size-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-card-foreground">Framework loaded</p>
                <p className="text-sm text-muted-foreground text-pretty">
                  Import another JSON framework to add more controls to the matrix.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => setImportOpen(true)}
            >
              <Plus className="size-4" aria-hidden />
              Import framework
            </Button>
          </section>
        )
      )}

      {/* Everyone can see the controls matrix */}
      <ControlsTable 
        key={refreshKey} 
        targetControlId={targetControlId}
        onClearTarget={onClearTarget}
        targetFilter={targetFilter}
        onClearFilter={onClearFilter}
      />
    </div>
  )
}