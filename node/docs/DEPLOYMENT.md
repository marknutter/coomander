# Deployment Guide

This guide covers deploying Coomander projects to local Docker (Mac mini + Caddy) and Railway cloud hosting.

## Quick Start

**Local Docker:**
```bash
docker-compose up -d --build <app-name>
```

**Railway Cloud:**
```bash
railway login
railway link
railway up
```

---

## Local Docker Deployment (Mac Mini + Caddy)

### Architecture
- **Docker:** Containerized app isolation
- **Caddy:** Reverse proxy routing `*.oqodo.com` subdomains
- **Cloudflare Tunnel:** Secure HTTPS without port forwarding

### Prerequisites
1. Docker + Docker Compose installed
2. Caddy configured as reverse proxy (port 8080)
3. Cloudflare Tunnel routing to `localhost:8080`
4. Domain with wildcard DNS: `*.oqodo.com`

### Setup Steps

#### 1. Choose Port Number
Pick an unused port (check existing ports in `docker-compose.yml`):
```bash
# Common ports in use:
3000 = hello
3001 = nyc
3002 = oqodo-main
3003 = links
3004 = month-by-month
3006 = coomander
3006 = betterdocs
3007 = holyshit
3008 = listenback
# ... pick next available
```

#### 2. Update Dockerfile
Change the port in `Dockerfile`:
```dockerfile
EXPOSE 3XXX
ENV PORT=3XXX
CMD ["node_modules/.bin/next", "start", "-p", "3XXX"]
```

#### 3. Add to docker-compose.yml
Add service entry:
```yaml
services:
  your-app-name:
    build:
      context: ./your-app-name
      dockerfile: Dockerfile
    container_name: your-app-name
    restart: unless-stopped
    ports:
      - "3XXX:3XXX"
    volumes:
      - ./your-app-name/data:/data  # Persistent SQLite storage
    environment:
      DATABASE_PATH: /data/coomander.db
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: https://yourapp.oqodo.com
      APP_URL: https://yourapp.oqodo.com
      APP_NAME: MyApp
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
      RESEND_API_KEY: ${RESEND_API_KEY}
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
      STRIPE_PRICE_ID: ${STRIPE_PRICE_ID}
      STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET}
```

#### 4. Update Caddyfile
Add routing in `~/.config/caddy/Caddyfile`:
```
yourapp.oqodo.com {
    reverse_proxy localhost:3XXX
}
```

Reload Caddy:
```bash
caddy reload --config ~/.config/caddy/Caddyfile
```

#### 5. Update OAuth Redirect URIs
Add to Google Console + GitHub OAuth App:
```
https://yourapp.oqodo.com/api/auth/callback/google
https://yourapp.oqodo.com/api/auth/callback/github
```

#### 6. Build & Deploy
```bash
cd ~/.openclaw/workspace
docker-compose up -d --build your-app-name
```

Verify:
```bash
docker ps | grep your-app-name
docker logs -f your-app-name
```

Your app is live at: `https://yourapp.oqodo.com`

---

## Railway Cloud Deployment

### Why Railway?
- Auto-deploy from git push
- Persistent volumes for SQLite
- Free tier: 500 hours/month, 500MB disk
- HTTPS + custom domains included

### Prerequisites
1. Railway account: https://railway.app
2. Railway CLI: `npm install -g @railway/cli`
3. GitHub repo for your project

### Setup Steps

#### 1. Login & Initialize
```bash
railway login
cd your-app-folder
railway init
```

Choose:
- Create new project
- Name it (e.g., "moxmo")

#### 2. Link GitHub Repo
In Railway dashboard:
- Settings → Connect GitHub repo
- Choose your repo
- Set branch: `main`

#### 3. Add Persistent Volume
In Railway dashboard:
- Go to your service
- Variables → Add Volume
- Mount path: `/data`
- Size: 500MB (free tier)

**Critical:** Volume must exist BEFORE setting `DATABASE_PATH=/data/coomander.db`

#### 4. Set Environment Variables
Via CLI:
```bash
railway variables set BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
railway variables set BETTER_AUTH_URL="https://yourapp.up.railway.app"
railway variables set APP_URL="https://yourapp.up.railway.app"
railway variables set APP_NAME="MyApp"
railway variables set DATABASE_PATH="/data/coomander.db"
railway variables set GOOGLE_CLIENT_ID="your-client-id"
railway variables set GOOGLE_CLIENT_SECRET="your-client-secret"
railway variables set GITHUB_CLIENT_ID="your-client-id"
railway variables set GITHUB_CLIENT_SECRET="your-client-secret"
railway variables set RESEND_API_KEY="re_..."
railway variables set STRIPE_SECRET_KEY="sk_test_..."
railway variables set STRIPE_PRICE_ID="price_..."
railway variables set STRIPE_WEBHOOK_SECRET="whsec_..."
```

