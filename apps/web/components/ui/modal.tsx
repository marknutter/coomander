"use client";

import { type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./dialog";
import { cn } from "@/lib/utils";

export interface ModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Called when the user requests to close (Esc, backdrop click, X button) */
  onClose: () => void;
  /** Modal title */
  title?: string;
  /** Optional icon rendered before the title */
  titleIcon?: ReactNode;
  /** Maximum width class (default: max-w-md) */
  maxWidth?: string;
  /** Content */
  children: ReactNode;
  /** Footer content (buttons, etc.) */
  footer?: ReactNode;
}

/**
 * Accessible modal dialog. Backed by Radix Dialog primitive — provides
 * focus trap, scroll lock, inert background, Esc-to-close, and portal
 * rendering automatically.
 *
 * Maintained as a thin wrapper around the shadcn `<Dialog>` component
 * so consumer code (`<Modal open={...} onClose={...}>`) doesn't churn.
 * For new code, prefer the compound `<Dialog>` API directly.
 *
 * @example
 * ```tsx
 * <Modal open={showModal} onClose={() => setShowModal(false)} title="Confirm">
 *   <p>Are you sure?</p>
 * </Modal>
 * ```
 */
export function Modal({
  open,
  onClose,
  title,
  titleIcon,
  maxWidth = "max-w-md",
  children,
  footer,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className={cn("max-w-md", maxWidth)}>
        {title && (
          <DialogHeader>
            <div className="flex items-center gap-2">
              {titleIcon}
              <DialogTitle>{title}</DialogTitle>
            </div>
          </DialogHeader>
        )}
        <div>{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
