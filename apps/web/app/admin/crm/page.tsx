"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SubscriberList } from "@/components/admin/subscriber-list";
import { Alert } from "@/components/ui/alert";

type Tab = "subscribers" | "blog";

interface BlogPost {
  id: number;
  title: string;
  slug: string;
  status: string;
  author_email: string | null;
  published_at: string | null;
  created_at: string;
}

function BlogList() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const res = await fetch(`/api/admin/blog?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load posts");
      setPosts(json.data);
      setTotal(json.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  async function deletePost(id: number, title: string) {
    if (!confirm(`Delete post "${title}"?`)) return;
    const res = await fetch(`/api/admin/blog/${id}`, { method: "DELETE" });
    if (res.ok) fetchPosts();
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{total} posts</span>
        <Link
          href="/admin/crm/blog"
          className="px-3 py-2 text-sm font-medium bg-primary hover:bg-primary/90 text-white rounded-md transition-colors"
        >
          New Post
        </Link>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Title</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Slug</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Status</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Author</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Date</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">Loading...</td>
              </tr>
            ) : posts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">No blog posts yet. Create your first post.</td>
              </tr>
            ) : (
              posts.map((post) => (
                <tr key={post.id} className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 max-w-xs truncate">
                    {post.title}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 font-mono text-xs max-w-xs truncate">
                    {post.slug}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      post.status === "published"
                        ? "bg-accent text-primary "
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}>
                      {post.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 text-xs">
                    {post.author_email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 text-xs">
                    {new Date(post.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/crm/blog?id=${post.id}`}
                        className="text-xs text-primary hover:text-primary/80 dark:hover:text-primary/80 transition-colors"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => deletePost(post.id, post.title)}
                        className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-xs border border-zinc-300 dark:border-zinc-700 rounded-md disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-xs border border-zinc-300 dark:border-zinc-700 rounded-md disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default function CrmPage() {
  const [activeTab, setActiveTab] = useState<Tab>("subscribers");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">CRM</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Manage newsletter subscribers and blog posts.
        </p>
      </div>

      <div className="flex border-b border-zinc-200 dark:border-zinc-800 gap-1">
        {(["subscribers", "blog"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {tab === "subscribers" ? "Subscribers" : "Blog Posts"}
          </button>
        ))}
      </div>

      {activeTab === "subscribers" && <SubscriberList />}
      {activeTab === "blog" && <BlogList />}
    </div>
  );
}
