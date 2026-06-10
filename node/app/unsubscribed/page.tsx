import Link from "next/link";

const APP_NAME = process.env.APP_NAME || "Coomander";

export const metadata = {
  title: `Unsubscribed — ${APP_NAME}`,
};

export default function UnsubscribedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          You&apos;ve been unsubscribed
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          You will no longer receive marketing emails from {APP_NAME}.
          You&apos;ll still receive transactional emails related to your account.
        </p>
        <Link
          href="/"
          className="inline-flex text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          ← Back to {APP_NAME}
        </Link>
      </div>
    </div>
  );
}
