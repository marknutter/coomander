import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { docsSource } from "@/lib/docs-source";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{ attribute: "class", storageKey: "coomander-theme" }}
      search={{ options: { api: "/api/docs-search" } }}
    >
      <DocsLayout
        tree={docsSource.pageTree}
        nav={{ title: "Coomander Docs" }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
