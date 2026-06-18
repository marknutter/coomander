/* eslint-disable react/no-children-prop -- React.createElement requires children in props
   here because the Modal interface declares `children` explicitly and TypeScript's newer
   overloads don't accept children as a positional third arg in that case. */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ─── Sonner mock (hoisted before @/lib/use-toast import) ───────────────────
//
// The wrapper in @/lib/use-toast forwards to sonner.toast.*, so we mock the
// sonner module to return predictable numeric ids (sonner's real behavior)
// and assert the wrapper converts them to strings for its callers.

const sonnerCalls: Array<{ level: string; message: string }> = [];
let nextSonnerId = 1000;

vi.mock("sonner", () => {
  const makeFn = (level: string) =>
    vi.fn((msg: string) => {
      sonnerCalls.push({ level, message: msg });
      // Sonner returns numbers internally
      return nextSonnerId++;
    });

  const toast = Object.assign(makeFn("default"), {
    success: makeFn("success"),
    error: makeFn("error"),
    info: makeFn("info"),
    warning: makeFn("warning"),
    message: makeFn("message"),
    loading: makeFn("loading"),
    dismiss: vi.fn((_id?: string | number) => undefined),
  });

  return {
    toast,
    Toaster: () => null,
  };
});

// Imports that rely on the sonner mock must come AFTER vi.mock.
import { toast } from "@/lib/use-toast";
import { cn } from "@/lib/utils";
import {
  Modal,
  Tabs,
  DropdownMenu,
  type Tab,
  type DropdownItem,
} from "@/components/ui";

// ─── cn() helper ───────────────────────────────────────────────────────────

describe("cn() helper", () => {
  it("joins multiple class strings with spaces", () => {
    const result = cn("foo", "bar", "baz");
    expect(result).toBe("foo bar baz");
  });

  it("filters out false", () => {
    const result = cn("foo", false, "bar");
    expect(result).toBe("foo bar");
  });

  it("filters out null", () => {
    const result = cn("foo", null, "bar");
    expect(result).toBe("foo bar");
  });

  it("filters out undefined", () => {
    const result = cn("foo", undefined, "bar");
    expect(result).toBe("foo bar");
  });

  it("filters out empty string", () => {
    const result = cn("foo", "", "bar");
    expect(result).toBe("foo bar");
  });

  it("resolves Tailwind padding conflicts — last one wins", () => {
    // tailwind-merge should drop the earlier conflicting utility
    const result = cn("px-4", "px-2");
    expect(result).toBe("px-2");
  });

  it("resolves Tailwind color conflicts — last one wins", () => {
    const result = cn("text-red-500", "text-blue-500");
    expect(result).toBe("text-blue-500");
  });

  it("preserves non-conflicting utilities across merges", () => {
    const result = cn("px-4 py-2", "px-6");
    // px-6 replaces px-4, py-2 is preserved
    expect(result).toContain("py-2");
    expect(result).toContain("px-6");
    expect(result).not.toContain("px-4");
  });

  it("supports conditional expressions via boolean shortcircuits", () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn(
      "base",
      isActive && "active",
      isDisabled && "disabled"
    );
    expect(result).toContain("base");
    expect(result).toContain("active");
    expect(result).not.toContain("disabled");
  });
});

// ─── toast programmatic API ────────────────────────────────────────────────

