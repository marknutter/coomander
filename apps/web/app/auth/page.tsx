"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// SVG icons for social providers
// ---------------------------------------------------------------------------

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Social provider config — add/remove providers here
// ---------------------------------------------------------------------------

type SocialProvider = "google" | "github" | "apple" | "facebook";

const SOCIAL_PROVIDERS: Array<{
  id: SocialProvider;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "google",    label: "Google",    icon: <GoogleIcon /> },
  { id: "apple",     label: "Apple",     icon: <AppleIcon /> },
  { id: "github",    label: "GitHub",    icon: <GitHubIcon /> },
  { id: "facebook",  label: "Facebook",  icon: <FacebookIcon /> },
];

// ---------------------------------------------------------------------------
// Auth form
// ---------------------------------------------------------------------------

const WAITLIST_MODE = process.env.NEXT_PUBLIC_WAITLIST_MODE === "true";

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "signup") setTab("signup");
    else setTab("login");

    const invite = searchParams.get("invite");
    if (invite) {
      setInviteCode(invite);
      setTab("signup");
    }

    const errorParam = searchParams.get("error");
    if (errorParam) {
      setError("Authentication failed. Please try again.");
    }
  }, [searchParams]);

  const switchTab = (newTab: string) => {
    const t = newTab as "login" | "signup";
    setTab(t);
    setError(null);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setInviteCode("");
    setMfaRequired(false);
    setMfaCode("");
    router.replace(`/auth?tab=${t}`);
  };

  const handleSocialSignIn = async (provider: SocialProvider) => {
    setSocialLoading(provider);
    setError(null);
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: "/app",
      });
    } catch {
      setError(`${SOCIAL_PROVIDERS.find((p) => p.id === provider)?.label ?? provider} sign-in failed. Please try again.`);
      setSocialLoading(null);
    }
  };

  const handleMfaVerify = async () => {
    if (mfaCode.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const { error: mfaError } = await authClient.twoFactor.verifyTotp({
        code: mfaCode,
      });
      if (mfaError) {
        setError(mfaError.message || "Invalid code");
      } else {
        router.push("/app");
      }
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (tab === "signup") {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }

      // In waitlist mode, require and validate invite code before signup
      if (WAITLIST_MODE) {
        if (!inviteCode.trim()) {
          setError("An invite code is required to sign up");
          return;
        }
        setLoading(true);
        try {
          const valRes = await fetch(`/api/waitlist/validate-invite?code=${encodeURIComponent(inviteCode.trim())}`);
          const valJson = await valRes.json();
          if (!valJson.valid) {
            setError(valJson.reason || "Invalid invite code");
            setLoading(false);
            return;
          }
          if (valJson.lockedToEmail && valJson.lockedToEmail.toLowerCase() !== email.toLowerCase()) {
            setError("This invite code is not valid for your email address");
            setLoading(false);
            return;
          }
        } catch {
          setError("Could not validate invite code. Please try again.");
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      try {
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name: email.split("@")[0],
        });

        if (signUpError) {
          setError(signUpError.message || "Something went wrong");
        } else {
          // Redeem invite code after successful signup (fire-and-forget)
          if (WAITLIST_MODE && inviteCode.trim()) {
            fetch("/api/waitlist/redeem-invite", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: inviteCode.trim() }),
            }).catch(() => {});
          }
          router.push("/app");
        }
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(true);
      try {
        const { data, error: signInError } = await authClient.signIn.email({
          email,
          password,
        });

        if (signInError) {
          setError(signInError.message || "Invalid email or password");
        } else if ((data as Record<string, unknown>)?.twoFactorRedirect) {
          setMfaRequired(true);
        } else {
          router.push("/app");
        }
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }
  };

  // MFA verification step
  if (mfaRequired) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4">
        <div className="flex items-center justify-center mb-8">
          <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">Coomander</span>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 w-full max-w-sm p-8">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Two-Factor Authentication</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Enter the 6-digit code from your authenticator app.
          </p>

          <input
            type="text"
            placeholder="000000"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-lg px-3 py-3 text-sm text-gray-900 dark:text-gray-100 text-center text-xl tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 mb-4"
            maxLength={6}
            autoFocus
          />

          {error && (
            <div className="mb-4">
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          <Button
            variant="primary"
            loading={loading}
            disabled={mfaCode.length !== 6}
            onClick={handleMfaVerify}
            className="w-full bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500"
          >
            Verify
          </Button>

          <button
            onClick={() => { setMfaRequired(false); setMfaCode(""); setError(null); }}
            className="w-full mt-3 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="flex items-center justify-center mb-8">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">Coomander</span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 w-full max-w-sm p-8">
        {/* Tabs */}
        <Tabs
          tabs={[
            { key: "login", label: "Sign In" },
            { key: "signup", label: "Sign Up" },
          ]}
          activeTab={tab}
          onTabChange={switchTab}
          className="mb-6"
        />

        {/* Social sign-in buttons — 2-column grid, last item spans full width if odd count */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          {SOCIAL_PROVIDERS.map((provider, i) => {
            const isLast = i === SOCIAL_PROVIDERS.length - 1;
            const isOddTotal = SOCIAL_PROVIDERS.length % 2 !== 0;
            return (
              <button
                key={provider.id}
                onClick={() => handleSocialSignIn(provider.id)}
                disabled={socialLoading !== null}
                className={[
                  "flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg py-2.5 px-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                  isLast && isOddTotal ? "col-span-2" : "",
                ].join(" ")}
              >
                {socialLoading === provider.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {provider.icon}
                    <span>{provider.label}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">Or continue with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="focus:ring-violet-500"
          />

          <Input
            label="Password"
            type="password"
            required
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tab === "signup" ? "At least 8 characters" : "Your password"}
            className="focus:ring-violet-500"
          />

          <TabPanel active={tab === "signup"}>
            <Input
              label="Confirm Password"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
              className="focus:ring-violet-500"
            />
            {WAITLIST_MODE && (
              <div className="mt-4">
                <Input
                  label="Invite Code"
                  type="text"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter your invite code"
                  className="focus:ring-violet-500"
                />
              </div>
            )}
          </TabPanel>

          {tab === "login" && (
            <div className="text-right">
              <a href="/forgot-password" className="text-xs text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300">
                Forgot password?
              </a>
            </div>
          )}

          {error && <Alert variant="error">{error}</Alert>}

          <Button
            type="submit"
            loading={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500"
          >
            {tab === "login" ? "Sign In" : "Create Account"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Skeleton circle width="w-8" height="h-8" />
      </div>
    }>
      <AuthForm />
    </Suspense>
  );
}
