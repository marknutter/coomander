/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from "vitest";
import { parseChannel, authorizeChannel } from "../src/channel/routing";

// Unit tests for the pure channel-routing logic, ported from the AppSeed
// realtime epic (template #533) into Coomander's apps/agents worker (#222).
//
// IMPORTANT (anti-sycophancy): these tests are written AGAINST THE SPEC, not
// against the implementation in ../src/channel/routing — the author did not
// read that file before writing them. Each assertion encodes what the behavior
// SHOULD be per the channel contract:
//
//   parseChannel  — split on the FIRST colon: everything before is `type`,
//                   everything after is `id` (later colons stay in `id`); both
//                   parts must be non-empty; `raw` is the normalized
//                   `${type}:${id}`. Malformed input → null.
//
//   authorizeChannel — own-channel-only, deny-by-default. `user:<id>` and
//                   `notifications:<id>` are allowed IFF `<id> === user.id`.
//                   EVERY other type (doc, room, unknown) is denied, regardless
//                   of id.
//
// A failure here is a signal the IMPLEMENTATION may be wrong — do not "fix" the
// test to match the code.

describe("parseChannel — splits on the first colon (SPEC)", () => {
  it("parses a simple `user:abc` into type + id + normalized raw", () => {
    expect(parseChannel("user:abc")).toEqual({
      type: "user",
      id: "abc",
      raw: "user:abc",
    });
  });

  it("parses `notifications:u1`", () => {
    expect(parseChannel("notifications:u1")).toEqual({
      type: "notifications",
      id: "u1",
      raw: "notifications:u1",
    });
  });

  it("keeps later colons inside the id (splits on the FIRST colon only)", () => {
    expect(parseChannel("doc:project:42")).toEqual({
      type: "doc",
      id: "project:42",
      raw: "doc:project:42",
    });
  });

  it("parses `room:1`", () => {
    expect(parseChannel("room:1")).toEqual({
      type: "room",
      id: "1",
      raw: "room:1",
    });
  });

  it("returns null when there is no colon at all", () => {
    expect(parseChannel("nocolon")).toBeNull();
  });

  it("returns null for an empty type (`:abc`)", () => {
    expect(parseChannel(":abc")).toBeNull();
  });

  it("returns null for an empty id (`user:`)", () => {
    expect(parseChannel("user:")).toBeNull();
  });

  it("returns null for the empty string", () => {
    expect(parseChannel("")).toBeNull();
  });
});

describe("authorizeChannel — own-channel-only, deny-by-default (SPEC)", () => {
  it("allows `user:<id>` when the id matches the user's own id", () => {
    expect(authorizeChannel(parseChannel("user:U1")!, { id: "U1" })).toBe(true);
  });

  it("denies `user:<otherId>` — a user CANNOT authorize another user's channel", () => {
    expect(authorizeChannel(parseChannel("user:U2")!, { id: "U1" })).toBe(false);
  });

  it("allows `notifications:<id>` when the id matches the user's own id (treated like `user:`)", () => {
    expect(authorizeChannel(parseChannel("notifications:U1")!, { id: "U1" })).toBe(
      true,
    );
  });

  it("denies `notifications:<otherId>` for a non-owner", () => {
    expect(authorizeChannel(parseChannel("notifications:U2")!, { id: "U1" })).toBe(
      false,
    );
  });

  it("denies an unknown type (`doc:`) EVEN when the id matches the user's id", () => {
    expect(authorizeChannel(parseChannel("doc:U1")!, { id: "U1" })).toBe(false);
  });

  it("denies `room:1` (unknown type) regardless of id", () => {
    expect(authorizeChannel(parseChannel("room:1")!, { id: "U1" })).toBe(false);
  });

  it("regression: a user WITHOUT a role can still subscribe to their own `user:` channel (role is optional)", () => {
    expect(authorizeChannel(parseChannel("user:U1")!, { id: "U1" })).toBe(true);
  });
});

// ─── `campaign:<id>` — admin-only, fail-closed (SPEC) ───────────────────────
//
//   campaign:<anyId> — allowed IFF user.role === "admin". Any campaign id is
//   allowed for an admin (campaigns are a global admin surface, not
//   user-owned). Every non-"admin" role value (undefined, "user", "", or any
//   other string) is denied — fail-closed, mirroring the deny-by-default
//   posture of every other case in this switch. `role` is undefined until the
//   hardening slice (#222 sibling) wires Better Auth's admin role/backfill.

describe("authorizeChannel — `campaign:<id>` is admin-only, fail-closed (SPEC)", () => {
  it("allows `campaign:<anyId>` when user.role === 'admin'", () => {
    expect(
      authorizeChannel(parseChannel("campaign:c1")!, { id: "U1", role: "admin" }),
    ).toBe(true);
  });

  it("allows an admin to watch ANY campaign id, not just ones tied to their own user id", () => {
    expect(
      authorizeChannel(parseChannel("campaign:some-other-campaign")!, {
        id: "U1",
        role: "admin",
      }),
    ).toBe(true);
  });

  it("denies `campaign:<id>` when user.role is undefined (no role at all)", () => {
    expect(authorizeChannel(parseChannel("campaign:c1")!, { id: "U1" })).toBe(false);
  });

  it("denies `campaign:<id>` when user.role === 'user'", () => {
    expect(
      authorizeChannel(parseChannel("campaign:c1")!, { id: "U1", role: "user" }),
    ).toBe(false);
  });

  it("denies `campaign:<id>` when user.role is an empty string", () => {
    expect(
      authorizeChannel(parseChannel("campaign:c1")!, { id: "U1", role: "" }),
    ).toBe(false);
  });

  it("denies `campaign:<id>` for any other non-'admin' role value", () => {
    expect(
      authorizeChannel(parseChannel("campaign:c1")!, { id: "U1", role: "moderator" }),
    ).toBe(false);
  });
});
