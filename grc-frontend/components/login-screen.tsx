'use client'

import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchApi } from '@/lib/api' // <-- NEW: API Wrapper

interface LoginScreenProps {
  onSignIn: () => void
}

interface FormErrors {
  username?: string
  password?: string
}

export function LoginScreen({ onSignIn }: LoginScreenProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})

  function validate() {
    const nextErrors: FormErrors = {}
    if (!username.trim()) nextErrors.username = 'Enter your username.'
    if (!password) nextErrors.password = 'Enter your password.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)
    
    try {
      const response = await fetchApi("login/", {
        method: "POST",
        // WE ADDED remember_me HERE:
        body: JSON.stringify({ username, password, remember_me: rememberMe }),
      })

      if (response.ok) {
        const data = await response.json()
        
        const keysToRemove = ["grc_token", "grc_username", "grc_role", "grc_avatar"]
        keysToRemove.forEach(k => {
          localStorage.removeItem(k)
          sessionStorage.removeItem(k)
        })
        
        // We no longer store data.token anywhere. The browser holds the cookie securely.
        if (rememberMe) {
          localStorage.setItem("grc_username", username)
          localStorage.setItem("grc_role", data.role) 
          if (data.avatar) localStorage.setItem("grc_avatar", data.avatar) 
        } else {
          sessionStorage.setItem("grc_username", username)
          sessionStorage.setItem("grc_role", data.role) 
          if (data.avatar) sessionStorage.setItem("grc_avatar", data.avatar) 
        }
        
        onSignIn()
      } else {
        setErrors({ password: "Invalid username or password." })
      }
    } catch (error) {
      console.error("Login error:", error)
      setErrors({ password: "Could not connect to the authentication server." })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(32rem,1.05fr)]">
      <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r border-border bg-zinc-950 p-10 text-white dark:bg-muted/20 dark:text-foreground lg:flex xl:p-14">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">Compliance Workspace</p>
            <p className="text-xs text-zinc-400 dark:text-muted-foreground">Governance, Risk &amp; Compliance</p>
          </div>
        </div>

        <div className="max-w-xl">
          <div className="mb-7 flex size-14 items-center justify-center rounded-xl border border-white/10 bg-white/5 dark:border-border dark:bg-muted/50">
            <LockKeyhole className="size-7 text-primary" aria-hidden />
          </div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-primary">
            Secure workspace access
          </p>
          <h1 className="max-w-lg text-balance text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            Keep compliance work controlled, traceable, and ready for review.
          </h1>
          <p className="mt-5 max-w-lg text-pretty text-base leading-relaxed text-zinc-400 dark:text-muted-foreground">
            Sign in to manage frameworks, evidence, audit activity, and team access from one governed workspace.
          </p>
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 pt-6 text-xs text-zinc-500 dark:border-border dark:text-muted-foreground">
          <span>Encrypted in transit</span>
          <span aria-hidden>•</span>
          <span>Role-based access</span>
          <span aria-hidden>•</span>
          <span>Auditable activity</span>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-6" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Compliance Workspace</p>
              <p className="text-xs text-muted-foreground">Governance, Risk &amp; Compliance</p>
            </div>
          </div>

          <Card className="border-border shadow-sm">
            <CardHeader className="gap-2 pb-6">
              <CardTitle className="text-balance text-2xl tracking-tight">Sign in to your workspace</CardTitle>
              <CardDescription className="text-pretty leading-relaxed">
                Use your username and password to continue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
                <div className="grid gap-2">
                  <Label htmlFor="login-username">Username</Label>
                  <Input
                    id="login-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    placeholder="Enter your username"
                    value={username}
                    disabled={isSubmitting}
                    aria-invalid={Boolean(errors.username)}
                    aria-describedby={errors.username ? 'login-username-error' : undefined}
                    onChange={(event) => {
                      setUsername(event.target.value)
                      if (errors.username) setErrors((current) => ({ ...current, username: undefined }))
                    }}
                  />
                  {errors.username && <p id="login-username-error" className="text-sm text-destructive" role="alert">{errors.username}</p>}
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="login-password">Password</Label>
                    <button type="button" className="text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setErrors((current) => ({ ...current, password: 'Please contact your workspace administrator to reset your password.' }))}>
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      disabled={isSubmitting}
                      className="pr-11"
                      aria-invalid={Boolean(errors.password)}
                      aria-describedby={errors.password ? 'login-password-error' : undefined}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        if (errors.password) setErrors((current) => ({ ...current, password: undefined }))
                      }}
                    />
                    <button type="button" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                  {errors.password && <p id="login-password-error" className="text-sm text-destructive" role="alert">{errors.password}</p>}
                </div>

                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={rememberMe} disabled={isSubmitting} onChange={(event) => setRememberMe(event.target.checked)} className="size-4 rounded border-input accent-primary" />
                  Keep me signed in on this device
                </label>

                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Signing in...</> : 'Sign in'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  )
}