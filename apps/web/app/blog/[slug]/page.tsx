import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Sprout, Calendar, Clock, ArrowLeft, Tag } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { getAllPosts, getPostBySlug } from "@/lib/mdx";
import { mdxComponents, Callout } from "@/components/mdx-components";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = getAllPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Post Not Found" };

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

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

      {/* Article */}
      <article className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Back link */}
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors mb-8"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to blog
          </Link>

          {/* Post header */}
          <header className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight mb-4">
              {post.title}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400 dark:text-gray-500">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {new Date(post.date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                {post.readingTime}
              </span>
              {post.tags.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <Tag className="w-4 h-4" />
                  {post.tags.join(", ")}
                </span>
              )}
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              By {post.author}
            </p>
          </header>

          {/* MDX content */}
          <div className="prose-custom">
            <MDXRemote
              source={post.content}
              components={{ ...mdxComponents, Callout }}
              options={{
                mdxOptions: {
                  remarkPlugins: [remarkGfm],
                },
              }}
            />
          </div>

          {/* Post footer */}
          <footer className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
            <Link
              href="/blog"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              All posts
            </Link>
          </footer>
        </div>
      </article>
    </div>
  );
}
