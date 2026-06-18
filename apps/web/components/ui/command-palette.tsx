"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { CornerDownLeft, FileText } from "lucide-react";

import { commandRegistry, type Command } from "@/lib/commands";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";

interface SearchResult {
  id: string;
  name: string;
  description: string;
  snippet: string;
}

// ─── Context ───────────────────────────────────────────────────────────────

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | undefined>(undefined);

/**
 * Hook to open/close the command palette programmatically.
 */
export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

// ─── Provider ──────────────────────────────────────────────────────────────

/**
 * Command palette provider — wires up Cmd+K / Ctrl+K global shortcut and
 * renders the palette dialog. Backed by `cmdk` (the same library shadcn
 * uses) for keyboard navigation, fuzzy filtering, and ARIA semantics.
 *
 * Place once near the root of the app (e.g. in `app/layout.tsx`).
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandPaletteContent open={open} onOpenChange={setOpen} />
    </CommandPaletteContext.Provider>
  );
}

// ─── Dialog ────────────────────────────────────────────────────────────────

function CommandPaletteContent({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Command[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSearchQuery = query.startsWith(">");
  const searchMode = isSearchQuery;

  // Load commands and search
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    if (isSearchQuery) {
      const searchTerm = query.slice(1).trim();
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (searchTerm.length >= 2) {
        searchTimerRef.current = setTimeout(async () => {
          try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`);
            if (res.ok) {
              const data = await res.json();
              setSearchResults(data.results || []);
            }
          } catch {
            setSearchResults([]);
          }
        }, 200);
      } else {
        setSearchResults([]);
      }
      return () => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      };
    }

    setSearchResults([]);
    const update = () => setResults(commandRegistry.search(query));
    update();
    const unsub = commandRegistry.subscribe(update);
    return unsub;
  }, [query, isSearchQuery, open]);

  const execute = useCallback(
    (cmd: Command) => {
      onOpenChange(false);
      // Defer action to allow palette to close first
      requestAnimationFrame(() => cmd.action());
    },
    [onOpenChange],
  );

  // Group commands by category for the cmdk groups
  const categoryMap = new Map<string, Command[]>();
  results.forEach((cmd) => {
    const list = categoryMap.get(cmd.category) || [];
    list.push(cmd);
    categoryMap.set(cmd.category, list);
  });
  const grouped: { category: string; items: Command[] }[] = [];
  categoryMap.forEach((items, category) => {
    grouped.push({ category, items });
  });

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <CommandInput
        placeholder="Type a command or > to search items..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {searchMode ? (
          <>
            {searchResults.length === 0 && query.length > 1 && (
              <CommandEmpty>
                {query.slice(1).trim().length < 2
                  ? "Type at least 2 characters to search..."
                  : "No items found"}
              </CommandEmpty>
            )}
            {searchResults.length > 0 && (
              <CommandGroup heading="Search results">
                {searchResults.map((item) => (
                  <CommandItem key={item.id} value={item.name}>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            <CommandEmpty>No commands found</CommandEmpty>
            {grouped.map((group) => (
              <CommandGroup key={group.category} heading={group.category}>
                {group.items.map((cmd) => (
                  <CommandItem
                    key={cmd.id}
                    value={`${group.category} ${cmd.label}`}
                    onSelect={() => execute(cmd)}
                  >
                    {cmd.icon && (
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground">
                        {cmd.icon}
                      </span>
                    )}
                    <span className="flex-1">{cmd.label}</span>
                    <CornerDownLeft className="h-4 w-4 text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
