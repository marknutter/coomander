import type { Metadata } from "next";
import Link from "next/link";
import { Sprout, Calendar, Clock, ArrowRight, Tag } from "lucide-react";
import { getAllPosts } from "@/lib/mdx";

export const metadata: Metadata = {
  title: "Blog",
  description: "Guides, tutorials, and updates from the Coomander team.",
};

export default function BlogIndex() {
  const posts = getAllPosts();

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
              className="font-medium text-primary"
            >
              Blog
            </Link>
            <Link
              href="/changelog"
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
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
            Blog
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
            Guides, tutorials, and updates from the Coomander team.
          </p>
        </div>
      </section>

      {/* Posts */}
      <section className="pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          {posts.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-400 dark:text-gray-500">
                No posts yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {posts.map((post) => (
                <article
                  key={post.slug}
                  className="group border border-gray-100 dark:border-gray-800 rounded-2xl p-6 hover:border-primary/90 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
                >
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 dark:text-gray-500 mb-3">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(post.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {post.readingTime}
                    </span>
                    {post.tags.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5" />
                        {post.tags.join(", ")}
                      </span>
                    )}
                  </div>

                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2 group-hover:text-primary/80 dark:group-hover:text-primary/80 transition-colors">
                    <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                  </h2>

                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
                    {post.excerpt}
                  </p>

                  <Link
                    href={`/blog/${post.slug}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    Read more
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </article>
              ))}
            </div>
          )}
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
