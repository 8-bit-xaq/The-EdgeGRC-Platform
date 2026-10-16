"use client"

/**
 * @fileoverview Notification Bell and popover component.
 *
 * Renders the top-bar notification indicator, badge count, and popover drawer:
 * - Visual indicators by severity (info, success, warning, critical).
 * - Mark as read, mark all read, individual dismissal, and clear all.
 * - Parses and extracts embedded control IDs to navigate directly into control details.
 */

import { useState } from "react"
import { Bell, Check, CheckCheck, Info, ShieldAlert, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  formatRelativeTime,
  useNotifications,
  type AppNotification,
  type NotificationSeverity,
} from "@/lib/notifications"

const SEVERITY_META: Record<
  NotificationSeverity,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  info: { icon: Info, className: "text-primary bg-primary/10" },
  success: { icon: Check, className: "text-success bg-success/10" },
  warning: { icon: TriangleAlert, className: "text-chart-3 bg-chart-3/10" },
  critical: { icon: ShieldAlert, className: "text-destructive bg-destructive/10" },
}

// --- NEW: Added click handler prop ---
interface NotificationBellProps {
  onNotificationClick?: (controlId: string) => void
}

export function NotificationBell({ onNotificationClick }: NotificationBellProps) {
  const { notifications, unreadCount, markAsRead, markAllAsRead, removeNotification, clearAll } = useNotifications()
  
  // Track open state so we can close it when a user clicks a notification
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon" className="relative" aria-label="Notifications" />
        }
      >
        <Bell className="size-5" aria-hidden />
        {unreadCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex size-4.5 min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            aria-hidden
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        <span className="sr-only">
          {unreadCount > 0 ? `${unreadCount} unread notifications` : "No unread notifications"}
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[calc(100vw-2rem)] max-w-sm gap-0 p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-popover-foreground">Notifications</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <CheckCheck className="size-3.5" aria-hidden />
              Mark all read
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bell className="size-5" aria-hidden />
            </div>
            <p className="text-sm font-medium text-popover-foreground">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground">New alerts will appear here.</p>
          </div>
        ) : (
          <>
            <ul className="max-h-[22rem] overflow-y-auto">
              {notifications.map((n: AppNotification) => {
                const meta = SEVERITY_META[n.severity] || SEVERITY_META.info
                const Icon = meta.icon
                return (
                  <li
                    key={n.id}
                    onClick={() => {
                      if (!n.read) markAsRead(n.id)
                      // --- NEW: Trigger navigation if the notification is linked to a control ---
                      if (n.target_control_id && onNotificationClick) {
                        onNotificationClick(n.target_control_id)
                        setIsOpen(false)
                      }
                    }}
                    className={cn(
                      "group relative flex gap-3 border-b border-border px-4 py-3 last:border-b-0 transition-colors",
                      !n.read && "bg-accent/40",
                      n.target_control_id && "cursor-pointer hover:bg-muted/50"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                        meta.className,
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-popover-foreground text-pretty">
                          {n.title}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation() // Prevent clicking the dismiss button from opening the modal
                            removeNotification(n.id)
                          }}
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                          aria-label={`Dismiss ${n.title}`}
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                        {n.description}
                      </p>
                      <div className="mt-1.5 flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(n.timestamp)}
                        </span>
                        {!n.read && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation() // Prevent marking as read from opening the modal
                              markAsRead(n.id)
                            }}
                            className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                    {!n.read && (
                      <span
                        className="absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary"
                        aria-hidden
                      />
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={clearAll}
                className="w-full rounded-md px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Clear all notifications
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}