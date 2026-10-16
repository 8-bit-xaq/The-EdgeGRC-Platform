"use client"

/**
 * @fileoverview Framework ingestion component for importing cybersecurity and compliance frameworks.
 *
 * Accepts JSON schema uploads (e.g. SOC 2, NIST CSF, PCI-DSS, ISO 27001), flattens
 * nested requirement/sub-requirement structures, normalizes control attributes,
 * and bulk-persists controls to the Django backend (`/api/controls/`).
 */

import type React from "react"
import { useCallback, useRef, useState } from "react"
import { CheckCircle2, FileJson, FileWarning, RotateCcw, UploadCloud, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fetchApi } from "@/lib/api"
import { cn } from "@/lib/utils"

type UploadStatus = "idle" | "ready" | "processing" | "success" | "error"

const MAX_SIZE_MB = 10

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Recursively extracts and flattens controls or sub-requirements from various JSON schemas.
 * Supports direct arrays, requirement objects with nested sub-requirements,
 * or top-level keys like `controls`, `requirements`, `items`, or `policies`.
 */
function extractControls(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    if (Array.isArray(data.requirements)) {
      const flattened: any[] = [];
      data.requirements.forEach((req: any) => {
        if (Array.isArray(req.sub_requirements)) {
          req.sub_requirements.forEach((sub: any) => {
            flattened.push({
              ...sub,
              requirement_title: req.requirement_title,
              process_mechanism: req.processes_and_mechanisms
            });
          });
        }
      });
      return flattened;
    }
    for (const key of ["controls", "requirements", "items", "policies"]) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

/**
 * Resolves the framework identifier from JSON metadata fields or falls back to
 * a sanitized variant of the uploaded file's basename.
 */
function extractFrameworkName(data: any, fileName: string): string {
  if (data && typeof data === "object") {
    if (typeof data.framework === "string" && data.framework.trim()) return data.framework.trim();
    if (typeof data.framework_name === "string" && data.framework_name.trim()) return data.framework_name.trim();
    if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
    if (typeof data.name === "string" && data.name.trim()) return data.name.trim();
  }
  const clean = fileName.replace(/\.json$/i, "").replace(/[-_]/g, " ").trim();
  return clean || "General Framework";
}

/**
 * Normalizes an arbitrary control object into the standard backend payload structure.
 */
function normalizeControl(item: any, index: number, frameworkName: string) {
  const rawId = item.id || item.control_id || item.identifier || `CTRL-${index + 1}`;
  let parsedTags: string[] = [];
  if (Array.isArray(item.tags)) {
    parsedTags = item.tags;
  } else if (typeof item.tags === "string") {
    parsedTags = item.tags.split(",").map((t: string) => t.trim());
  }
  return {
    control_id: String(rawId),
    framework: frameworkName,
    requirement_title: item.requirement_title || "",
    process_mechanism: item.process_mechanism || "",
    description: item.description || item.title || item.name || JSON.stringify(item),
    status: "Not Evaluated",
    tags: parsedTags
  }
}

interface FrameworkUploaderProps {
  onImported?: (controlCount: number, fileName: string) => void
}

export function FrameworkUploader({ onImported }: FrameworkUploaderProps) {
  const [status, setStatus] = useState<UploadStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [controlCount, setControlCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState("")

  const inputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setStatus("idle")
    setProgress(0)
    setFile(null)
    setControlCount(0)
    setErrorMessage("")
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const selectFile = useCallback((selected: File) => {
    setErrorMessage("")
    const isJson = selected.type === "application/json" || selected.name.toLowerCase().endsWith(".json")
    if (!isJson) {
      setFile(null)
      setStatus("error")
      setErrorMessage("Unsupported file type. Please choose a .json framework file.")
      return
    }
    if (selected.size > MAX_SIZE_MB * 1024 * 1024) {
      setFile(null)
      setStatus("error")
      setErrorMessage(`File exceeds the ${MAX_SIZE_MB} MB limit.`)
      return
    }
    setFile(selected)
    setStatus("ready")
  }, [])

  const processFramework = useCallback(async () => {
    if (!file) return
    setStatus("processing")
    setProgress(15) 

    try {
      const fileContent = await file.text();
      const parsed = JSON.parse(fileContent);
      const rawControls = extractControls(parsed);

      if (rawControls.length === 0) {
        setStatus("error")
        setErrorMessage("No recognizable controls were found in this JSON file.")
        return
      }

      const frameworkName = extractFrameworkName(parsed, file.name);
      setProgress(45);
      const total = rawControls.length;
      const normalizedControls = rawControls.map((raw, idx) => normalizeControl(raw, idx, frameworkName));

      setProgress(75);

      const response = await fetchApi("controls/bulk-import/", {
        method: "POST",
        body: JSON.stringify({ framework: frameworkName, controls: normalizedControls }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || "Failed to import framework controls.");
      }

      setProgress(100);
      setControlCount(total);
      setStatus("success");
      onImported?.(total, file.name);

    } catch (error: any) {
      console.error(error);
      setStatus("error");
      setErrorMessage(error?.message || "The file could not be processed or uploaded.");
    }
  }, [file, onImported])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const dropped = e.dataTransfer.files?.[0]
      if (dropped) selectFile(dropped)
    },
    [selectFile],
  )

  const handleSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (selected) selectFile(selected)
    },
    [selectFile],
  )

  const isProcessing = status === "processing"
  const isBusy = isProcessing

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-success/30 bg-success/10 px-6 py-10 text-center" role="status" aria-live="polite">
        <div className="flex size-14 items-center justify-center rounded-full bg-success text-success-foreground">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-card-foreground">Framework imported successfully</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-success">{controlCount}</span>{" "}
            {controlCount === 1 ? "control" : "controls"} parsed from{" "}
            <span className="font-medium text-card-foreground">{file?.name}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reset} className="mt-1">
          <RotateCcw className="size-4" aria-hidden="true" />
          Import another framework
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!isBusy) setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={isBusy ? undefined : handleDrop}
        onClick={() => !isBusy && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !isBusy) { e.preventDefault(); inputRef.current?.click() } }}
        role="button"
        tabIndex={0}
        aria-label="Drag and drop a JSON framework file, or activate to browse"
        aria-disabled={isBusy}
        className={cn(
          "flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed px-6 py-12 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-accent/40",
          isBusy && "pointer-events-none opacity-60",
        )}
      >
        <div className={cn("flex size-16 items-center justify-center rounded-full transition-colors", isDragging ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
          <UploadCloud className="size-8" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-medium text-card-foreground">
            {isDragging ? "Drop to upload your framework" : <>Drag &amp; drop your JSON framework file here or <span className="font-semibold text-primary underline underline-offset-2">browse</span></>}
          </p>
          <p className="text-sm text-muted-foreground">JSON only, up to {MAX_SIZE_MB} MB</p>
        </div>
        <input ref={inputRef} type="file" accept="application/json,.json" className="sr-only" onChange={handleSelect} />
      </div>

      {status === "error" && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4" role="alert">
          <FileWarning className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="flex-1 space-y-0.5">
            <p className="text-sm font-medium text-card-foreground">Could not process file</p>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>Dismiss</Button>
        </div>
      )}

      {(status === "ready" || isProcessing) && file && (
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileJson className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-card-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            {!isProcessing && (
              <button type="button" onClick={reset} aria-label="Remove selected file" className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground">
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={isProcessing ? Math.round(progress) : 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-primary transition-all duration-200 ease-out" style={{ width: `${isProcessing ? progress : 0}%` }} />
            </div>
            <p className="mt-2 text-right text-xs font-medium text-muted-foreground">
              {isProcessing ? progress >= 100 ? "Parsing controls…" : `Processing… ${Math.round(progress)}%` : "Ready to process"}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={processFramework} disabled={status !== "ready"} className="min-w-44">
          <UploadCloud className="size-4" aria-hidden="true" />
          {isProcessing ? "Processing…" : "Process Framework"}
        </Button>
      </div>
    </div>
  )
}