describe("toast programmatic API", () => {
  it("toast.success returns a string id", () => {
    const id = toast.success("saved!");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("toast.error returns a string id", () => {
    const id = toast.error("oops");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("toast.info returns a string id", () => {
    const id = toast.info("fyi");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("toast.warning returns a string id", () => {
    const id = toast.warning("careful");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("toast.dismiss is callable without throwing", () => {
    const id = toast.success("temp");
    expect(() => toast.dismiss(id)).not.toThrow();
  });

  it("toast.dismiss is callable with no argument", () => {
    expect(() => toast.dismiss()).not.toThrow();
  });

  it("each successive call returns a distinct id", () => {
    const a = toast.success("a");
    const b = toast.success("b");
    expect(a).not.toBe(b);
  });

  it("forwards the message to the underlying sonner call", () => {
    sonnerCalls.length = 0;
    toast.success("hello world");
    const last = sonnerCalls[sonnerCalls.length - 1];
    expect(last).toBeDefined();
    expect(last.level).toBe("success");
    expect(last.message).toBe("hello world");
  });
});

// ─── Modal (legacy controlled API) ─────────────────────────────────────────
//
// Modal is a thin wrapper around Radix Dialog (shadcn pattern). Radix Dialog
// renders its content into a portal (document.body) only on the client, so
// `react-dom/server.renderToStaticMarkup` produces an empty string whether
// the modal is open or closed. Because there's no jsdom / happy-dom /
// @testing-library/react in this project, the interactive behaviors below
// are exercised by the Playwright e2e suite rather than unit tests.
//
// What we CAN verify without a DOM:
//   - The Modal component is exported and is a valid React component type
//   - Creating a React element with the documented props does not throw
//   - Rendering to a string does not throw (render doesn't crash)
//
// What we explicitly skip (and why) is documented on each `it.skip` below.

describe("Modal (legacy controlled API)", () => {
  it("is exported as a React component from @/components/ui", () => {
    expect(Modal).toBeDefined();
    expect(typeof Modal === "function" || typeof Modal === "object").toBe(true);
  });

  it("accepts the documented controlled-API props without throwing at construction", () => {
    expect(() => {
      React.createElement(
        Modal,
        {
          open: true,
          onClose: () => {},
          title: "T",
          footer: React.createElement("button", null, "f"),
          maxWidth: "lg",
          children: React.createElement("p", null, "body"),
        }
      );
    }).not.toThrow();
  });

  it("renders to a string without throwing when open={false}", () => {
    expect(() => {
      renderToStaticMarkup(
        React.createElement(
          Modal,
          {
            open: false,
            onClose: () => {},
            title: "My Modal",
            children: React.createElement("p", null, "body-content-xyz"),
          }
        )
      );
    }).not.toThrow();
  });

  it("renders to a string without throwing when open={true}", () => {
    expect(() => {
      renderToStaticMarkup(
        React.createElement(
          Modal,
          {
            open: true,
            onClose: () => {},
            title: "My Modal",
            children: React.createElement("p", null, "body-content-xyz"),
          }
        )
      );
    }).not.toThrow();
  });

  it.skip("when open={false}, modal content is NOT in the DOM [requires DOM]", () => {
    // Radix Dialog content lives inside a portal mounted to document.body.
    // Asserting DOM absence requires a real document — not available here.
    // Covered by Playwright e2e tests.
  });

  it.skip("when open={true}, modal content IS in the DOM [requires DOM]", () => {
    // See above — Radix portal content is not visible to renderToStaticMarkup.
    // Covered by Playwright e2e tests.
  });

  it.skip("renders title as a heading when provided [requires DOM]", () => {
    // DialogTitle is rendered inside the portal. Covered by e2e.
  });

  it.skip("renders footer when provided [requires DOM]", () => {
    // Footer lives inside the portal content. Covered by e2e.
  });

  it.skip("calls onClose when Escape key is pressed [requires DOM]", () => {
    // Radix Dialog's escape handling runs in real browser event listeners
    // registered after mount. react-dom/server cannot dispatch events, and
    // the project has no jsdom/@testing-library/react installed, so this
    // behavior is covered by Playwright e2e tests instead.
  });

  it.skip("traps focus inside the modal when open [requires DOM]", () => {
    // Focus trap behavior is implementation-specific (Radix FocusScope) and
    // requires a real DOM with focusable elements to assert. Covered by e2e.
  });
});

// ─── Tabs (legacy controlled API) ──────────────────────────────────────────

describe("Tabs (legacy controlled API)", () => {
  const sampleTabs: Tab[] = [
    { key: "one", label: "Tab One" },
    { key: "two", label: "Tab Two" },
    { key: "three", label: "Tab Three" },
  ];

  it("renders one button (or tab role) per tab", () => {
    const html = renderToStaticMarkup(
      React.createElement(Tabs, {
        tabs: sampleTabs,
        activeTab: "one",
        onTabChange: () => {},
      })
    );
    // Radix TabsTrigger renders role="tab". Count occurrences.
    const tabMatches = html.match(/role="tab"/g) ?? [];
    expect(tabMatches.length).toBe(sampleTabs.length);
  });

  it("renders each tab's label", () => {
    const html = renderToStaticMarkup(
      React.createElement(Tabs, {
        tabs: sampleTabs,
        activeTab: "one",
        onTabChange: () => {},
      })
    );
    for (const tab of sampleTabs) {
      expect(html).toContain(tab.label);
    }
  });

  it("marks the active tab with aria-selected='true'", () => {
    const html = renderToStaticMarkup(
      React.createElement(Tabs, {
        tabs: sampleTabs,
        activeTab: "two",
        onTabChange: () => {},
      })
    );
    // The active tab's label should appear on the element with
    // aria-selected="true". Extract the element containing it.
    const selectedTrue = html.match(
      /aria-selected="true"[^>]*>[^<]*(Tab One|Tab Two|Tab Three)/
    );
    expect(selectedTrue).not.toBeNull();
    expect(selectedTrue?.[1]).toBe("Tab Two");
  });

  it("marks inactive tabs with aria-selected='false'", () => {
    const html = renderToStaticMarkup(
      React.createElement(Tabs, {
        tabs: sampleTabs,
        activeTab: "one",
        onTabChange: () => {},
      })
    );
    const falseMatches = html.match(/aria-selected="false"/g) ?? [];
    expect(falseMatches.length).toBe(sampleTabs.length - 1);
  });

  it.skip("calls onTabChange(key) when a non-active tab is clicked [requires DOM]", () => {
    // Click dispatching requires a real DOM. Covered by e2e tests.
  });
});

// ─── DropdownMenu (legacy controlled API) ──────────────────────────────────

describe("DropdownMenu (legacy controlled API)", () => {
  const sampleItems: DropdownItem[] = [
    { key: "edit", label: "Edit", onClick: () => {} },
    { key: "delete", label: "Delete-xyz", onClick: () => {}, danger: true },
  ];

  it("renders the trigger element", () => {
    const html = renderToStaticMarkup(
      React.createElement(DropdownMenu, {
        trigger: React.createElement(
          "button",
          null,
          "trigger-label-xyz"
        ),
        items: sampleItems,
      })
    );
    expect(html).toContain("trigger-label-xyz");
  });

  it("does NOT render the menu items in the initial (closed) state", () => {
    const html = renderToStaticMarkup(
      React.createElement(DropdownMenu, {
        trigger: React.createElement("button", null, "Open"),
        items: sampleItems,
      })
    );
    // Radix DropdownMenu mounts content in a portal only when open, so
    // in SSR static markup the items should not appear.
    expect(html).not.toContain("Delete-xyz");
  });

  it.skip("reveals menu items when the trigger is clicked [requires DOM]", () => {
    // Requires a real DOM + Radix portal mounting. Covered by e2e tests.
  });

  it.skip("calls onClick handler when a menu item is selected [requires DOM]", () => {
    // Click dispatching on portal-rendered content requires a real DOM.
    // Covered by e2e tests.
  });
});
