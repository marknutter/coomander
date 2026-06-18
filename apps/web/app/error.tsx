"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to an external service in production
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
        </div>

        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Something went wrong</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          An unexpected error occurred. Please try again or return to the home page.
        </p>

        {process.env.NODE_ENV === "development" && error.message && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-6 text-left">
            <p className="text-xs font-mono text-red-700 dark:text-red-300 break-all">{error.message}</p>
            {error.digest && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1">Digest: {error.digest}</p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            variant="primary"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={reset}
            className="flex-1"
          >
            Try Again
          </Button>
          <Button
            variant="secondary"
            icon={<Home className="w-4 h-4" />}
            onClick={() => window.location.href = "/"}
            className="flex-1"
          >
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}
