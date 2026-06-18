import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Custom MDX component overrides for rich blog/changelog rendering.
 * Used by next-mdx-remote to render MDX content with styled components.
 */
export const mdxComponents: MDXComponents = {
  // Headings
  h1: ({ children, ...props }) => (
    <h1
      className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-10 mb-4 first:mt-0"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-10 mb-3 pb-2 border-b border-gray-200 dark:border-gray-700"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-3"
      {...props}
    >
      {children}
    </h3>
  ),

  // Text
  p: ({ children, ...props }) => (
    <p
      className="text-gray-600 dark:text-gray-300 leading-relaxed mb-4"
      {...props}
    >
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-gray-900 dark:text-gray-100" {...props}>
      {children}
    </strong>
  ),

  // Links
  a: ({ href, children, ...props }) => {
    const isExternal = href?.startsWith("http");
    if (isExternal) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-medium"
          {...props}
        >
          {children}
        </a>
      );
    }
    return (
      <Link
        href={href || "#"}
        className="text-primary hover:underline font-medium"
        {...props}
      >
        {children}
      </Link>
    );
  },

  // Lists
  ul: ({ children, ...props }) => (
    <ul className="list-disc list-inside space-y-1 mb-4 text-gray-600 dark:text-gray-300" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal list-inside space-y-1 mb-4 text-gray-600 dark:text-gray-300" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),

  // Code
  code: ({ children, className, ...props }) => {
    // Inline code (no language class)
    if (!className) {
      return (
        <code
          className="bg-gray-100 dark:bg-gray-800 text-primary px-1.5 py-0.5 rounded text-sm font-mono"
          {...props}
        >
          {children}
        </code>
      );
    }
    // Block code (with language class from remark)
    return (
      <code className={cn("font-mono text-sm", className)} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre
      className="bg-gray-900 dark:bg-gray-800 text-gray-100 rounded-xl p-4 overflow-x-auto mb-4 text-sm leading-relaxed border border-gray-800 dark:border-gray-700"
      {...props}
    >
      {children}
    </pre>
  ),

  // Blockquote
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-4 border-primary bg-accent pl-4 py-3 pr-4 rounded-r-lg mb-4 text-gray-600 dark:text-gray-300 italic"
      {...props}
    >
      {children}
    </blockquote>
  ),

  // Table
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border-collapse" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-gray-50 dark:bg-gray-800" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }) => (
    <th
      className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className="px-4 py-2 text-gray-600 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800"
      {...props}
    >
      {children}
    </td>
  ),

  // Horizontal rule
  hr: (props) => (
    <hr className="my-8 border-gray-200 dark:border-gray-700" {...props} />
  ),

  // Image
  img: ({ src, alt, ...props }) => (
    <img
      src={src}
      alt={alt || ""}
      className="rounded-xl border border-gray-200 dark:border-gray-700 my-4 max-w-full"
      loading="lazy"
      {...props}
    />
  ),
};

/**
 * Callout component for use in MDX content.
 *
 * @example
 * ```mdx
 * <Callout type="info">This is an informational callout.</Callout>
 * ```
 */
export function Callout({
  type = "info",
  children,
}: {
  type?: "info" | "warning" | "tip";
  children: React.ReactNode;
}) {
  const styles = {
    info: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200",
    warning:
      "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200",
    tip: "bg-accent border-accent text-accent-foreground",
  };

  const icons = { info: "💡", warning: "⚠️", tip: "✅" };

  return (
    <div
      className={cn(
        "flex gap-3 p-4 rounded-xl border mb-4 text-sm",
        styles[type]
      )}
    >
      <span className="text-lg shrink-0">{icons[type]}</span>
      <div>{children}</div>
    </div>
  );
}
