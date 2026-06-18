"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Users } from "lucide-react";

export function WaitlistSignup() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [position, setPosition] = useState<number | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Check for referral code in URL
  const [refCode, setRefCode] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) setRefCode(ref);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, referralCode: refCode }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(json.error ?? "Something went wrong. Please try again.");
      } else {
        setStatus("success");
        setPosition(json.position);
        if (json.referralCode) {
          setReferralLink(`${window.location.origin}?ref=${json.referralCode}`);
        }
        setEmail("");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  function handleCopy() {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="py-20 sm:py-28 bg-accent/20">
      <div className="max-w-xl mx-auto px-4 sm:px-6 text-center">
        <div className="inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs font-medium px-3 py-1.5 rounded-full mb-6">
          <Users className="w-3.5 h-3.5" />
          Early Access
        </div>

        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight mb-3">
          Join the waitlist
        </h2>
        <p className="text-lg text-gray-500 dark:text-gray-400 mb-8">
          We&apos;re launching soon. Sign up to get early access and be the first to know when we go live.
        </p>

        {status === "success" ? (
          <div className="space-y-4">
            <p className="text-primary font-medium text-lg">
              You&apos;re on the list!
              {position && (
                <span className="block text-sm mt-1 text-gray-500 dark:text-gray-400">
                  You&apos;re #{position} in line
                </span>
              )}
            </p>

            {referralLink && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left max-w-md mx-auto">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Share your referral link to move up the list:
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={referralLink}
                    className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800 truncate"
                  />
                  <button
                    onClick={handleCopy}
                    className="shrink-0 p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-primary" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="flex-1 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:placeholder-gray-500"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="bg-primary hover:bg-primary/90 disabled:opacity-60 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shadow-lg shadow-primary/20"
            >
              {status === "loading" ? "Joining..." : "Join Waitlist"}
            </button>
          </form>
        )}
        {status === "error" && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{message}</p>
        )}

        {refCode && status !== "success" && (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            Referred by a friend — you&apos;ll both get priority access!
          </p>
        )}
      </div>
    </section>
  );
}
