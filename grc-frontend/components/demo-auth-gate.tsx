'use client'

import { useState, useEffect } from 'react'
import { GrcApp } from '@/components/grc-app'
import { LoginScreen } from '@/components/login-screen'
import { fetchApi } from '@/lib/api'

export function DemoAuthGate() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)

  useEffect(() => {
    // Rely on the username metadata instead of the token for initial rendering
    const user = localStorage.getItem('grc_username') || sessionStorage.getItem('grc_username')
    if (user) {
      setIsSignedIn(true)
    }
    setIsCheckingAuth(false)
  }, [])

  async function handleLogout() {
    try {
      // Tell the backend to destroy the session and the cookie
      await fetchApi("logout/", { method: "POST" })
    } catch (err) {
      console.error("Logout error", err)
    } finally {
      const keysToRemove = ["grc_username", "grc_role", "grc_avatar", "grc_token"] // Ensure old tokens are purged
      keysToRemove.forEach(k => {
        localStorage.removeItem(k)
        sessionStorage.removeItem(k)
      })
      setIsSignedIn(false)
    }
  }

  if (isCheckingAuth) return null 

  if (isSignedIn) {
    return <GrcApp onLogout={handleLogout} />
  }

  return <LoginScreen onSignIn={() => setIsSignedIn(true)} />
}