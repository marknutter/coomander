import { describe, it, expect } from "vitest";
import {
  pickNagFrequency,
  pickPersonaMode,
  isValidNagFrequency,
  isValidPersonaMode,
  DEFAULT_NAG_FREQUENCY,
  DEFAULT_PERSONA_MODE,
} from "@/lib/coomander/settings";

describe("settings defaults", () => {
  it("DEFAULT_NAG_FREQUENCY is 'tight'", () => {
    expect(DEFAULT_NAG_FREQUENCY).toBe("tight");
  });

  it("DEFAULT_PERSONA_MODE is 'light_companion'", () => {
    expect(DEFAULT_PERSONA_MODE).toBe("light_companion");
  });
});

describe("pickNagFrequency", () => {
  it("returns a valid value verbatim", () => {
    expect(pickNagFrequency({ nag_frequency: "tight" })).toBe("tight");
    expect(pickNagFrequency({ nag_frequency: "moderate" })).toBe("moderate");
    expect(pickNagFrequency({ nag_frequency: "light" })).toBe("light");
  });

  it("falls back to default when row is undefined", () => {
    expect(pickNagFrequency(undefined)).toBe(DEFAULT_NAG_FREQUENCY);
  });

  it("falls back to default when field is missing", () => {
    expect(pickNagFrequency({})).toBe(DEFAULT_NAG_FREQUENCY);
  });

  it("falls back to default for an empty string", () => {
    expect(pickNagFrequency({ nag_frequency: "" })).toBe(DEFAULT_NAG_FREQUENCY);
  });

  it("falls back to default for an arbitrary invalid string", () => {
    expect(pickNagFrequency({ nag_frequency: "aggressive" })).toBe(DEFAULT_NAG_FREQUENCY);
  });
});

describe("pickPersonaMode", () => {
  it("returns a valid value verbatim", () => {
    expect(pickPersonaMode({ persona_mode: "light_companion" })).toBe("light_companion");
    expect(pickPersonaMode({ persona_mode: "full_companion" })).toBe("full_companion");
    expect(pickPersonaMode({ persona_mode: "operational" })).toBe("operational");
  });

  it("falls back to default when row is undefined", () => {
    expect(pickPersonaMode(undefined)).toBe(DEFAULT_PERSONA_MODE);
  });

  it("falls back to default when field is missing", () => {
    expect(pickPersonaMode({})).toBe(DEFAULT_PERSONA_MODE);
  });

  it("falls back to default for an empty string", () => {
    expect(pickPersonaMode({ persona_mode: "" })).toBe(DEFAULT_PERSONA_MODE);
  });

  it("falls back to default for an arbitrary invalid string", () => {
    expect(pickPersonaMode({ persona_mode: "robot" })).toBe(DEFAULT_PERSONA_MODE);
  });
});

describe("isValidNagFrequency", () => {
  it("true for the three valid literals", () => {
    expect(isValidNagFrequency("tight")).toBe(true);
    expect(isValidNagFrequency("moderate")).toBe(true);
    expect(isValidNagFrequency("light")).toBe(true);
  });

  it("false for invalid inputs", () => {
    expect(isValidNagFrequency("")).toBe(false);
    expect(isValidNagFrequency("aggressive")).toBe(false);
    expect(isValidNagFrequency("TIGHT")).toBe(false);
    expect(isValidNagFrequency(null)).toBe(false);
    expect(isValidNagFrequency(undefined)).toBe(false);
    expect(isValidNagFrequency(1)).toBe(false);
    expect(isValidNagFrequency(0)).toBe(false);
  });
});

describe("isValidPersonaMode", () => {
  it("true for the three valid literals", () => {
    expect(isValidPersonaMode("light_companion")).toBe(true);
    expect(isValidPersonaMode("full_companion")).toBe(true);
    expect(isValidPersonaMode("operational")).toBe(true);
  });

  it("false for invalid inputs", () => {
    expect(isValidPersonaMode("")).toBe(false);
    expect(isValidPersonaMode("robot")).toBe(false);
    expect(isValidPersonaMode("light")).toBe(false);
    expect(isValidPersonaMode(null)).toBe(false);
    expect(isValidPersonaMode(undefined)).toBe(false);
    expect(isValidPersonaMode(42)).toBe(false);
    expect(isValidPersonaMode(0)).toBe(false);
  });
});
