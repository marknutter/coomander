"use client";

/**
 * Renders an `[IMAGE:{…}]` rich block (#222 follow-up).
 *
 * Receives the raw JSON from the marker (shape: `{ key, alt }`, where `key` is
 * the auth-scoped R2 object key for a generated image). We parse + validate it
 * (throwing on anything malformed so the BlockErrorBoundary in chat-blocks.tsx
 * shows the fallback) and render a constrained `<img>` served from the auth-gated
 * `/api/images/<key>` route. The key may contain slashes, so each segment is
 * URL-encoded but the `/` separators are preserved (the GET route is a
 * catch-all, so the path segments reassemble into the original key).
 */
export function ChatImage({ json }: { json: string }) {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("ChatImage: payload is not an object");
  }
  const { key, alt } = parsed as { key?: unknown; alt?: unknown };
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("ChatImage: missing image key");
  }
  const altText = typeof alt === "string" && alt.length > 0 ? alt : "Generated image";

  const src = `/api/images/${key.split("/").map(encodeURIComponent).join("/")}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={altText}
      loading="lazy"
      className="my-2 max-w-sm w-full max-h-96 rounded-lg object-contain border border-gray-200 dark:border-gray-700"
    />
  );
}