Or via dashboard: Variables → New Variable

#### 5. Update OAuth Redirect URIs
Railway gives you a URL like: `https://yourapp-production.up.railway.app`

Add to OAuth providers:
```
https://yourapp-production.up.railway.app/api/auth/callback/google
https://yourapp-production.up.railway.app/api/auth/callback/github
```

#### 6. Deploy
Railway auto-deploys on git push:
```bash
git add .
git commit -m "Deploy to Railway"
git push origin main
```

Or manual trigger via CLI:
```bash
railway up
```

Or redeploy via CLI:
```bash
railway redeploy --yes
```

#### 7. Check Logs
```bash
railway logs
```

Or in dashboard: Deployments → View Logs

---

## Environment Variables Reference

### Required
```bash
BETTER_AUTH_SECRET=<openssl rand -base64 32>  # Secret for Better Auth sessions
BETTER_AUTH_URL=https://yourapp.com           # Better Auth base URL (same as APP_URL)
DATABASE_PATH=/data/coomander.db                # SQLite database location
APP_URL=https://yourapp.com                   # Your app's public URL
APP_NAME=MyApp                                # Display name in emails and MFA
```

### OAuth (Optional)
```bash
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
GITHUB_CLIENT_ID=<from-github-oauth-app>
GITHUB_CLIENT_SECRET=<from-github-oauth-app>
```

### Email (Optional)
```bash
RESEND_API_KEY=re_...                 # Resend transactional email
```

### Payments (Optional)
```bash
STRIPE_SECRET_KEY=sk_test_...         # Stripe API key
STRIPE_PRICE_ID=price_...            # Stripe subscription price ID
STRIPE_WEBHOOK_SECRET=whsec_...       # Stripe webhook signing secret
```

### Database Backups (Optional)
```bash
LITESTREAM_ACCESS_KEY_ID=...                          # S3/R2 access key
LITESTREAM_SECRET_ACCESS_KEY=...                      # S3/R2 secret key
LITESTREAM_REPLICA_BUCKET=my-app-backups              # Bucket name
LITESTREAM_REPLICA_PATH=db                            # Path prefix in bucket
LITESTREAM_REPLICA_ENDPOINT=https://...r2.cloudflarestorage.com  # S3-compatible endpoint (omit for AWS)
LITESTREAM_REPLICA_REGION=us-east-1                   # Bucket region
```

### Other Integrations (as needed)
```bash
OPENAI_API_KEY=sk-...                 # OpenAI API
PLAID_CLIENT_ID=...                   # Plaid bank sync
PLAID_SECRET=...                      # Plaid secret
# Add any other API keys
```

---

## Database Persistence

### Docker Volume
```yaml
volumes:
  - ./your-app/data:/data  # Maps host folder to container /data
```

Database file: `./your-app/data/coomander.db`

**Important:** The `data/` folder persists across container restarts. Back it up regularly!

### Railway Volume
1. Create volume in dashboard: Variables → Add Volume
2. Mount path: `/data`
3. Set `DATABASE_PATH=/data/coomander.db`

Volume survives redeployments. Download backups via dashboard.

---

## Database Backups (Litestream)

Litestream continuously streams SQLite WAL changes to S3-compatible storage, providing near-real-time disaster recovery with zero code changes.

### Setup

1. **Create an S3 bucket** (AWS S3, Cloudflare R2, or any S3-compatible provider like MinIO).

2. **Create access credentials** with read/write permissions to the bucket.

3. **Set the environment variables** in your `.env` or deployment config:
```bash
LITESTREAM_ACCESS_KEY_ID=your-access-key
LITESTREAM_SECRET_ACCESS_KEY=your-secret-key
LITESTREAM_REPLICA_BUCKET=my-app-backups
LITESTREAM_REPLICA_PATH=db
LITESTREAM_REPLICA_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com  # omit for AWS S3
LITESTREAM_REPLICA_REGION=us-east-1
```

4. **Start the production stack** — the Litestream sidecar starts automatically:
```bash
docker-compose up -d prod litestream
```

The `litestream` service shares the `coomander_data` volume with the `prod` service and continuously replicates the database to your bucket.

### Restore from Backup

If you need to restore the database (disaster recovery, new server, etc.):

```bash
# Set the Litestream env vars, then:
bash scripts/litestream-restore.sh ./data/restored.db

# To restore directly to the production path:
bash scripts/litestream-restore.sh ./data/coomander.db
```

The script uses Docker to run `litestream restore`, pulling the latest snapshot and WAL segments from the replica.

### Cloudflare R2 Example

R2 is a popular choice — no egress fees and S3-compatible:

