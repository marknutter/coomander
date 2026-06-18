import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * Dashboard loading skeleton.
 * Matches the layout of /app page: header + banner + welcome card + content cards.
 */
export default function AppLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header skeleton */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton circle width="w-6" height="h-6" />
            <Skeleton width="w-20" height="h-5" />
          </div>
          <div className="flex items-center gap-4">
            <Skeleton width="w-32" height="h-4" className="hidden sm:block" />
            <Skeleton circle width="w-4" height="h-4" />
            <Skeleton circle width="w-4" height="h-4" />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Banner skeleton */}
        <Skeleton width="w-full" height="h-12" className="rounded-xl" />

        {/* Welcome card skeleton */}
        <SkeletonCard />

        {/* Content card skeleton */}
        <SkeletonCard />

        {/* Placeholder card skeleton */}
        <SkeletonCard />
      </main>
    </div>
  );
}
