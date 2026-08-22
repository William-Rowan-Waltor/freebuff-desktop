'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker for PWA install + offline shell.
 * Only runs in production and when the browser supports service workers.
 */
export default function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // Skip in development (Turbopack HMR conflicts with SW caching)
    if (process.env.NODE_ENV !== 'production') return

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[dresplace] SW registered:', reg.scope)
        // Check for updates every 60 minutes
        setInterval(() => reg.update(), 60 * 60 * 1000)
      })
      .catch((err) => {
        console.warn('[dresplace] SW registration failed:', err)
      })
  }, [])

  return null
}
