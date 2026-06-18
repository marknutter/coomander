"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Search, FileText, FolderOpen, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Root, Node } from "fumadocs-core/page-tree";

interface WikiSidebarProps {
  tree: Root;
}

export function WikiSidebar({ tree }: WikiSidebarProps) {
  const pathname = usePathname();
  const [filter, setFilter] = useState("");

  return (
    <div className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-lg overflow-hidden">
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
          <input
            type="text"
            placeholder="Filter pages..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <nav className="p-2 space-y-0.5 max-h-[calc(100vh-16rem)] overflow-y-auto">
        {tree.children.map((node) => (
          <TreeNode
            key={node.type === "page" ? node.url : `${node.type}-${String(node.name)}`}
            node={node}
            pathname={pathname}
            filter={filter.toLowerCase()}
          />
        ))}
      </nav>
    </div>
  );
}

function TreeNode({
  node,
  pathname,
  filter,
  depth = 0,
}: {
  node: Node;
  pathname: string;
  filter: string;
  depth?: number;
}) {
  const [isOpen, setIsOpen] = useState(true);

  if (node.type === "separator") {
    if (filter) return null;
    return (
      <div className="pt-3 pb-1 px-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {node.name}
        </span>
      </div>
    );
  }

  if (node.type === "folder") {
    const children = node.children.filter((child) => matchesFilter(child, filter));
    if (filter && children.length === 0) return null;

    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 w-full px-2 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <ChevronRight
            className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")}
          />
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && (
          <div>
            {children.map((child) => (
              <TreeNode
                key={child.type === "page" ? child.url : `${child.type}-${String(child.name)}`}
                node={child}
                pathname={pathname}
                filter={filter}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Page node
  if (filter && !String(node.name ?? "").toLowerCase().includes(filter)) return null;

  const isActive = pathname === node.url;

  return (
    <Link
      href={node.url}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-md transition-colors",
        isActive
          ? "bg-accent text-primary font-medium"
          : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{node.name}</span>
    </Link>
  );
}

function matchesFilter(node: Node, filter: string): boolean {
  if (!filter) return true;
  if (node.type === "separator") return false;
  if (node.type === "page") return String(node.name ?? "").toLowerCase().includes(filter);
  if (node.type === "folder") {
    return (
      String(node.name ?? "").toLowerCase().includes(filter) ||
      node.children.some((child) => matchesFilter(child, filter))
    );
  }
  return false;
}
