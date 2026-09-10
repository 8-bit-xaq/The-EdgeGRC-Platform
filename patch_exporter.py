with open("grc-frontend/components/third-party-audit-exporter.tsx", "r") as f:
    content = f.read()

poll_logic = """
      let blob;
      if (format === "zip" || format === "pdf") {
        const data = await res.json()
        if (data.task_id) {
          // Poll for task completion
          let isComplete = false
          let taskStatus = null
          while (!isComplete) {
            await new Promise(r => setTimeout(r, 2000))
            const statusRes = await fetchApi(`jobs/${data.task_id}/status/`)
            if (statusRes.ok) {
              taskStatus = await statusRes.json()
              if (taskStatus.status === "SUCCESS") {
                isComplete = true
                const downloadRes = await fetchApi(`jobs/${data.task_id}/download/`)
                if (downloadRes.ok) {
                  blob = await downloadRes.blob()
                  const extension = format === "zip" ? "zip" : "pdf"
                  setDownloadFilename(`audit-package-${Date.now()}.${extension}`)
                } else {
                  throw new Error("Failed to download result file.")
                }
              } else if (taskStatus.status === "FAILED") {
                throw new Error("Background task failed: " + taskStatus.error)
              }
            }
          }
        } else {
          throw new Error("No task_id returned for async export")
        }
      } else {
"""

old_logic = """
      let blob;
      if (format === "zip" || format === "pdf") {
        blob = await res.blob()
        const extension = format === "zip" ? "zip" : "pdf"
        setDownloadFilename(`audit-package-${Date.now()}.${extension}`)
      } else {
"""

content = content.replace(old_logic.strip(), poll_logic.strip())

with open("grc-frontend/components/third-party-audit-exporter.tsx", "w") as f:
    f.write(content)
