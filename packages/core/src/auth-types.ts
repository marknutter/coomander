import { createAuthClient } from "better-auth/client";

/**
 * Infer session/user types from the Better Auth client so they stay in sync
 * with the auth config without manual duplication.
 */
type AuthClient = ReturnType<typeof createAuthClient>;
type InferredSession = AuthClient extends { $Infer: { Session: infer S } } ? S : never;

export type Session = InferredSession;
export type User = Session extends { user: infer U } ? U : never;
