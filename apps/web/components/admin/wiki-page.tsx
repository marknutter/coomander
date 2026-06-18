import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import type { TableOfContents } from "fumadocs-core/toc";

interface BacklinkEntry {
  title: string;
  url: string;
}

interface WikiPageProps {
  title: string;
  description?: string;
  toc: TableOfContents;
  backlinks: BacklinkEntry[];
  children: ReactNode;
}

export function WikiPage({
  title,
  description,
  toc,
  backlinks,
  children,
}: WikiPageProps) {
  return (
    <div className="flex gap-8 w-full max-w-6xl">
      {/* Main content */}
      <article className="flex-1 min-w-0">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {title}
          </h1>
          {description && (
            <p className="mt-2 text-lg text-zinc-500 dark:text-zinc-400">
              {description}
            </p>
          )}
        </header>

        <div className="prose prose-zinc dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-a:text-primary prose-code:before:content-none prose-code:after:content-none prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm">
          {children}
        </div>

        {/* Backlinks */}
        {backlinks.length > 0 && (
          <div className="mt-12 pt-6 border-t border-zinc-200 dark:border-zinc-800">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
              Linked from
            </h2>
            <div className="flex flex-wrap gap-2">
              {backlinks.map((link) => (
                <Link
                  key={link.url}
                  href={link.url}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-primary/90 hover:text-primary/80 dark:hover:bg-primary/90 dark:hover:text-primary/80 transition-colors"
                >
                  {link.title}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>

      {/* Table of contents */}
      {toc.length > 0 && (
        <aside className="hidden xl:block w-48 shrink-0">
          <div className="sticky top-8">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
              On this page
            </h3>
            <nav className="space-y-1">
              {toc.map((item) => (
                <a
                  key={item.url}
                  href={item.url}
                  className="block text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors truncate"
                  style={{ paddingLeft: `${(item.depth - 2) * 12}px` }}
                >
                  {item.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      )}
    </div>
  );
}
