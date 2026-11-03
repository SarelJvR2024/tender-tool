import { describe, expect, it } from "vitest";
import { safeFileName } from "./safeFileName";

describe("safeFileName - the one shared filename sanitizer every upload path should use", () => {
  it("keeps an ordinary filename unchanged", () => {
    expect(safeFileName("CV John Smith (2026).pdf")).toBe("CV John Smith (2026).pdf");
  });

  it("strips every path separator - no literal '/' can ever survive, so path traversal is impossible", () => {
    expect(safeFileName("../../etc/passwd")).not.toContain("/");
    expect(safeFileName("a/b\\c")).not.toMatch(/[/\\]/);
  });

  it("caps length at 120 chars - an attacker-controlled filename can't produce an unbounded storage key", () => {
    const long = "a".repeat(500) + ".pdf";
    expect(safeFileName(long).length).toBeLessThanOrEqual(120);
  });

  it("falls back to 'document' only for a genuinely empty name - a name of only separators still sanitizes to a non-empty string", () => {
    expect(safeFileName("")).toBe("document");
    expect(safeFileName("///")).toBe("___");
  });
});
