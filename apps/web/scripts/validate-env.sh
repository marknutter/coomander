#!/bin/sh
# Validate required environment variables before starting the application.
# Exit 1 on any failure so the container stops immediately with a clear message.

errors=0

# ── BETTER_AUTH_SECRET ──────────────────────────────────────────────────────
if [ -z "$BETTER_AUTH_SECRET" ]; then
  echo "ERROR: BETTER_AUTH_SECRET is not set."
  echo "       Generate one with: openssl rand -base64 32"
  errors=$((errors + 1))
elif [ ${#BETTER_AUTH_SECRET} -lt 32 ]; then
  echo "ERROR: BETTER_AUTH_SECRET is too short (${#BETTER_AUTH_SECRET} chars, minimum 32)."
  echo "       Generate a strong secret with: openssl rand -base64 32"
  errors=$((errors + 1))
fi

# ── BETTER_AUTH_URL ─────────────────────────────────────────────────────────
if [ -z "$BETTER_AUTH_URL" ]; then
  echo "ERROR: BETTER_AUTH_URL is not set."
  echo "       Set it to your public URL, e.g. https://app.example.com"
  errors=$((errors + 1))
elif ! echo "$BETTER_AUTH_URL" | grep -qE '^https?://'; then
  echo "ERROR: BETTER_AUTH_URL does not look like a URL: $BETTER_AUTH_URL"
  echo "       It must start with http:// or https://"
  errors=$((errors + 1))
fi

# ── DATABASE_PATH ───────────────────────────────────────────────────────────
if [ -z "$DATABASE_PATH" ]; then
  echo "ERROR: DATABASE_PATH is not set."
  echo "       Set it to the path for your SQLite database, e.g. /data/appseed.db"
  errors=$((errors + 1))
fi

# ── Result ──────────────────────────────────────────────────────────────────
if [ $errors -gt 0 ]; then
  echo ""
  echo "Environment validation failed with $errors error(s). Aborting startup."
  exit 1
fi

echo "Environment validation passed."
exit 0
