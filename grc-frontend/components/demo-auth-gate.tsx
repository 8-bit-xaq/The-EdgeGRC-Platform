'use client'

/**
 * @fileoverview Authentication Gatekeeper Component.
 * Intercepts root page loads to verify session integrity:
 * - Pings `/api/verify-session/` to validate HttpOnly session cookies without UI flash.
 * - Routes authenticated users to `GrcApp`, handles mandatory password rotation,
 *   tracks idle session inactivity, and routes unauthenticated visitors to `LoginScreen`.
 */

import { useState, useEffect } from 'react'
import { GrcApp } from '@/components/grc-app'
import { LoginScreen } from '@/components/login-screen'
import { ForcePasswordChangeModal } from '@/components/force-password-change-modal'
import { SessionInactivityTracker } from '@/components/session-inactivity-tracker'
import { ErrorBoundary } from '@/components/error-boundary'
import { fetchApi } from '@/lib/api'

export function DemoAuthGate() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [mustChangePassword, setMustChangePassword] = useState(false)

  useEffect(() => {
    async function verifyAuth() {
      try {
        // Ping the backend to cryptographically verify the HttpOnly cookie
        const res = await fetchApi("verify-session/")
        
        if (res.ok) {
          const data = await res.json()
          
          // Overwrite any potentially spoofed local data with the server's absolute truth
          const storage = localStorage.getItem("grc_username") ? localStorage : sessionStorage
          storage.setItem("grc_username", data.username)
          storage.setItem("grc_role", data.role)
          if (data.avatar) storage.setItem("grc_avatar", data.avatar)
          
          setMustChangePassword(Boolean(data.must_change_password))
          setIsSignedIn(true)
        } else {
          setIsSignedIn(false)
        }
      } catch (err) {
        setIsSignedIn(false)
      } finally {
        setIsCheckingAuth(false)
      }
    }

    verifyAuth()
  }, [])

  async function handleLogout() {
    try {
      // Tell the backend to destroy the session and the cookie
      await fetchApi("logout/", { method: "POST" })
    } catch (err) {
      console.error("Logout error", err)
    } finally {
      const keysToRemove = ["grc_username", "grc_role", "grc_avatar", "grc_token"] 
      keysToRemove.forEach(k => {
        localStorage.removeItem(k)
        sessionStorage.removeItem(k)
      })
      setMustChangePassword(false)
      setIsSignedIn(false)
    }
  }

  // Prevent UI flash while the server verifies the session
  if (isCheckingAuth) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (isSignedIn) {
    return (
      <ErrorBoundary>
        <GrcApp onLogout={handleLogout} />
        <SessionInactivityTracker onLogout={handleLogout} />
        {mustChangePassword && (
          <ForcePasswordChangeModal
            onPasswordChanged={() => setMustChangePassword(false)}
            onLogout={handleLogout}
          />
        )}
      </ErrorBoundary>
    )
  }

  return (
    <LoginScreen
      onSignIn={(authData) => {
        if (authData?.must_change_password) {
          setMustChangePassword(true)
        } else {
          setMustChangePassword(false)
        }
        setIsSignedIn(true)
      }}
    />
  )
}