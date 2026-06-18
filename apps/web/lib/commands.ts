import type { ReactNode } from "react";

/**
 * Command definition for the command palette.
 */
export interface Command {
  /** Unique identifier */
  id: string;
  /** Display name */
  label: string;
  /** Category for grouping (e.g. "Navigation", "Actions") */
  category: string;
  /** Optional icon */
  icon?: ReactNode;
  /** Search keywords (matched in addition to label) */
  keywords?: string[];
  /** Action to perform when selected */
  action: () => void;
}

/**
 * Global command registry.
 * Developers can register custom commands that appear in the palette.
 */
class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private listeners = new Set<() => void>();

  /** Register a command */
  register(command: Command) {
    this.commands.set(command.id, command);
    this.notify();
  }

  /** Register multiple commands at once */
  registerAll(commands: Command[]) {
    commands.forEach((cmd) => this.commands.set(cmd.id, cmd));
    this.notify();
  }

  /** Unregister a command by ID */
  unregister(id: string) {
    this.commands.delete(id);
    this.notify();
  }

  /** Get all registered commands */
  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  /** Search commands by query using fuzzy matching */
  search(query: string): Command[] {
    if (!query.trim()) return this.getAll();

    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/);

    return this.getAll()
      .map((cmd) => {
        const searchText = [
          cmd.label,
          cmd.category,
          ...(cmd.keywords || []),
        ]
          .join(" ")
          .toLowerCase();

        // All terms must match somewhere in the search text
        const allMatch = terms.every((term) => searchText.includes(term));
        if (!allMatch) return null;

        // Score: exact label match > starts with > contains
        let score = 0;
        const labelLower = cmd.label.toLowerCase();
        if (labelLower === lower) score = 100;
        else if (labelLower.startsWith(lower)) score = 80;
        else if (labelLower.includes(lower)) score = 60;
        else score = 40;

        return { cmd, score };
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score)
      .map((r) => r!.cmd);
  }

  /** Subscribe to registry changes */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}

/** Singleton command registry instance */
export const commandRegistry = new CommandRegistry();
