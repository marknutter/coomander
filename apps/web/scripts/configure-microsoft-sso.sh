#!/usr/bin/env bash
# configure-microsoft-sso.sh
# Fully automates Microsoft SSO registration via the Azure CLI.
# Writes MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID
# to .env.local in the project root.
#
# Usage:
#   bash scripts/configure-microsoft-sso.sh
#   bash scripts/configure-microsoft-sso.sh --name "MyApp" --url "https://myapp.example.com"
#   bash scripts/configure-microsoft-sso.sh --print-only   (prints values, doesn't write .env.local)
#
# Requirements: az CLI (brew install azure-cli | winget install Microsoft.AzureCLI)

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()    { echo -e "${CYAN}→ $*${NC}"; }
success() { echo -e "${GREEN}✓ $*${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $*${NC}"; }
err()     { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "Required command '$1' not found. $2"
}

# Write or update a key=value line in a .env file (preserves other contents)
upsert_env() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then touch "$file"; fi
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Update existing line (macOS + Linux compatible sed)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
    else
      sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    fi
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------

APP_NAME=""
APP_URL=""
PRINT_ONLY=false
ENV_FILE=".env.local"

while [[ $# -gt 0 ]]; do
  case $1 in
    --name)        APP_NAME="$2"; shift 2 ;;
    --url)         APP_URL="$2";  shift 2 ;;
    --env-file)    ENV_FILE="$2"; shift 2 ;;
    --print-only)  PRINT_ONLY=true; shift ;;
    --help|-h)
      echo "Usage: bash scripts/configure-microsoft-sso.sh [--name <display-name>] [--url <app-url>] [--print-only]"
      exit 0 ;;
    *) err "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Microsoft SSO — Azure App Setup      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# 1. Check az CLI
# ---------------------------------------------------------------------------

info "Checking Azure CLI..."
require_cmd az "Install with: brew install azure-cli  (macOS) or  winget install Microsoft.AzureCLI  (Windows)"
AZ_VERSION=$(az --version 2>/dev/null | head -1)
success "Found: $AZ_VERSION"

# ---------------------------------------------------------------------------
# 2. Check login
# ---------------------------------------------------------------------------

info "Checking Azure login status..."
if ! az account show >/dev/null 2>&1; then
  warn "Not logged in. Launching az login..."
  az login
fi

ACCOUNT_JSON=$(az account show -o json)
TENANT_ID=$(echo "$ACCOUNT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenantId'])" 2>/dev/null \
  || echo "$ACCOUNT_JSON" | grep '"tenantId"' | sed 's/.*: *"\([^"]*\)".*/\1/')
ACCOUNT_NAME=$(echo "$ACCOUNT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])" 2>/dev/null \
  || echo "$ACCOUNT_JSON" | grep '"name"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

success "Logged in as: $ACCOUNT_NAME (tenant: $TENANT_ID)"

# ---------------------------------------------------------------------------
# 3. Gather app info
# ---------------------------------------------------------------------------

# App display name
if [ -z "$APP_NAME" ]; then
  # Try to read from package.json
  if [ -f "package.json" ] && command -v node >/dev/null 2>&1; then
    PKG_NAME=$(node -p "require('./package.json').name" 2>/dev/null || echo "")
    if [ -n "$PKG_NAME" ]; then
      # Title-case: replace hyphens with spaces and capitalize
      SUGGESTED=$(echo "$PKG_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2)); print}')
    fi
  fi
  SUGGESTED="${SUGGESTED:-MyApp}"
  read -rp "$(echo -e "${CYAN}App display name [${SUGGESTED}]: ${NC}")" APP_NAME
  APP_NAME="${APP_NAME:-$SUGGESTED}"
fi

# App URL (for redirect URI)
if [ -z "$APP_URL" ]; then
  # Try to read BETTER_AUTH_URL from .env.local or .env.example
  if [ -f "$ENV_FILE" ]; then
    STORED_URL=$(grep '^BETTER_AUTH_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  fi
  if [ -z "${STORED_URL:-}" ] && [ -f ".env.example" ]; then
    STORED_URL=$(grep '^BETTER_AUTH_URL=' ".env.example" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  fi
  SUGGESTED_URL="${STORED_URL:-http://localhost:3000}"
  read -rp "$(echo -e "${CYAN}App URL (used for redirect URI) [${SUGGESTED_URL}]: ${NC}")" APP_URL
  APP_URL="${APP_URL:-$SUGGESTED_URL}"
fi

REDIRECT_URI="${APP_URL}/api/auth/callback/microsoft"

echo ""
info "Creating app registration:"
echo "   Display name : $APP_NAME SSO"
echo "   Redirect URI : $REDIRECT_URI"
echo "   Audience     : Personal + work/school accounts (AzureADandPersonalMicrosoftAccount)"
echo ""

# ---------------------------------------------------------------------------
# 4. Create app registration
# ---------------------------------------------------------------------------

info "Creating Azure AD app registration..."
APP_JSON=$(az ad app create \
  --display-name "${APP_NAME} SSO" \
  --sign-in-audience AzureADandPersonalMicrosoftAccount \
  --web-redirect-uris "$REDIRECT_URI" \
  -o json)

APP_ID=$(echo "$APP_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['appId'])" 2>/dev/null \
  || echo "$APP_JSON" | grep '"appId"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

success "App registered: $APP_ID"

# ---------------------------------------------------------------------------
# 5. Create client secret (2-year expiry)
# ---------------------------------------------------------------------------

info "Generating client secret (2-year expiry)..."
SECRET_JSON=$(az ad app credential reset \
  --id "$APP_ID" \
  --years 2 \
  -o json)

CLIENT_SECRET=$(echo "$SECRET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])" 2>/dev/null \
  || echo "$SECRET_JSON" | grep '"password"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

success "Client secret generated (expires in 2 years)"

# ---------------------------------------------------------------------------
# 6. Output / write
# ---------------------------------------------------------------------------

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║            Credentials                   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "MICROSOFT_CLIENT_ID=${APP_ID}"
echo "MICROSOFT_CLIENT_SECRET=${CLIENT_SECRET:0:8}…  (full value written to ${ENV_FILE})"
echo "MICROSOFT_TENANT_ID=common"
echo ""

if [ "$PRINT_ONLY" = true ]; then
  warn "--print-only: credentials NOT written to ${ENV_FILE}. Add them manually."
  echo "MICROSOFT_CLIENT_SECRET=${CLIENT_SECRET}"
else
  info "Writing to ${ENV_FILE}..."
  upsert_env "$ENV_FILE" "MICROSOFT_CLIENT_ID"     "$APP_ID"
  upsert_env "$ENV_FILE" "MICROSOFT_CLIENT_SECRET"  "$CLIENT_SECRET"
  upsert_env "$ENV_FILE" "MICROSOFT_TENANT_ID"      "common"
  success "Written to ${ENV_FILE}"
fi

echo ""
success "Done! Restart your dev server to pick up the new env vars:"
echo "   npm run dev"
echo ""
warn "Note: The client secret expires in 2 years. Set a reminder to rotate it."
echo "   Azure portal: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Credentials/appId/${APP_ID}"
echo ""
