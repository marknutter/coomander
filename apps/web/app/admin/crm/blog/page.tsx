"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { BlogEditor } from "@/components/admin/blog-editor";
import { Alert } from "@/components/ui/alert";

interface BlogPost {
  id: number;
  title: string;
  slug: string;
  content: string;
  status: "draft" | "published";
}

function BlogEditorLoader() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/admin/blog/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setPost(json.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="text-sm text-zinc-400">Loading post...</div>;
  }

  if (error) {
    return <Alert variant="error">{error}</Alert>;
  }

  return <BlogEditor post={post ?? undefined} />;
}

export default function BlogEditorPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/crm"
          className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
          CRM
        </Link>
        <span className="text-zinc-400">/</span>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Blog Post</h1>
      </div>

      <Suspense fallback={<div className="text-sm text-zinc-400">Loading...</div>}>
        <BlogEditorLoader />
      </Suspense>
    </div>
  );
}
