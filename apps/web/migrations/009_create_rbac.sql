-- UP
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  assigned_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES user(id) ON DELETE SET NULL,
  UNIQUE(user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);

-- Seed default roles
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES
  ('role_owner', 'owner', 'Full system access', '["*"]', 1),
  ('role_admin', 'admin', 'Administrative access', '["admin:users","admin:roles","admin:settings","admin:waitlist","admin:logs","admin:analytics","admin:crm","admin:database","items:create","items:read","items:update","items:delete"]', 1),
  ('role_member', 'member', 'Standard member access', '["items:create","items:read","items:update","items:delete"]', 1);

-- Backfill: assign admin role to existing isAdmin users
INSERT OR IGNORE INTO user_roles (user_id, role_id)
  SELECT id, 'role_admin' FROM user WHERE isAdmin = 1;

