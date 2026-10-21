import { describe, expect, it } from "vitest";
import { byUrgency, detailFor, statusFor, type DocumentExpiryRow } from "./documentExpiry";

function row(overrides: Partial<DocumentExpiryRow>): DocumentExpiryRow {
  return { id: "x", label: "X", status: "valid", daysLeft: 100, detail: "", href: "/company", ...overrides };
}

describe("statusFor", () => {
  it("null is missing (no expiry date on file at all)", () => {
    expect(statusFor(null)).toBe("missing");
  });
  it("negative is expired", () => {
    expect(statusFor(-1)).toBe("expired");
  });
  it("0 to 30 days is expiring_soon, inclusive of the boundary", () => {
    expect(statusFor(0)).toBe("expiring_soon");
    expect(statusFor(30)).toBe("expiring_soon");
  });
  it("31+ days is valid", () => {
    expect(statusFor(31)).toBe("valid");
  });
});

describe("detailFor", () => {
  it("missing has no day count", () => {
    expect(detailFor(null, "missing")).toBe("No expiry date on file.");
  });
  it("expired counts days in the past, singular for 1 day", () => {
    expect(detailFor(-5, "expired")).toBe("Expired 5 days ago.");
    expect(detailFor(-1, "expired")).toBe("Expired 1 day ago.");
  });
  it("expiring_soon and valid count days ahead, singular for 1 day", () => {
    expect(detailFor(10, "expiring_soon")).toBe("Expires in 10 days.");
    expect(detailFor(1, "expiring_soon")).toBe("Expires in 1 day.");
  });
});

describe("byUrgency", () => {
  it("sorts expired, then expiring soon, then missing, then valid", () => {
    const rows = [
      row({ id: "valid", status: "valid", daysLeft: 200 }),
      row({ id: "missing", status: "missing", daysLeft: null }),
      row({ id: "expired", status: "expired", daysLeft: -3 }),
      row({ id: "expiring", status: "expiring_soon", daysLeft: 10 }),
    ];
    const sorted = [...rows].sort(byUrgency).map((r) => r.id);
    expect(sorted).toEqual(["expired", "expiring", "missing", "valid"]);
  });

  it("within the same status, sorts by days left ascending (most urgent first)", () => {
    const rows = [row({ id: "a", status: "expiring_soon", daysLeft: 20 }), row({ id: "b", status: "expiring_soon", daysLeft: 5 })];
    const sorted = [...rows].sort(byUrgency).map((r) => r.id);
    expect(sorted).toEqual(["b", "a"]);
  });
});
