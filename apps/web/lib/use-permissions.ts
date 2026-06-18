"use client";

import { useState, useEffect } from "react";

/**
 * Client-side hook to check if the current user has a specific permission.
 *
 * Usage:
 *   const { allowed, loading } = usePermission("admin:roles");
 */
export function usePermission(permission: string): { allowed: boolean; loading: boolean } {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/auth/permissions");
        if (!res.ok) {
          setAllowed(false);
          return;
        }
        const data = await res.json();
        const perms: string[] = data.permissions ?? [];
        setAllowed(perms.includes("*") || perms.includes(permission));
      } catch {
        setAllowed(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [permission]);

  return { allowed, loading };
}

/**
 * Client-side hook to get all permissions for the current user.
 *
 * Usage:
 *   const { permissions, loading } = usePermissions();
 */
export function usePermissions(): { permissions: string[]; loading: boolean } {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetch_() {
      try {
        const res = await fetch("/api/auth/permissions");
        if (!res.ok) {
          setPermissions([]);
          return;
        }
        const data = await res.json();
        if (!cancelled) setPermissions(data.permissions ?? []);
      } catch {
        if (!cancelled) setPermissions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch_();
    return () => {
      cancelled = true;
    };
  }, []);

  return { permissions, loading };
}
