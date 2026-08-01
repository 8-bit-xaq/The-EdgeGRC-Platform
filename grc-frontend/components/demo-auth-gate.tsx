'use client'

import { useState, useEffect } from 'react'
import { GrcApp } from '@/components/grc-app'
import { LoginScreen } from '@/components/login-screen'

export function DemoAuthGate() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)

  // 1. Check storage as soon as the app loads
  useEffect(() => {
    const token = localStorage.getItem('grc_token') || sessionStorage.getItem('grc_token')
    if (token) {
      setIsSignedIn(true)
    }
    setIsCheckingAuth(false)
  }, [])

  // 2. Ensure everything is wiped when logging out
  function handleLogout() {
    const keysToRemove = ["grc_token", "grc_username", "grc_role", "grc_avatar"]
    keysToRemove.forEach(k => {
      localStorage.removeItem(k)
      sessionStorage.removeItem(k)
    })
    setIsSignedIn(false)
  }

  // Don't flash the login screen while checking for a token
  if (isCheckingAuth) return null 

  if (isSignedIn) {
    return <GrcApp onLogout={handleLogout} />
  }

  return <LoginScreen onSignIn={() => setIsSignedIn(true)} />
}