"use client";

/**
 * Rich-block dispatcher for assistant messages (#222 follow-up).
 *
 * `chat-message.tsx` parses an assistant reply into text + block segments (via
 * `parseRichSegments` from @coomander/core) and hands each block here. We
 * switch on the block type and render the matching component, wrapped in an
 * error boundary so a malformed payload degrades to a small inline notice
 * instead of crashing the whole message.
 *
 * The per-type renderers live in their own files so later slices stay
 * disjoint — charts own `chat-chart.tsx`, images own `chat-image.tsx`; neither
 * touches this dispatcher beyond adding their `case`.
 *
 * A block type with no renderer wired yet (or a type this build doesn't know
 * about) degrades gracefully to its raw marker text rather than losing the
 * content — see the `default` case below.
 */

import { Component, type ReactNode } from "react";
import type { RichSegment } from "@coomander/core";
import { ChatChart } from "./chat-chart";

type Block = Extract<RichSegment, { kind: "block" }>;

class BlockErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    // Render errors in an AI-emitted block are non-fatal; log for diagnosis.
    console.error("[ChatBlock] render error", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <span className="inline-block my-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
          (couldn&rsquo;t render this content)
        </span>
      );
    }
    return this.props.children;
  }
}

export function ChatBlock({ block }: { block: Block }) {
  let inner: ReactNode;
  switch (block.type) {
    case "chart":
      inner = <ChatChart json={block.json} />;
      break;
    // Cases are added by the slice that ships each renderer — until then, any
    // block type falls through to the raw-text default below.
    default:
      inner = <span className="whitespace-pre-wrap">{block.raw}</span>;
  }
  return <BlockErrorBoundary>{inner}</BlockErrorBoundary>;
}
