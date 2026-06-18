"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";

interface BlogPost {
  id?: number;
  title: string;
  slug: string;
  content: string;
  status: "draft" | "published";
  tags?: string[];
}

interface BlogEditorProps {
  post?: BlogPost;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export function BlogEditor({ post }: BlogEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [tags, setTags] = useState(post?.tags?.join(", ") ?? "");
  const [status, setStatus] = useState<"draft" | "published">(post?.status ?? "draft");
  const slugManuallyEdited = useRef(!!post?.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const easymdeRef = useRef<any>(null);
  const editorInitialized = useRef(false);

  // Dynamically load EasyMDE in useEffect (not SSR-safe)
  useEffect(() => {
    if (editorInitialized.current || !textareaRef.current) return;
    editorInitialized.current = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let instance: any = null;

    (async () => {
      const EasyMDE = (await import("easymde")).default;

      // Inject EasyMDE CSS if not already present
      if (!document.getElementById("easymde-css")) {
        const link = document.createElement("link");
        link.id = "easymde-css";
        link.rel = "stylesheet";
        link.href = "https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css";
        document.head.appendChild(link);
      }

      if (!textareaRef.current) return;

      instance = new EasyMDE({
        element: textareaRef.current,
        initialValue: post?.content ?? "",
        spellChecker: false,
        autofocus: false,
        status: false,
        minHeight: "300px",
        toolbar: [
          "bold",
          "italic",
          "heading",
          "|",
          "quote",
          "unordered-list",
          "ordered-list",
          "|",
          "link",
          "image",
          "code",
          "|",
          "preview",
          "side-by-side",
          "fullscreen",
          "|",
          "guide",
        ],
      });

      easymdeRef.current = instance;
    })();

    return () => {
      if (instance) {
        instance.toTextArea();
        instance = null;
        easymdeRef.current = null;
        editorInitialized.current = false;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!slugManuallyEdited.current) {
      setSlug(slugify(title));
    }
  }, [title]);

  const getContent = useCallback((): string => {
    if (easymdeRef.current) {
      return easymdeRef.current.value();
    }
    return "";
  }, []);

  async function handlePreview() {
    const content = getContent();
    if (!content.trim()) {
      setError("Write some content before previewing.");
      return;
    }

    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/blog/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      setPreviewHtml(json.html);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  function parseTags(input: string): string[] {
    return input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const content = getContent();

    if (!title.trim() || !slug.trim() || !content.trim()) {
      setError("Title, slug, and content are required.");
      return;
    }

    setSaving(true);
    try {
      const url = post?.id ? `/api/admin/blog/${post.id}` : "/api/admin/blog";
      const method = post?.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          slug,
          content,
          status,
          tags: parseTags(tags),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save post");

      setSuccess(post?.id ? "Post updated." : "Post created.");
      if (!post?.id) {
        router.push("/admin/crm");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Post title"
          className="w-full border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Slug</label>
        <input
          type="text"
          value={slug}
          onChange={(e) => {
            slugManuallyEdited.current = true;
            setSlug(e.target.value);
          }}
          placeholder="url-friendly-slug"
          className="w-full border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm font-mono bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring"
          required
        />
        <p className="text-xs text-zinc-400">Auto-generated from title. Edit to override.</p>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags</label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="tag1, tag2, tag3"
          className="w-full border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-zinc-400">Comma-separated list of tags.</p>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Content</label>
        <textarea
          ref={textareaRef}
          defaultValue={post?.content ?? ""}
          placeholder="Write your post content here (Markdown supported)..."
          rows={16}
          className="w-full border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm font-mono bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Status</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStatus("draft")}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              status === "draft"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}
          >
            Draft
          </button>
          <button
            type="button"
            onClick={() => setStatus("published")}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              status === "published"
                ? "bg-primary text-white border-primary"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}
          >
            Published
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-md transition-colors"
        >
          {saving ? "Saving..." : post?.id ? "Update Post" : "Create Post"}
        </button>
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewing}
          className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
        >
          {previewing ? "Loading..." : "Preview"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/crm")}
          className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          Cancel
        </button>
      </div>

      {previewHtml && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Preview</h3>
            <button
              type="button"
              onClick={() => setPreviewHtml(null)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              Close preview
            </button>
          </div>
          {/* Preview HTML is generated server-side from admin's own markdown content via authenticated endpoint */}
          <div
            className="prose dark:prose-invert max-w-none border border-zinc-200 dark:border-zinc-700 rounded-md p-4 bg-white dark:bg-zinc-900"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      )}
    </form>
  );
}
