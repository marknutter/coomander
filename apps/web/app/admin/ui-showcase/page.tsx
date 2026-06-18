"use client";

import { useState } from "react";
import { Info, Trash2 } from "lucide-react";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui";
import { toast } from "@/lib/use-toast";

/**
 * UI primitives showcase — demonstrates the four new shadcn-style components
 * (Popover, Tooltip, Select, AlertDialog) added in #238 phase 6.
 *
 * Linked from the Dev Wiki theming page. Serves as the canonical "at least
 * one consumer" reference for each new primitive.
 */
export default function UiShowcasePage() {
  const [theme, setTheme] = useState("emerald");

  return (
    <TooltipProvider>
      <div className="p-8 space-y-12 max-w-3xl">
        <header>
          <h1 className="text-2xl font-bold text-foreground mb-2">UI Primitives Showcase</h1>
          <p className="text-muted-foreground text-sm">
            Live examples of the four new shadcn-style primitives added in #238. Use these as
            references when building new pages or migrating existing ones.
          </p>
        </header>

        {/* ── Tooltip ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Tooltip</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Wraps any focusable element with a delayed-open hint. Use for icon-only buttons or
            anything where the visible label is ambiguous.
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center w-10 h-10 rounded-md border border-border bg-card hover:bg-accent transition-colors"
                aria-label="Show details"
              >
                <Info className="w-5 h-5 text-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Hover or focus me — this tooltip is rendered via Radix Tooltip.
            </TooltipContent>
          </Tooltip>
        </section>

        {/* ── Popover ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Popover</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Like a tooltip but click-triggered, focusable, and can hold arbitrary content (forms,
            lists, etc.).
          </p>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center px-4 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Open popover
              </button>
            </PopoverTrigger>
            <PopoverContent>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Popover content</p>
                <p className="text-xs text-muted-foreground">
                  Click outside or press Escape to dismiss. Collision-aware positioning is handled
                  automatically.
                </p>
              </div>
            </PopoverContent>
          </Popover>
        </section>

        {/* ── Select ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Select</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Native-feel select with full keyboard support, typeahead, and proper ARIA semantics.
            Way better than a hand-styled HTML <code>&lt;select&gt;</code>.
          </p>
          <Select value={theme} onValueChange={setTheme}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Pick a theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="emerald">Emerald</SelectItem>
              <SelectItem value="indigo">Indigo</SelectItem>
              <SelectItem value="rose">Rose</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">
            Selected: <span className="font-mono text-foreground">{theme}</span>
          </p>
        </section>

        {/* ── AlertDialog ────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">AlertDialog</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Use for destructive confirmations. Unlike a regular Dialog, AlertDialog blocks
            interaction with the rest of the page until dismissed and announces itself with the{" "}
            <code>alertdialog</code> ARIA role.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 h-10 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete something
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This is a demo — nothing will actually be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => toast.success("Demo confirmed")}>
                  Yes, delete it
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </div>
    </TooltipProvider>
  );
}
