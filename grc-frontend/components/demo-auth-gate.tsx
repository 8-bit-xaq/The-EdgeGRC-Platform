'use client'

import { useState, useEffect } from 'react'
import { GrcApp } from '@/components/grc-app'
import { LoginScreen } from '@/components/login-screen'
import { fetchApi } from '@/lib/api'

export function DemoAuthGate() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)

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
      setIsSignedIn(false)
    }
  }

  // Prevent UI flash while the server verifies the session
  if (isCheckingAuth) return null 

  if (isSignedIn) {
    return <GrcApp onLogout={handleLogout} />
  }

  return <LoginScreen onSignIn={() => setIsSignedIn(true)} />
}