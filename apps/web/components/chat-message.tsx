"use client";

import { useMemo } from "react";

// Strip system tags that the AI injects for backend processing
const SYSTEM_TAG_REGEX = /\[[A-Z_]+:[^\]]+\]/g;

function stripSystemTags(text: string): string {
  return text.replace(SYSTEM_TAG_REGEX, "").replace(/\s{2,}/g, " ").trim();
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    const Tag = listType === "ol" ? "ol" : "ul";
    const className = listType === "ol"
      ? "list-decimal ml-5 my-2 space-y-1"
      : "list-disc ml-5 my-2 space-y-1";
    elements.push(
      <Tag key={key++} className={className}>
        {listItems.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed">{renderInline(item)}</li>
        ))}
      </Tag>
    );
    listItems = [];
    listType = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) { flushList(); continue; }

    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(<h3 key={key++} className="text-sm font-bold mt-3 mb-1">{renderInline(trimmed.slice(4))}</h3>);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(<h2 key={key++} className="text-sm font-bold mt-3 mb-1">{renderInline(trimmed.slice(3))}</h2>);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(<h1 key={key++} className="text-base font-bold mt-3 mb-1">{renderInline(trimmed.slice(2))}</h1>);
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      if (listType !== "ul") { flushList(); listType = "ul"; }
      listItems.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }
    if (/^\d+[.)]\s/.test(trimmed)) {
      if (listType !== "ol") { flushList(); listType = "ol"; }
      listItems.push(trimmed.replace(/^\d+[.)]\s+/, ""));
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={key++} className="my-3 border-current opacity-20" />);
      continue;
    }

    flushList();
    elements.push(<p key={key++} className="text-sm leading-relaxed mb-2">{renderInline(trimmed)}</p>);
  }

  flushList();
  return elements;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    const codeMatch = remaining.match(/`([^`]+)`/);
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    const matches = [
      boldMatch && { type: "bold", match: boldMatch },
      italicMatch && { type: "italic", match: italicMatch },
      codeMatch && { type: "code", match: codeMatch },
      linkMatch && { type: "link", match: linkMatch },
    ].filter(Boolean) as Array<{ type: string; match: RegExpMatchArray }>;

    if (matches.length === 0) { parts.push(remaining); break; }

    matches.sort((a, b) => (a.match.index ?? 0) - (b.match.index ?? 0));
    const earliest = matches[0];
    const idx = earliest.match.index ?? 0;

    if (idx > 0) parts.push(remaining.slice(0, idx));

    switch (earliest.type) {
      case "bold":
        parts.push(<strong key={key++}>{earliest.match[1]}</strong>);
        break;
      case "italic":
        parts.push(<em key={key++}>{earliest.match[1]}</em>);
        break;
      case "code":
        parts.push(
          <code key={key++} className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono">
            {earliest.match[1]}
          </code>
        );
        break;
      case "link": {
        const href = earliest.match[2];
        const label = earliest.match[1];
        const isInternal = href.startsWith("/");
        const isAction = isInternal && (href.includes("/app/") || href.includes("/settings"));
        if (isAction) {
          parts.push(
            <a key={key++} href={href}
              className="inline-flex items-center gap-1.5 mt-1 mb-1 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-medium no-underline transition-colors">
              {label} &rarr;
            </a>
          );
        } else {
          parts.push(
            <a key={key++} href={href} className="text-primary underline"
              target={isInternal ? undefined : "_blank"} rel={isInternal ? undefined : "noopener noreferrer"}>
              {label}
            </a>
          );
        }
        break;
      }
    }
    remaining = remaining.slice(idx + earliest.match[0].length);
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function ChatMessageContent({ content, role }: { content: string; role: "user" | "assistant" }) {
  const rendered = useMemo(() => {
    if (role === "user") return <span>{stripSystemTags(content)}</span>;
    return <div>{renderMarkdown(stripSystemTags(content))}</div>;
  }, [content, role]);

  return rendered;
}
