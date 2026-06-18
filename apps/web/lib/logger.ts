/**
 * Lightweight structured logger with levels and JSON output in production.
 *
 * Usage:
 *   import { log } from "@/lib/logger";
 *   log.info("User signed up", { email: "user@test.com" });
 *   log.error("Failed to process payment", { error: err.message, userId: "u1" });
 *
 * Configuration:
 *   LOG_LEVEL env var: "debug" | "info" | "warn" | "error" (default: "info")
 *   NODE_ENV: "production" outputs JSON, otherwise pretty-prints
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m",  // cyan
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

function getConfiguredLevel(): LogLevel {
  const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LEVELS[envLevel] !== undefined ? envLevel : "info";
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function shouldLog(level: LogLevel): boolean {
  const configured = getConfiguredLevel();
  return LEVELS[level] >= LEVELS[configured];
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function formatPretty(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const levelTag = `${color}${entry.level.toUpperCase().padEnd(5)}${RESET}`;
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const { level: _level, message, timestamp: _ts, ...meta } = entry;
  const metaStr = Object.keys(meta).length > 0
    ? ` ${LEVEL_COLORS.debug}${JSON.stringify(meta)}${RESET}`
    : "";
  return `${LEVEL_COLORS.debug}${time}${RESET} ${levelTag} ${message}${metaStr}`;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  const output = isProduction() ? formatJson(entry) : formatPretty(entry);

  switch (level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const log = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};

// ─── Request Logger Helper ───────────────────────────────────────────────────

let requestCounter = 0;

/**
 * Generate a short request ID for tracing.
 * In production, use X-Request-Id header from load balancer if available.
 */
export function generateRequestId(headerValue?: string | null): string {
  if (headerValue) return headerValue;
  requestCounter = (requestCounter + 1) % 1_000_000;
  return `req_${Date.now().toString(36)}_${requestCounter.toString(36)}`;
}

/**
 * Log an API request/response pair.
 */
export function logRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  meta?: Record<string, unknown>
): void {
  const level: LogLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
  emit(level, `${method} ${path} ${statusCode} ${durationMs}ms`, {
    method,
    path,
    statusCode,
    durationMs,
    ...meta,
  });
}
