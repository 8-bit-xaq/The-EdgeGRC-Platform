"use client"

import { Monitor } from "lucide-react"
import { useTheme } from "next-themes"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()

  return (
    <Select value={theme ?? "system"} onValueChange={(value) => value && setTheme(value)}>
      <SelectTrigger className="w-14 px-2 sm:w-[180px]" aria-label="Color theme">
        <Monitor className="size-4" aria-hidden />
        <SelectValue className="hidden sm:flex" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="system">System (automatic)</SelectItem>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
      </SelectContent>
    </Select>
  )
}
