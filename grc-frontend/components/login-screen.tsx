'use client'

/**
 * @fileoverview Appliance login screen component.
 *
 * Implements standard credential authentication via `/api/login/`:
 * - Form validation using React Hook Form and Zod schema.
 * - Dynamic session persistence selection (`localStorage` vs. `sessionStorage`) based on "Remember Me".
 * - Mandatory first-run password change interception (`must_change_password`).
 * - Custom branding integration (organization name and logo).
 */

import * as React from 'react'
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchApi } from '@/lib/api'
import { useOrganization } from '@/lib/organization'

interface LoginScreenProps {
  onSignIn: (authData?: { must_change_password?: boolean; username?: string; role?: string; avatar?: string }) => void
}

const loginSchema = z.object({
  username: z.string().min(1, 'Please enter your username.'),
  password: z.string().min(1, 'Please enter your password.'),
  rememberMe: z.boolean().default(false),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginScreen({ onSignIn }: LoginScreenProps) {
  const { organization } = useOrganization()
  const [showPassword, setShowPassword] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
      password: '',
      rememberMe: false,
    },
  })

  async function onSubmit(values: LoginFormValues) {
    setServerError(null)
    
    try {
      const res = await fetchApi("login/", {
        method: "POST",
        body: JSON.stringify({
          username: values.username,
          password: values.password,
          remember_me: values.rememberMe,
        })
      })

      if (res.ok) {
        const data = await res.json()
        
        if (values.rememberMe) {
          localStorage.setItem("grc_username", values.username)
          localStorage.setItem("grc_role", data.role) 
          if (data.avatar) localStorage.setItem("grc_avatar", data.avatar) 
        } else {
          sessionStorage.setItem("grc_username", values.username)
          sessionStorage.setItem("grc_role", data.role) 
          if (data.avatar) sessionStorage.setItem("grc_avatar", data.avatar) 
        }
        
        onSignIn(data)
      } else if (res.status === 400) {
        setServerError("Invalid username or password.")
      } else {
        const errData = await res.json().catch(() => null)
        setServerError(errData?.error || errData?.detail || `Server error (${res.status}). Please try again.`)
      }
    } catch (error) {
      console.error("Login error:", error)
      setServerError("Could not connect to the authentication server.")
    }
  }

  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(32rem,1.05fr)]">
      <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r border-border bg-zinc-950 p-10 text-white dark:bg-muted/20 dark:text-foreground lg:flex xl:p-14">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/5 dark:border-border dark:bg-muted/50">
            {organization.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={organization.logoDataUrl} alt={`${organization.companyName} logo`} className="size-full object-contain p-1" />
            ) : (
              <div className="flex size-full items-center justify-center bg-primary text-primary-foreground">
                <ShieldCheck className="size-6" aria-hidden />
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">{organization.companyName || "Compliance Workspace"}</p>
            <p className="text-xs text-zinc-400 dark:text-muted-foreground">{organization.workspaceName || "Governance, Risk & Compliance"}</p>
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
            <div className="flex size-10 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
              {organization.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={organization.logoDataUrl} alt={`${organization.companyName} logo`} className="size-full object-contain p-1" />
              ) : (
                <div className="flex size-full items-center justify-center bg-primary text-primary-foreground">
                  <ShieldCheck className="size-6" aria-hidden />
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{organization.companyName || "Compliance Workspace"}</p>
              <p className="text-xs text-muted-foreground">{organization.workspaceName || "Governance, Risk & Compliance"}</p>
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
              <form className="flex flex-col gap-5" onSubmit={handleSubmit(onSubmit)} noValidate>
                {serverError && <div className="p-3 text-sm rounded-md bg-destructive/15 text-destructive border border-destructive/20">{serverError}</div>}
                
                <div className="grid gap-2">
                  <Label htmlFor="login-username">Username</Label>
                  <Input
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    placeholder="Enter your username"
                    disabled={isSubmitting}
                    aria-invalid={Boolean(errors.username)}
                    {...register("username")}
                  />
                  {errors.username && <p className="text-sm text-destructive" role="alert">{errors.username.message}</p>}
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="login-password">Password</Label>
                    <button type="button" className="text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setServerError('Please contact your workspace administrator to reset your password.')}>
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      disabled={isSubmitting}
                      className="pr-11"
                      aria-invalid={Boolean(errors.password)}
                      {...register("password")}
                    />
                    <button type="button" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                  {errors.password && <p className="text-sm text-destructive" role="alert">{errors.password.message}</p>}
                </div>

                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" disabled={isSubmitting} {...register("rememberMe")} className="size-4 rounded border-input accent-primary" />
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
