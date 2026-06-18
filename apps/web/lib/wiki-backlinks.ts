import { devDocsSource } from "./dev-docs-source";

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

interface BacklinkEntry {
  title: string;
  url: string;
}

let cachedBacklinks: Map<string, BacklinkEntry[]> | null = null;

/**
 * Build a reverse index of [[wiki-links]] across all dev wiki pages.
 * For each page, returns which other pages link to it.
 */
async function buildBacklinkIndex(): Promise<Map<string, BacklinkEntry[]>> {
  const index = new Map<string, BacklinkEntry[]>();
  const pages = devDocsSource.getPages();

  for (const page of pages) {
    const rawContent = await page.data.getText("raw");
    const matches = rawContent.matchAll(WIKI_LINK_RE);

    for (const match of matches) {
      const targetSlug = match[1].toLowerCase().replace(/\s+/g, "-");
      const existing = index.get(targetSlug) || [];
      // Avoid duplicate backlinks from the same page
      if (!existing.some((e) => e.url === page.url)) {
        existing.push({
          title: page.data.title ?? "Untitled",
          url: page.url,
        });
      }
      index.set(targetSlug, existing);
    }
  }

  return index;
}

/**
 * Get all pages that link to the given slug via [[wiki-links]].
 */
export async function getBacklinks(slug: string): Promise<BacklinkEntry[]> {
  if (!cachedBacklinks) {
    cachedBacklinks = await buildBacklinkIndex();
  }
  return cachedBacklinks.get(slug) || [];
}

/**
 * Clear the backlink cache (useful during development).
 */
export function clearBacklinkCache(): void {
  cachedBacklinks = null;
}
