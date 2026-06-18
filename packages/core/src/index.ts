/**
 * @coomander/core — platform-agnostic logic shared by apps/web and apps/mobile.
 *
 * Hard rule: nothing here may import next/*, drizzle, better-sqlite3,
 * react-dom, Node built-ins, or DOM globals.
 */

// HTTP primitives + the typed error.
export { ApiError } from "./http";
export type { FetchLike, RequestInitLike, ResponseLike } from "./http";

// Better Auth $Infer session/user types.
export type { Session, User } from "./auth-types";

// Shared Zod schemas (extracted from apps/web as mobile needs them).
export * from "./schemas";
