import { describe, expect, it } from "vitest";
import { byUrgency, detailFor, statusFor, type DocumentExpiryRow } from "./documentExpiry";
import { COMPANY_EXPIRY_FIELDS } from "./companyExpiryFields";
import { VAULT_DOCUMENTS } from "./vaultDocuments";

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

describe("COMPANY_EXPIRY_FIELDS kind/pathField wiring", () => {
  // loadDocumentExpiryOverview() casts `kind` with `as VaultDocumentKind`
  // (companyExpiryFields.ts deliberately stays import-free - see its own
  // header comment - so it can't import the real union type to check
  // itself against). This guards the one thing that cast can't: every
  // literal `kind` here must be a real VAULT_DOCUMENTS key, or the Document
  // expiry overview's inline upload row would silently render for a kind
  // DocumentUploadAction/VAULT_DOCUMENTS has never heard of.
  it("every kind is a real Document Vault key, and every vault key is covered", () => {
    const fieldKinds = COMPANY_EXPIRY_FIELDS.map((f) => f.kind).sort();
    const vaultKinds = Object.keys(VAULT_DOCUMENTS).sort();
    expect(fieldKinds).toEqual(vaultKinds);
  });

  it("every pathField matches that kind's own VAULT_DOCUMENTS column - so hasExisting reads the right company column", () => {
    for (const { kind, pathField } of COMPANY_EXPIRY_FIELDS) {
      expect(pathField).toBe(VAULT_DOCUMENTS[kind as keyof typeof VAULT_DOCUMENTS].column);
    }
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
