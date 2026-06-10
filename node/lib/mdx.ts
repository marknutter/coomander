import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";

const BLOG_DIR = path.join(process.cwd(), "content/blog");
const CHANGELOG_PATH = path.join(process.cwd(), "content/changelog/changelog.mdx");

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  author: string;
  tags: string[];
  published: boolean;
  readingTime: string;
  content: string;
}

export interface ChangelogEntry {
  content: string;
}

/**
 * Get all published blog posts, sorted by date (newest first).
 */
export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".mdx"));

  const posts = files
    .map((file) => {
      const slug = file.replace(/\.mdx$/, "");
      const raw = fs.readFileSync(path.join(BLOG_DIR, file), "utf-8");
      const { data, content } = matter(raw);

      return {
        slug,
        title: data.title || slug,
        date: data.date || "",
        excerpt: data.excerpt || "",
        author: data.author || "The Coomander Team",
        tags: data.tags || [],
        published: data.published !== false,
        readingTime: readingTime(content).text,
        content,
      } satisfies BlogPost;
    })
    .filter((post) => post.published)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return posts;
}

/**
 * Get a single blog post by slug.
 */
export function getPostBySlug(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  if (data.published === false) return null;

  return {
    slug,
    title: data.title || slug,
    date: data.date || "",
    excerpt: data.excerpt || "",
    author: data.author || "The Coomander Team",
    tags: data.tags || [],
    published: true,
    readingTime: readingTime(content).text,
    content,
  };
}

/**
 * Get all unique tags from published posts.
 */
export function getAllTags(): string[] {
  const posts = getAllPosts();
  const tagSet = new Set<string>();
  posts.forEach((post) => post.tags.forEach((tag) => tagSet.add(tag)));
  return Array.from(tagSet).sort();
}

/**
 * Get the raw changelog content.
 */
export function getChangelog(): ChangelogEntry {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    return { content: "No changelog entries yet." };
  }

  const raw = fs.readFileSync(CHANGELOG_PATH, "utf-8");
  const { content } = matter(raw);
  return { content };
}
