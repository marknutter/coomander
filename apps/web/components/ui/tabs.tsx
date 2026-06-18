"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// Shadcn-style compound primitives — preferred for new code.
// Provides roving tabindex, arrow key navigation, automatic activation.
// ─────────────────────────────────────────────────────────────────────────

const TabsRoot = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-xl bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ring-offset-background transition-all",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

// ─────────────────────────────────────────────────────────────────────────
// Legacy controlled API (preserved so existing consumers don't break).
// New code should use the compound primitives above.
// ─────────────────────────────────────────────────────────────────────────

export interface Tab {
  /** Unique key for the tab */
  key: string;
  /** Display label */
  label: string;
}

export interface TabsProps {
  /** Available tabs */
  tabs: Tab[];
  /** Currently selected tab key */
  activeTab: string;
  /** Called when a tab is selected */
  onTabChange: (key: string) => void;
  /** Additional CSS classes */
  className?: string;
}

export interface TabPanelProps {
  /** Whether this panel is active */
  active: boolean;
  /** Panel content */
  children: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Legacy controlled Tabs API. Backed by Radix Tabs primitives — provides
 * roving tabindex, arrow key navigation, and proper ARIA semantics.
 *
 * For new code, prefer the compound API:
 *   `<TabsRoot><TabsList><TabsTrigger>...</TabsTrigger></TabsList><TabsContent>...</TabsContent></TabsRoot>`
 *
 * @example
 * ```tsx
 * <Tabs
 *   tabs={[{ key: "login", label: "Sign In" }, { key: "signup", label: "Sign Up" }]}
 *   activeTab={tab}
 *   onTabChange={setTab}
 * />
 * <TabPanel active={tab === "login"}>Login form here</TabPanel>
 * ```
 */
export function Tabs({ tabs, activeTab, onTabChange, className }: TabsProps) {
  return (
    <TabsRoot value={activeTab} onValueChange={onTabChange}>
      <TabsList className={cn("flex w-full", className)}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </TabsRoot>
  );
}

/**
 * Tab panel wrapper — renders children only when active.
 * Legacy API; new code should use TabsContent inside a TabsRoot.
 */
export function TabPanel({ active, children, className }: TabPanelProps) {
  if (!active) return null;
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}

export { TabsRoot, TabsList, TabsTrigger, TabsContent };
