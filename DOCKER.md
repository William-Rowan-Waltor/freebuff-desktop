# Running Freebuff Desktop with Docker

This packages the whole app into a single Docker image so you can run it with one
command — or double-click — and hand the same image to other people.

## What you need

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / macOS / Linux), started once.
- Your Supabase credentials — already in your local `.env.local`. The launchers
  copy them into a `.env` file automatically (`.env` is git-ignored, so the
  secrets are never committed).

## Quick start

**Windows:** double-click `start.bat`.

**macOS / Linux:**
```bash
./start.sh
```

**Or manually:**
```bash
docker compose up -d --build
```

Then open <http://localhost:3000>. The first build takes a few minutes (it
downloads the Node image and compiles the app); later starts are seconds.

To stop the app: `docker compose down` (your data is untouched).

> **Data note:** all your blocks, events and settings live in the browser's
> localStorage, so each person who opens the app sees their own data. Nothing
> is written into the container.

## Sending the app to other people

Anyone with Docker can run it — they don't need your source code or Node.

### Option A — send the image file (simplest)

On your machine, save the image to a single file:

```bash
docker save freebuff-desktop:latest | gzip > freebuff-desktop.tar.gz
```

Send that one file (a few hundred MB). The recipient:

```bash
docker load -i freebuff-desktop.tar.gz
docker run -d -p 3000:3000 --name freebuff freebuff-desktop:latest
open http://localhost:3000
```

The Supabase URL and anon key are baked into the image at build time, so the
recipient needs nothing but Docker. They sign in (or create their own account)
against your Supabase project.

### Option B — send the project folder

Give them this folder (without `node_modules`, `.next`, `.env`, `.git`). They
need their **own** `.env` (copy `.env.example`) and run:

```bash
docker compose up -d --build
```

## Before first use: apply the new database migrations

Two migrations added for server-side settings + shared workspaces must be run
once in the Supabase SQL Editor (then `notify pgrst, 'reload schema';`):

1. `supabase/migrate_user_state.sql` — settings/timer/import-history table.
2. `supabase/migrate_workspaces.sql` — workspaces + membership + RLS swap.

Until they're applied the app still works (localStorage fallback + per-user
blocks); the share button and cross-device settings just won't activate.

## Troubleshooting

- **Port 3000 already in use** — edit `docker-compose.yml` and change
  `"3000:3000"` to e.g. `"3100:3000"`, then use `http://localhost:3100`.
- **"Missing in .env"** — copy `.env.example` to `.env` and paste your
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` values.
- **Logs / status** — `docker compose ps` and `docker compose logs -f freebuff`.
