import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { QueryProvider } from '@/components/query-provider' // <-- IMPORT THE PROVIDER
import { OrganizationProvider } from '@/lib/organization'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: 'Edge GRC',
  description:
    'Governance, Risk & Compliance platform for importing frameworks and managing compliance controls.',
  generator: 'v0.app',
  icons: {
    icon: '/api/organization/favicon',
    apple: '/api/organization/favicon',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: '#16181d' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} bg-background`}>
      <body className="font-sans antialiased">
        {/* WRAP THE ENTIRE APP IN THE QUERY AND ORGANIZATION PROVIDERS */}
        <QueryProvider>
          <OrganizationProvider>
            {children}
            <Toaster position="bottom-right" />
          </OrganizationProvider>
        </QueryProvider>
      </body>
    </html>
  )
}