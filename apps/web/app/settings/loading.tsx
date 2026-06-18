import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * Settings page loading skeleton.
 * Matches the layout of /settings page: header + 4 setting cards.
 */
export default function SettingsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header skeleton */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton circle width="w-4" height="h-4" />
            <Skeleton circle width="w-5" height="h-5" />
            <Skeleton width="w-20" height="h-5" />
          </div>
          <Skeleton width="w-16" height="h-4" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Account card */}
        <SkeletonCard />

        {/* Subscription card */}
        <SkeletonCard />

        {/* Security card */}
        <SkeletonCard />

        {/* Data & Privacy card */}
        <SkeletonCard />
      </main>
    </div>
  );
}
