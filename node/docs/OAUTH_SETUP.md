# OAuth Setup Guide

Coomander includes Google and GitHub OAuth via Better Auth.

## Features

- Email/password authentication
- Google OAuth ("Continue with Google")
- GitHub OAuth ("Continue with GitHub")
- Automatic account linking (same email = linked accounts)
- Automatic user creation on first OAuth sign-in
- Session management via Better Auth (httpOnly cookies)
- Two-factor authentication (TOTP + backup codes)
- Proxy-safe (works behind Caddy/Nginx)

## Quick Start

### 1. Set up Google OAuth

1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth client ID (Web application)
3. Add redirect URI: `https://yourdomain.com/api/auth/callback/google`
4. Copy Client ID and Client Secret
5. Add to docker-compose.yml or .env:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

### 2. Set up GitHub OAuth

1. Go to https://github.com/settings/developers
2. Create new OAuth App
3. Homepage URL: `https://yourdomain.com`
4. Authorization callback URL: `https://yourdomain.com/api/auth/callback/github`
5. Copy Client ID and Client Secret
6. Add to docker-compose.yml or .env:
   ```
   GITHUB_CLIENT_ID=your-client-id
   GITHUB_CLIENT_SECRET=your-client-secret
   ```

### 3. Update URLs

In docker-compose.yml or .env:
```
APP_URL=https://yourdomain.com
BETTER_AUTH_URL=https://yourdomain.com
```

### 4. Deploy

```bash
docker-compose up -d --build
```

## How It Works

### Auth Flow

1. User clicks "Continue with Google" or "Continue with GitHub"
2. Better Auth redirects to OAuth provider
3. User authorizes the app
4. Provider redirects back to `/api/auth/callback/{provider}`
5. Better Auth:
   - Checks if user exists (by email)
   - Creates new user if first sign-in
   - Links account if email already exists (account linking)
   - Creates session
6. User is redirected to `/app`

### Database

Better Auth manages its own tables:
- `user` — user profiles with custom fields (plan, stripeCustomerId, etc.)
- `account` — OAuth provider accounts linked to users
- `session` — active sessions
- `verification` — email verification and password reset tokens
- `twoFactor` — TOTP secrets and backup codes

### Session Management

Sessions use httpOnly cookies managed by Better Auth:
- `better-auth.session_token` (httpOnly, secure in production)
- Session data validated server-side via `auth.api.getSession()`
- Middleware uses `getSessionCookie()` for optimistic route protection

## Files

- `lib/auth.ts` — Better Auth server configuration (providers, plugins, hooks)
- `lib/auth-client.ts` — Better Auth client instance (for React components)
- `app/api/auth/[...all]/route.ts` — Catch-all route handler for all auth endpoints
- `app/auth/page.tsx` — Login page with OAuth buttons and inline MFA

## Adding More Providers

Better Auth supports many OAuth providers. To add more:

1. Add provider to `socialProviders` in `lib/auth.ts`:
   ```typescript
   socialProviders: {
     // ... existing providers
     microsoft: {
       clientId: process.env.MICROSOFT_CLIENT_ID || "",
       clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
     },
   }
   ```

2. Add button to `app/auth/page.tsx`:
   ```typescript
   await authClient.signIn.social({ provider: "microsoft", callbackURL: "/app" });
   ```

3. Set up OAuth app with provider and add credentials to .env

4. Add provider to `trustedProviders` in account linking config if desired

## Troubleshooting

### redirect_uri_mismatch

Make sure the redirect URI in your OAuth app settings exactly matches:
```
https://yourdomain.com/api/auth/callback/{provider}
```

### Session not persisting

Check that `BETTER_AUTH_URL` and `APP_URL` environment variables are set correctly.

### No email from GitHub

Better Auth requests the `user:email` scope from GitHub automatically.

## Security Notes

- Never commit OAuth credentials to git
- Use environment variables for all secrets
- `BETTER_AUTH_SECRET` should be a random 32+ character string (generate with `openssl rand -base64 32`)
- In production, cookies are automatically set to `secure: true`
- Security headers (X-Frame-Options, etc.) are configured in `next.config.ts`

## Resources

- [Better Auth Documentation](https://www.better-auth.com)
- [Google OAuth Setup](https://console.cloud.google.com)
- [GitHub OAuth Apps](https://github.com/settings/developers)
