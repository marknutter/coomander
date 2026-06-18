import type { Metadata } from "next";
import Link from "next/link";
import { Sprout } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { getChangelog } from "@/lib/mdx";
import { mdxComponents } from "@/components/mdx-components";

export const metadata: Metadata = {
  title: "Changelog",
  description: "See what's new in Coomander — features, improvements, and fixes.",
};

export default function ChangelogPage() {
  const changelog = getChangelog();

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <Sprout className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
            <span className="font-bold text-gray-900 dark:text-gray-100">
              Coomander
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/blog"
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Blog
            </Link>
            <Link
              href="/changelog"
              className="font-medium text-primary"
            >
              Changelog
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight mb-4">
            Changelog
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
            See what&apos;s new in Coomander — features, improvements, and fixes.
          </p>
        </div>
      </section>

      {/* Changelog content */}
      <section className="pb-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="prose-custom">
            <MDXRemote
              source={changelog.content}
              components={mdxComponents}
              options={{
                mdxOptions: {
                  remarkPlugins: [remarkGfm],
                },
              }}
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 dark:border-gray-800 py-8 text-center">
        <Link
          href="/"
          className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
        >
          &larr; Back to Coomander
        </Link>
      </footer>
    </div>
  );
}
