"use client";

/**
 * MessageScroller — chat transcript scroll container.
 *
 * Adapted from shadcn's June 2026 chat components (Radix variant). The scroll
 * behaviour (anchored turns, follow-the-live-edge-only-when-at-bottom, restore
 * to latest turn on open, preserve position when older history is prepended,
 * jump-to-message) lives in the headless `@shadcn/react/message-scroller`
 * primitive — a tiny, zero-dependency package. This wrapper restyles it with
 * Coomander's own Tailwind/semantic tokens instead of shadcn's `cn-*` CSS layer
 * (which does not ship in the published package). See the dev wiki
 * (content/docs/dev/rich-chat-blocks.mdx) / changelogs.
 *
 * Usage:
 *   <MessageScrollerProvider autoScroll defaultScrollPosition="end">
 *     <MessageScroller>
 *       <MessageScrollerViewport preserveScrollOnPrepend>
 *         <MessageScrollerContent>
 *           {items.map((m) => (
 *             <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
 *               …
 *             </MessageScrollerItem>
 *           ))}
 *         </MessageScrollerContent>
 *       </MessageScrollerViewport>
 *       <MessageScrollerButton direction="end" />
 *     </MessageScroller>
 *   </MessageScrollerProvider>
 */

import * as React from "react";
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { ArrowDown } from "lucide-react";

import { cn } from "@/lib/cn";

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className
      )}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain",
        className
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col", className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn("min-w-0 shrink-0", className)}
      {...props}
    />
  );
}

function MessageScrollerButton({
  direction = "end",
  className,
  children,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      direction={direction}
      className={cn(
        "absolute left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-[opacity,transform] duration-200 hover:bg-muted",
        "data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0",
        "data-[active=true]:scale-100 data-[active=true]:opacity-100",
        "data-[direction=end]:bottom-4",
        "data-[direction=start]:top-4 data-[direction=start]:[&_svg]:rotate-180",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDown className="size-4" />
          <span className="sr-only">
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
