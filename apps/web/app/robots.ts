import type { MetadataRoute } from "next";

/**
 * Robots.txt directives for search engine crawlers.
 * Blocks authenticated routes and API endpoints from indexing.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.BETTER_AUTH_URL || "https://coomander.example.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app/", "/settings/", "/api/", "/verify-email/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
