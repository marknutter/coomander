"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

type Status = "pending" | "success" | "error";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("pending");
  const [message, setMessage] = useState("Verifying your email\u2026");

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setStatus("error");
      setMessage("No verification token found in the URL.");
      return;
    }

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      redirect: "follow",
    })
      .then(async (res) => {
        if (res.ok || res.redirected) {
          setStatus("success");
          setMessage("Email verified! Redirecting\u2026");
          setTimeout(() => router.push("/app"), 2500);
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus("error");
          setMessage(data?.error || "This link is invalid or has expired.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      });
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-10 max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-accent mb-6">
          <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        {status === "pending" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Verifying your email</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">{message}</p>
            <div className="mt-6 flex justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Email verified!</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">{message}</p>
            <div className="mt-6 flex justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Verification failed</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">{message}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Need a new link?{" "}
              <a href="/auth" className="text-primary hover:underline font-medium">Sign in to resend</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Skeleton circle width="w-6" height="h-6" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
