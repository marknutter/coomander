import { devDocsSource } from "@/lib/dev-docs-source";
import { WikiSidebar } from "@/components/admin/wiki-sidebar";
import type { ReactNode } from "react";

export default function WikiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-6 w-full -m-6 lg:-m-8">
      <WikiSidebar tree={devDocsSource.pageTree} />
      <div className="flex-1 min-w-0 py-6 pr-6 lg:py-8 lg:pr-8">
        {children}
      </div>
    </div>
  );
}
