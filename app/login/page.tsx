'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'

type Mode = 'signin' | 'signup'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) throw err
        if (!data.session) {
          setError('Account created - confirm your email before signing in.')
          setMode('signin')
          setLoading(false)
          return
        }
      }
      router.push('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-zinc-900 p-8">
        <h1 className="text-lg font-semibold text-zinc-50">
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {mode === 'signin'
            ? 'Welcome back to your workspace.'
            : 'Your notes, events and files will be private to you.'}
        </p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] text-zinc-300">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-zinc-300">
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-accent"
            />
          </label>
          {error && <p className="text-[13px] text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-foreground transition-transform active:scale-[0.98] hover:bg-accent-strong disabled:opacity-60"
          >
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
          }}
          className="mt-4 w-full text-center text-[13px] text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
        >
          {mode === 'signin' ? 'No account? Create one' : 'Already have an account? Sign in'}
        </button>
      </div>
    </main>
  )
}