/**
 * Permission constants and groups for RBAC.
 *
 * Each permission is a colon-separated string like "items:create" or "admin:users".
 * The wildcard "*" grants all permissions (used by the owner role).
 */

// ─── Permission Constants ────────────────────────────────────────────────────

export const PERMISSIONS = {
  // Items
  ITEMS_CREATE: "items:create",
  ITEMS_READ: "items:read",
  ITEMS_UPDATE: "items:update",
  ITEMS_DELETE: "items:delete",

  // Admin
  ADMIN_USERS: "admin:users",
  ADMIN_ROLES: "admin:roles",
  ADMIN_SETTINGS: "admin:settings",
  ADMIN_WAITLIST: "admin:waitlist",
  ADMIN_LOGS: "admin:logs",
  ADMIN_ANALYTICS: "admin:analytics",
  ADMIN_CRM: "admin:crm",
  ADMIN_DATABASE: "admin:database",
  ADMIN_CAMPAIGNS: "admin:campaigns",

  // Wildcard
  ALL: "*",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ─── Permission Groups (for UI display) ──────────────────────────────────────

export interface PermissionGroup {
  label: string;
  permissions: { key: Permission; label: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: "Items",
    permissions: [
      { key: PERMISSIONS.ITEMS_CREATE, label: "Create items" },
      { key: PERMISSIONS.ITEMS_READ, label: "Read items" },
      { key: PERMISSIONS.ITEMS_UPDATE, label: "Update items" },
      { key: PERMISSIONS.ITEMS_DELETE, label: "Delete items" },
    ],
  },
  {
    label: "Administration",
    permissions: [
      { key: PERMISSIONS.ADMIN_USERS, label: "Manage users" },
      { key: PERMISSIONS.ADMIN_ROLES, label: "Manage roles" },
      { key: PERMISSIONS.ADMIN_SETTINGS, label: "Manage settings" },
      { key: PERMISSIONS.ADMIN_WAITLIST, label: "Manage waitlist" },
      { key: PERMISSIONS.ADMIN_LOGS, label: "View audit logs" },
      { key: PERMISSIONS.ADMIN_ANALYTICS, label: "View analytics" },
      { key: PERMISSIONS.ADMIN_CRM, label: "Manage CRM" },
      { key: PERMISSIONS.ADMIN_DATABASE, label: "Database access" },
      { key: PERMISSIONS.ADMIN_CAMPAIGNS, label: "Manage email campaigns" },
    ],
  },
];

/** All valid permission strings (excluding wildcard) */
export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key)
);
