with open("grc-frontend/components/workspace-settings.tsx", "r") as f:
    content = f.read()

backup_poll_logic = """
  async function handleBackup() {
    setIsBackingUp(true)
    try {
      const res = await fetchApi("backup/")
      if (!res.ok) throw new Error("Backup request failed")
      
      const data = await res.json()
      if (data.task_id) {
        let isComplete = false
        while (!isComplete) {
          await new Promise(r => setTimeout(r, 2000))
          const statusRes = await fetchApi(`jobs/${data.task_id}/status/`)
          if (statusRes.ok) {
            const taskStatus = await statusRes.json()
            if (taskStatus.status === "SUCCESS") {
              isComplete = true
              const downloadRes = await fetchApi(`jobs/${data.task_id}/download/`)
              if (downloadRes.ok) {
                const blob = await downloadRes.blob()
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = `grc_system_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                toast.success("Backup downloaded successfully.")
              } else {
                throw new Error("Download failed")
              }
            } else if (taskStatus.status === "FAILED") {
              throw new Error("Task failed: " + taskStatus.error)
            }
          }
        }
      }
    } catch (err) {
"""

old_backup_logic = """
  async function handleBackup() {
    setIsBackingUp(true)
    try {
      const res = await fetchApi("backup/")
      if (!res.ok) throw new Error("Backup failed")
        
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `grc_system_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      toast.success("Backup downloaded successfully.")
    } catch (err) {
"""

content = content.replace(old_backup_logic.strip(), backup_poll_logic.strip())

# Now Restore
restore_poll_logic = """
  async function executeRestore() {
    if (!restoreFile) return

    setIsRestoring(true)
    const formData = new FormData()
    formData.append("file", restoreFile)

    try {
      const res = await fetchApi("restore/", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) throw new Error("Restore request failed")
      
      const data = await res.json()
      if (data.task_id) {
        let isComplete = false
        while (!isComplete) {
          await new Promise(r => setTimeout(r, 2000))
          const statusRes = await fetchApi(`jobs/${data.task_id}/status/`)
          if (statusRes.ok) {
            const taskStatus = await statusRes.json()
            if (taskStatus.status === "SUCCESS") {
              isComplete = true
              toast.success("System Restored", { description: "The system snapshot was successfully imported." })
              setTimeout(() => window.location.reload(), 2000)
            } else if (taskStatus.status === "FAILED") {
              throw new Error("Task failed: " + taskStatus.error)
            }
          }
        }
      }
    } catch (err) {
"""

old_restore_logic = """
  async function executeRestore() {
    if (!restoreFile) return

    setIsRestoring(true)
    const formData = new FormData()
    formData.append("file", restoreFile)

    try {
      const token = localStorage.getItem("grc_token") || sessionStorage.getItem("grc_token")
      const res = await fetchApi("restore/", {
        method: "POST",
        headers: {
          "Authorization": `Token ${token}`
        },
        body: formData,
      })

      if (!res.ok) throw new Error("Restore failed")

      toast.success("System Restored", { description: "The system snapshot was successfully imported." })
      setTimeout(() => window.location.reload(), 2000)
    } catch (err) {
"""

content = content.replace(old_restore_logic.strip(), restore_poll_logic.strip())

with open("grc-frontend/components/workspace-settings.tsx", "w") as f:
    f.write(content)