```bash
LITESTREAM_ACCESS_KEY_ID=<r2-access-key>
LITESTREAM_SECRET_ACCESS_KEY=<r2-secret-key>
LITESTREAM_REPLICA_BUCKET=my-app-backups
LITESTREAM_REPLICA_PATH=db
LITESTREAM_REPLICA_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
LITESTREAM_REPLICA_REGION=auto
```

---

## Environment Validation

The container entrypoint runs `scripts/validate-env.sh` before anything else. It checks:

- `BETTER_AUTH_SECRET` is set and at least 32 characters
- `BETTER_AUTH_URL` is set and starts with `http://` or `https://`
- `DATABASE_PATH` is set

If any check fails the container exits immediately with a clear error message, preventing a half-started app with broken auth.

## Health Check Endpoint

```
GET /api/health
```

Returns `200` when healthy, `503` when degraded:

```json
{
  "ok": true,
  "db": true,
  "auth": true,
  "timestamp": "2026-03-19T12:00:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `db` | SQLite database is reachable |
| `auth` | Better Auth `user` table exists (schema was migrated) |
| `ok` | `true` only if both `db` and `auth` are healthy |

Use this endpoint for load balancer health checks and uptime monitoring.

---

## Troubleshooting

### Container exits with "Environment validation failed"
One or more required env vars are missing or invalid. Read the error output — it tells you exactly which variable failed and how to fix it.

### Health check returns `auth: false`
Better Auth migrations did not run or failed. Check container logs for migration errors. Trigger manually:
```bash
docker exec coomander-node npx @better-auth/cli@latest migrate --config lib/auth.ts
```

### Docker: "Address already in use"
Port conflict. Change port in Dockerfile + docker-compose.yml:
```bash
docker ps  # Check what's using the port
```

### Railway: "MissingSecret" Error
Missing `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` environment variable:
```bash
railway variables set BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
railway variables set BETTER_AUTH_URL="https://yourapp.up.railway.app"
```

### Railway: "SQLITE_CANTOPEN"
Database path issue. Ensure:
1. Volume exists at `/data`
2. `DATABASE_PATH=/data/coomander.db` is set
3. App has write permissions (NextJS runs as user `nextjs`)

### OAuth: "Redirect URI mismatch"
Add exact callback URL to OAuth provider:
```
https://yourapp.com/api/auth/callback/google
https://yourapp.com/api/auth/callback/github
```

No trailing slashes! Must match exactly.

### Railway: Stale Content After Deploy
Cloudflare edge cache can hold stale content 5-10 minutes.
- Hard refresh: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows)
- Or wait 10 minutes for cache to expire

### Docker: Container Won't Start
Check logs:
```bash
docker logs <container-name>
```

Common issues:
- Missing environment variables
- Port conflicts
- Database path not writable

---

## Custom Domains

### Railway
1. Settings → Domains → Add Domain
2. Point DNS A/CNAME records to Railway
3. Railway auto-provisions SSL certificate

### Local (via Cloudflare Tunnel)
Already configured for `*.oqodo.com`. Just:
1. Add subdomain to Caddyfile
2. Reload Caddy
3. Domain works immediately (wildcard DNS)

---

## Deployment Checklist

Before going live:

- [ ] Environment variables set (BETTER_AUTH_SECRET, BETTER_AUTH_URL, APP_URL, API keys)
- [ ] Database volume configured (Docker or Railway)
- [ ] OAuth redirect URIs updated (Google + GitHub)
- [ ] Stripe webhooks configured (if using payments)
- [ ] Test signup/login flows
- [ ] Test OAuth providers
- [ ] Test database persistence (restart container, data survives)
- [ ] SSL certificate working (HTTPS)
- [ ] Check logs for errors
- [ ] Litestream configured for database backups (optional but recommended)

---

## Quick Commands Reference

### Docker
```bash
# Build & start
docker-compose up -d --build <app-name>

# View logs
docker logs -f <container-name>

# Restart container
docker-compose restart <app-name>

# Stop container
docker-compose down <app-name>

# Rebuild after code changes
docker-compose up -d --build <app-name>
```

### Railway
```bash
# Login
railway login

# Link project
railway link

# Deploy
railway up

# Redeploy (force rebuild)
railway redeploy --yes

# View logs
railway logs

# Set env var
railway variables set KEY=value

# Open dashboard
railway open
```

### Caddy
```bash
# Reload config
caddy reload --config ~/.config/caddy/Caddyfile

# Check config syntax
caddy validate --config ~/.config/caddy/Caddyfile

# View logs
tail -f /var/log/caddy/access.log
```

---

## Next Steps

- **Production secrets:** Use separate secrets for production vs development
- **Monitoring:** Set up uptime monitoring (UptimeRobot, Better Uptime)
- **Backups:** Configure Litestream for continuous SQLite replication (see "Database Backups" section above)
- **Staging env:** Create separate Railway project for testing
- **CI/CD:** GitHub Actions for automated tests before deploy

---

Built from real-world deployment experience.
