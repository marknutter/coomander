import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, generateRequestId, logRequest } from "@/lib/logger";

describe("Logger", () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
  });

  it("should log info messages by default", () => {
    log.info("test message");
    expect(consoleSpy.log).toHaveBeenCalledOnce();
  });

  it("should log warn messages", () => {
    log.warn("warning message");
    expect(consoleSpy.warn).toHaveBeenCalledOnce();
  });

  it("should log error messages", () => {
    log.error("error message");
    expect(consoleSpy.error).toHaveBeenCalledOnce();
  });

  it("should suppress debug messages at info level", () => {
    process.env.LOG_LEVEL = "info";
    log.debug("debug message");
    expect(consoleSpy.log).not.toHaveBeenCalled();
  });

  it("should show debug messages at debug level", () => {
    process.env.LOG_LEVEL = "debug";
    log.debug("debug message");
    expect(consoleSpy.log).toHaveBeenCalledOnce();
  });

  it("should suppress info at warn level", () => {
    process.env.LOG_LEVEL = "warn";
    log.info("info message");
    expect(consoleSpy.log).not.toHaveBeenCalled();
  });

  it("should only show errors at error level", () => {
    process.env.LOG_LEVEL = "error";
    log.info("info");
    log.warn("warn");
    log.error("error");
    expect(consoleSpy.log).not.toHaveBeenCalled();
    expect(consoleSpy.warn).not.toHaveBeenCalled();
    expect(consoleSpy.error).toHaveBeenCalledOnce();
  });

  it("should include metadata in output", () => {
    log.info("user action", { userId: "u1", action: "login" });
    expect(consoleSpy.log).toHaveBeenCalledOnce();
    const output = consoleSpy.log.mock.calls[0][0] as string;
    expect(output).toContain("user action");
    expect(output).toContain("u1");
  });

  it("should output JSON in production", () => {
    const originalEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");

    log.info("prod message", { key: "value" });

    const output = consoleSpy.log.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("prod message");
    expect(parsed.key).toBe("value");
    expect(parsed.timestamp).toBeDefined();

    vi.unstubAllEnvs();
  });
});

describe("generateRequestId", () => {
  it("should use header value when provided", () => {
    const id = generateRequestId("custom-req-id");
    expect(id).toBe("custom-req-id");
  });

  it("should generate an ID when no header provided", () => {
    const id = generateRequestId(null);
    expect(id).toMatch(/^req_/);
  });

  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId(null)));
    expect(ids.size).toBe(100);
  });
});

describe("logRequest", () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should log 200 responses as info", () => {
    logRequest("GET", "/api/health", 200, 15);
    expect(consoleSpy.log).toHaveBeenCalledOnce();
  });

  it("should log 400 responses as warn", () => {
    logRequest("POST", "/api/items", 400, 5);
    expect(consoleSpy.warn).toHaveBeenCalledOnce();
  });

  it("should log 500 responses as error", () => {
    logRequest("POST", "/api/items", 500, 100);
    expect(consoleSpy.error).toHaveBeenCalledOnce();
  });
});
