/**
 * UI Component Library barrel export.
 * Import from `@/components/ui` for convenience.
 *
 * Many primitives are now backed by Radix (via shadcn/ui patterns) — see
 * `content/docs/dev/theming.mdx` for the migration guide and the dev wiki
 * for the per-component shadcn primitive APIs.
 */

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./button";
export { Input, type InputProps } from "./input";
export { Modal, type ModalProps } from "./modal";
export { Card, type CardProps } from "./card";
export { Badge, type BadgeProps, type BadgeVariant } from "./badge";
export { Avatar, type AvatarProps, type AvatarSize } from "./avatar";
export { Alert, type AlertProps, type AlertVariant } from "./alert";
export { Tabs, TabPanel, type TabsProps, type Tab, type TabPanelProps } from "./tabs";
export { DropdownMenu, type DropdownMenuProps, type DropdownItem } from "./dropdown-menu";
export { Table, type TableProps, type Column } from "./table";
export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonFormField,
  type SkeletonProps,
} from "./skeleton";

// ─── Shadcn-style compound primitives (Radix-backed) ─────────────────────
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./dialog";

export {
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "./tabs";

export {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
} from "./dropdown-menu";

export { Toaster } from "./sonner";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "./command";

// ─── New primitives (capability not previously available) ────────────────
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from "./popover";

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./tooltip";

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "./select";

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./alert-dialog";
