import { describe, expect, it, vi } from "vitest";
import { parseSenderCliArgs, testIdempotencyKey } from "./senderCliArgs";

describe("parseSenderCliArgs", () => {
  it("parses no flags as all-off", () => {
    expect(parseSenderCliArgs([])).toEqual({ dryRun: false, companyId: null, testRecipient: null });
  });

  it("parses --dry-run alone", () => {
    expect(parseSenderCliArgs(["--dry-run"])).toEqual({ dryRun: true, companyId: null, testRecipient: null });
  });

  it("parses --company-id with its value", () => {
    expect(parseSenderCliArgs(["--company-id", "co-123"])).toEqual({ dryRun: false, companyId: "co-123", testRecipient: null });
  });

  it("parses --test-recipient together with --company-id", () => {
    expect(parseSenderCliArgs(["--test-recipient", "sarel@example.com", "--company-id", "co-123"])).toEqual({
      dryRun: false, companyId: "co-123", testRecipient: "sarel@example.com",
    });
  });

  it("allows --dry-run with --test-recipient and no --company-id - a dry run never sends regardless", () => {
    expect(parseSenderCliArgs(["--dry-run", "--test-recipient", "sarel@example.com"])).toEqual({
      dryRun: true, companyId: null, testRecipient: "sarel@example.com",
    });
  });

  it("refuses --test-recipient without --company-id and not --dry-run - would touch every real company", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    parseSenderCliArgs(["--test-recipient", "sarel@example.com"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("testIdempotencyKey", () => {
  it("prefixes the real key so a test send never burns the real one-time claim", () => {
    expect(testIdempotencyKey("discovered-tender-opp-1")).toBe("test-discovered-tender-opp-1");
  });

  it("is stable for the same real key", () => {
    expect(testIdempotencyKey("k")).toBe(testIdempotencyKey("k"));
  });
});
