import { describe, it, expect } from "vitest";
import { checkWallProhibitions } from "@/lib/coomander/wallProhibitions";

function codes(text: string | null | undefined): string[] {
  return checkWallProhibitions(text as string).map((w) => w.code);
}

describe("checkWallProhibitions — empty / clean input", () => {
  it("empty string → []", () => {
    expect(checkWallProhibitions("")).toEqual([]);
  });

  it("null → []", () => {
    expect(checkWallProhibitions(null as unknown as string)).toEqual([]);
  });

  it("undefined → []", () => {
    expect(checkWallProhibitions(undefined as unknown as string)).toEqual([]);
  });

  it("clean text → []", () => {
    expect(checkWallProhibitions("filmed a solo gym mirror selfie")).toEqual([]);
  });
});

describe("checkWallProhibitions — other_people", () => {
  it("'shot with my boyfriend' → other_people", () => {
    expect(codes("shot with my boyfriend")).toContain("other_people");
  });

  it("'us together' → other_people", () => {
    expect(codes("a clip of us together")).toContain("other_people");
  });

  it("'with my friend' → other_people", () => {
    expect(codes("filmed with my friend")).toContain("other_people");
  });
});

describe("checkWallProhibitions — drugs", () => {
  it("'smoking a joint' → drugs", () => {
    expect(codes("me smoking a joint")).toContain("drugs");
  });

  it("'had a bong in frame' → drugs", () => {
    expect(codes("had a bong in frame")).toContain("drugs");
  });
});

describe("checkWallProhibitions — age_coded", () => {
  it("'holding my pacifier' → age_coded", () => {
    expect(codes("holding my pacifier")).toContain("age_coded");
  });

  it("'with a binky' → age_coded", () => {
    expect(codes("posing with a binky")).toContain("age_coded");
  });

  it("'ddlg vibe' → age_coded", () => {
    expect(codes("a ddlg vibe to it")).toContain("age_coded");
  });
});

describe("checkWallProhibitions — reposted_ig", () => {
  it("'already on IG' → reposted_ig", () => {
    expect(codes("already on IG")).toContain("reposted_ig");
  });

  it("'same as my insta' → reposted_ig", () => {
    expect(codes("same as my insta")).toContain("reposted_ig");
  });
});

describe("checkWallProhibitions — multiple categories", () => {
  it("text triggering two categories returns both codes", () => {
    const result = codes("smoking a joint with my boyfriend");
    expect(result).toContain("drugs");
    expect(result).toContain("other_people");
  });

  it("each warning has a non-empty message string", () => {
    const warnings = checkWallProhibitions("smoking a joint with my boyfriend");
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) {
      expect(typeof w.message).toBe("string");
      expect(w.message.length).toBeGreaterThan(0);
    }
  });

  it("matching is case-insensitive", () => {
    expect(codes("SMOKING A JOINT")).toContain("drugs");
  });
});
