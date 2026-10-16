"use client"

/**
 * @fileoverview Notification state management context and polling provider.
 *
 * Provides application-wide alert notifications for the EdgeGRC appliance:
 * - Polls `/api/notifications/` every 30 seconds when authenticated.
 * - Supports optimistic state updates for marking notifications read or deleting them.
 * - Formats relative timestamps (e.g. "Just now", "5m ago", "2h ago").
 */

import React, { createContext, useContext, useEffect, useState } from "react"
import { fetchApi } from "@/lib/api"

export type NotificationSeverity = "info" | "success" | "warning" | "critical"

/**
 * Normalized notification model used across UI popovers and lists.
 */
export interface AppNotification {
  id: string
  title: string
  description: string
  severity: NotificationSeverity
  read: boolean
  timestamp: string
  target_control_id?: string
}

/**
 * Raw notification schema returned by Django REST API (`/api/notifications/`).
 */
interface RawApiNotification {
  id: number | string
  title: string
  description: string
  severity: NotificationSeverity
  read: boolean
  timestamp: string
  target_control_id?: string
}

interface NotificationsContextType {
  notifications: AppNotification[]
  unreadCount: number
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  removeNotification: (id: string) => Promise<void>
  clearAll: () => Promise<void>
  refreshNotifications: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined)

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  const unreadCount = notifications.filter((n) => !n.read).length

  const fetchNotifications = async () => {
    // Check for token locally to prevent polling 401s when logged out
    const token = localStorage.getItem("grc_token") || sessionStorage.getItem("grc_token")
    if (!token) return

    try {
      const res = await fetchApi("notifications/")
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.map((n: RawApiNotification) => ({ ...n, id: String(n.id) })))
      }
    } catch (err) {
      console.error("Failed to fetch notifications", err)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [])

  const markAsRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    await fetchApi(`notifications/${id}/`, { method: "PATCH" })
  }

  const markAllAsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    await fetchApi(`notifications/read/`, { method: "PATCH" })
  }

  const removeNotification = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    await fetchApi(`notifications/${id}/`, { method: "DELETE" })
  }

  const clearAll = async () => {
    setNotifications([])
    await fetchApi(`notifications/read/`, { method: "DELETE" })
  }

  return (
    <NotificationsContext.Provider
    value={{
      notifications,
      unreadCount,
      markAsRead,
      markAllAsRead,
      removeNotification,
      clearAll,
      refreshNotifications: fetchNotifications
    }}
    >
    {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationsContext)
  if (context === undefined) {
    throw new Error("useNotifications must be used within a NotificationsProvider")
  }
  return context
}

export function formatRelativeTime(dateString: string) {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return "Just now"
    const diffInMinutes = Math.floor(diffInSeconds / 60)
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`
      const diffInHours = Math.floor(diffInMinutes / 60)
      if (diffInHours < 24) return `${diffInHours}h ago`
        const diffInDays = Math.floor(diffInHours / 24)
        if (diffInDays < 7) return `${diffInDays}d ago`
          return date.toLocaleDateString()
}
