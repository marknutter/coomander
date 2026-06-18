#!/bin/bash
# Post-commit hook: check if changed files have dev wiki coverage.
# Outputs a reminder if wiki pages may need updating.
#
# Usage: called automatically by Claude Code's PostToolUse hook after git commit.

set -euo pipefail

WIKI_DIR="apps/web/content/docs/dev"
GUIDE_DIR="apps/web/content/docs/guide"

# Only run if this project has a dev wiki
if [ ! -d "$WIKI_DIR" ]; then
  exit 0
fi

# Get files changed in the last commit
CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")
if [ -z "$CHANGED" ]; then
  exit 0
fi

# Skip if the commit only touched docs/wiki files
NON_DOC_CHANGES=$(echo "$CHANGED" | grep -v "^apps/web/content/docs/" | grep -v "^AGENTS.md" | grep -v "^CLAUDE.md" || true)
if [ -z "$NON_DOC_CHANGES" ]; then
  exit 0
fi

# Map changed paths to wiki topics
TOPICS=""

if echo "$CHANGED" | grep -q "lib/auth\|app/api/auth\|middleware.ts"; then
  if ! echo "$CHANGED" | grep -q "content/docs/dev/"; then
    TOPICS="${TOPICS}  - Auth changes → update content/docs/dev/conventions.mdx (auth patterns section)\n"
  fi
fi

if echo "$CHANGED" | grep -q "lib/schema\|migrations/\|lib/db"; then
  if ! echo "$CHANGED" | grep -q "content/docs/dev/"; then
    TOPICS="${TOPICS}  - Database changes → update content/docs/dev/architecture.mdx (database section)\n"
  fi
fi

if echo "$CHANGED" | grep -q "lib/stripe\|app/api/stripe"; then
  if ! echo "$CHANGED" | grep -q "content/docs/"; then
    TOPICS="${TOPICS}  - Stripe changes → consider adding content/docs/dev/payments.mdx or updating guide\n"
  fi
fi

if echo "$CHANGED" | grep -q "app/api/.*route.ts"; then
  if ! echo "$CHANGED" | grep -q "content/docs/"; then
    TOPICS="${TOPICS}  - API route changes → add @openapi JSDoc if public, update wiki if new pattern\n"
  fi
fi

if echo "$CHANGED" | grep -q "components/\|app/.*page.tsx"; then
  if ! echo "$CHANGED" | grep -q "content/docs/"; then
    TOPICS="${TOPICS}  - UI changes → update customer docs if user-facing behavior changed\n"
  fi
fi

if echo "$CHANGED" | grep -q "docker\|Dockerfile"; then
  if ! echo "$CHANGED" | grep -q "content/docs/"; then
    TOPICS="${TOPICS}  - Docker changes → update content/docs/guide/deployment.mdx\n"
  fi
fi

if echo "$CHANGED" | grep -q "lib/chat\|lib/voice\|app/api/chat\|app/api/voice"; then
  if ! echo "$CHANGED" | grep -q "content/docs/"; then
    TOPICS="${TOPICS}  - Chat/voice changes → consider adding content/docs/dev/chat.mdx\n"
  fi
fi

if [ -n "$TOPICS" ]; then
  echo ""
  echo "📝 Wiki coverage reminder — these areas changed without doc updates:"
  echo -e "$TOPICS"
  echo "  Run: update the relevant wiki page in $WIKI_DIR or $GUIDE_DIR"
  echo ""
fi
