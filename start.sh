#!/usr/bin/env bash
# Freebuff Desktop launcher (macOS / Linux) - run with: ./start.sh
set -e
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
    echo "[Freebuff] Docker was not found. Install Docker Desktop first:"
    echo "           https://www.docker.com/products/docker-desktop/"
    exit 1
fi

# Make sure .env exists (secrets live in .env.local which is git-ignored).
if [ ! -f .env ]; then
    if [ -f .env.local ]; then
        cp .env.local .env
        echo "[Freebuff] Created .env from .env.local"
    else
        echo "[Freebuff] Missing .env - copy .env.example to .env and fill in"
        echo "           your Supabase URL and anon key, then run this again."
        exit 1
    fi
fi

echo "[Freebuff] Building and starting the app (first run takes a few minutes)..."
docker compose up -d --build

echo "[Freebuff] Opening http://localhost:3000 ..."
(open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) || true
echo "[Freebuff] Running at http://localhost:3000"
echo "           Stop it later with:  docker compose down"
