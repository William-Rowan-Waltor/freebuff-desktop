// Verify the live recurrence migration (blocks.recurrence +
// blocks.recurrence_exceptions) with a real insert/read round-trip.
//
// Usage:
//   node scripts/verify-recurrence-migration.mjs [--token=XXX]
//
// Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from
// .env.local. The insert/read round-trip needs an AUTHENTICATED owner token
// (the live RLS is owner-scoped — anon can select but not insert); the token
// is resolved, in order, from:
//   --token=XXX CLI arg, SUPABASE_ACCESS_TOKEN env, or
//   SUPABASE_EMAIL + SUPABASE_PASSWORD (signs in via /auth/v1/token).
// The column probe itself works with the anon key, so a missing token still
// reports whether the migration is applied. If the columns are missing the
// script prints the exact SQL for the Supabase SQL Editor and exits 1.
// Otherwise it inserts a clearly-named probe event (recurring + one
// exception), reads it back, asserts the fields round-trip, and deletes the
// probe row.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('Missing .env.local — cannot reach the live project.')
  process.exit(1)
}
const raw = fs.readFileSync(envPath, 'utf8')
const url = (raw.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1] ?? '').trim().replace(/\/$/, '')
const anon = (raw.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1] ?? '').trim()
if (!url || !anon) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env.local')
  process.exit(1)
}

const SQL = `alter table public.blocks add column if not exists recurrence text;
alter table public.blocks add column if not exists recurrence_exceptions text[];`

/**
 * Resolve the authenticated owner token used for the write round-trip.
 * PostgREST still wants the apikey header (anon is fine for that); the
 * Authorization: Bearer <token> determines the Postgres role, so an owner
 * token gets past the owner-scoped RLS that blocks anonymous inserts.
 */
async function resolveToken() {
  const cli = process.argv.find((a) => a.startsWith('--token='))?.slice('--token='.length)
  const env = process.env.SUPABASE_ACCESS_TOKEN
  if (cli || env) {
    const token = (cli || env).trim()
    console.log(`Using access token from ${cli ? 'CLI --token' : 'SUPABASE_ACCESS_TOKEN'}.`)
    return token
  }
  const email = process.env.SUPABASE_EMAIL
  const password = process.env.SUPABASE_PASSWORD
  if (email && password) {
    console.log(`Signing in as ${email} via /auth/v1/token...`)
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const body = await res.text()
    if (res.status !== 200) {
      throw new Error(`auth sign-in failed (${res.status}): ${body.slice(0, 200)}`)
    }
    const token = JSON.parse(body).access_token
    if (!token) throw new Error('auth sign-in returned no access_token')
    console.log('Signed in OK.')
    return token
  }
  console.warn(
    'WARNING: no owner token (--token=..., SUPABASE_ACCESS_TOKEN, or SUPABASE_EMAIL/PASSWORD).\n' +
      '  The column probe below still works, but the insert round-trip will likely be\n' +
      '  denied by RLS (42501) unless the live DB allows anonymous writes.',
  )
  return anon
}

async function api(pathname, init, token) {
  const res = await fetch(url + pathname, {
    headers: { apikey: anon, Authorization: `Bearer ${token ?? anon}`, ...(init?.headers ?? {}) },
    ...init,
  })
  return { status: res.status, body: await res.text() }
}

async function main() {
  const token = await resolveToken()

  // 1) Column probe
  {
    const { status, body } = await api('/rest/v1/blocks?select=recurrence,recurrence_exceptions&limit=1', {}, token)
    if (status === 400 && body.includes('does not exist')) {
      console.error('MIGRATION NOT APPLIED — blocks.recurrence does not exist on the live DB.')
      console.error('Run this in the Supabase SQL Editor (project qfiwcriminirvyjsvasf), then re-run this script:\n')
      console.error(SQL)
      process.exitCode = 1
      return
    }
    if (status !== 200) {
      console.error(`Unexpected column probe response (${status}):`, body.slice(0, 300))
      process.exitCode = 1
      return
    }
    console.log('Columns exist — proceeding with the round-trip.')
  }

  const now = new Date()
  const start = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  const end = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
  const exception = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  let insertedId = null
  try {
    // 2) Insert a recurring event with one exception
    const ins = await api(
      '/rest/v1/blocks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          type: 'event',
          title: 'probe-recurrence-roundtrip',
          content: { type: 'doc', content: [] },
          start_time: start,
          end_time: end,
          recurrence: 'FREQ=WEEKLY;BYDAY=MO',
          recurrence_exceptions: [exception],
        }),
      },
      token,
    )
    if (ins.status !== 201) {
      console.error(`INSERT failed (${ins.status}):`, ins.body.slice(0, 400))
      process.exitCode = 1
      return
    }
    const inserted = JSON.parse(ins.body)
    insertedId = inserted[0]?.id
    if (!insertedId) throw new Error('insert returned no id')
    console.log('Inserted probe block', insertedId)

    // 3) Read it back and assert the fields round-trip
    const sel = await api(`/rest/v1/blocks?id=eq.${insertedId}`, {}, token)
    if (sel.status !== 200) throw new Error(`select failed (${sel.status})`)
    const [row] = JSON.parse(sel.body)
    if (!row) throw new Error('probe row not found on read-back')
    const checks = [
      ['recurrence', row.recurrence, 'FREQ=WEEKLY;BYDAY=MO'],
      ['recurrence_exceptions[0]', row.recurrence_exceptions?.[0], exception],
      ['start_time', row.start_time, start],
      ['end_time', row.end_time, end],
    ]
    for (const [label, got, want] of checks) {
      if (got !== want) throw new Error(`round-trip mismatch on ${label}: got ${got}, want ${want}`)
    }
    console.log(`Round-trip OK: recurrence='${row.recurrence}', exceptions=[${row.recurrence_exceptions.join(', ')}]`)
  } finally {
    // 4) Clean up the probe row (idempotent — 204 on success)
    if (insertedId) {
      const del = await api(`/rest/v1/blocks?id=eq.${insertedId}`, { method: 'DELETE' }, token)
      console.log(`Deleted probe block ${insertedId} (status ${del.status})`)
    }
  }
}

await main()
