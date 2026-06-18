import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs/guide",
});

export const devDocs = defineDocs({
  dir: "content/docs/dev",
});

export default defineConfig();
