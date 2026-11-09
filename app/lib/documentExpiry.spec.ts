import { afterEach, describe, expect, it, vi } from "vitest";
import { byUrgency, detailFor, statusFor, loadDocumentExpiryOverview, type DocumentExpiryRow } from "./documentExpiry";
import { COMPANY_EXPIRY_FIELDS } from "./companyExpiryFields";
import { VAULT_DOCUMENTS } from "./vaultDocuments";

// Standing solution-architect review, 2026-11-06: loadDocumentExpiryOverview()
// used to destructure all 4 of its parallel reads as just `{ data }`, with no
// error captured at all - a 4th blind spot in the standing TS-sweep's own
// grep (array/tuple Promise.all destructures never match its literal
// "const { data" pattern, same root cause as this pass's other finds). A
// real failure on any of the 4 reads was indistinguishable from "nothing
// tracked yet", and both callers (dashboard/page.tsx's "Vault & compliance
// health" card, DocumentExpiryOverview.tsx) treated a genuinely empty
// result as 100% compliant / "every tracked document is valid" - the
// dangerous direction this sweep looks for, not just a logging gap, on the
// one widget whose whole job is catching real compliance gaps before a bid.
// These tests exercise the fix directly against the real, unmodified
// function, using the same sequential-response-queue mocking convention as
// savingsCounterData.spec.ts.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(resp: Resp) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "order", "eq", "in", "maybeSingle"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => resolve(resp);
  return chain;
}

// Call order inside loadDocumentExpiryOverview(): companies, held_registrations, registration_types, people.
function makeSupabase(companyResp: Resp, heldResp: Resp, typeResp: Resp, peopleResp: Resp) {
  const queue = [companyResp, heldResp, typeResp, peopleResp];
  let i = 0;
  return {
    from: () => makeChain(queue[i++] ?? { data: null, error: null }),
  } as unknown as Parameters<typeof loadDocumentExpiryOverview>[0];
}

const EMPTY_OK: Resp = { data: [], error: null };

describe("loadDocumentExpiryOverview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error: false and an empty row set on the genuine 'nothing tracked yet' case", async () => {
    const supabase = makeSupabase({ data: null, error: null }, EMPTY_OK, EMPTY_OK, EMPTY_OK);
    const { rows, error } = await loadDocumentExpiryOverview(supabase);
    expect(rows).toEqual([]);
    expect(error).toBe(false);
  });

  it("returns error: true (not a plain empty/all-valid result) when the companies read fails", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeSupabase({ data: null, error: { message: "connection reset" } }, EMPTY_OK, EMPTY_OK, EMPTY_OK);
    const { rows, error } = await loadDocumentExpiryOverview(supabase);
    // Pre-fix this looked identical to the genuine empty-vault case above -
    // the whole point of this test is that it no longer does, so a caller
    // can no longer read it as "100% compliant".
    expect(rows).toEqual([]);
    expect(error).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("companies select failed (document expiry overview)", { message: "connection reset" });
  });

  it("returns error: true when the held_registrations read fails, even though every other read succeeded", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeSupabase({ data: null, error: null }, { data: null, error: { message: "timeout" } }, EMPTY_OK, EMPTY_OK);
    const { error } = await loadDocumentExpiryOverview(supabase);
    expect(error).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("held_registrations select failed (document expiry overview)", { message: "timeout" });
  });

  it("returns error: false and the real rows on the ordinary success path", async () => {
    const supabase = makeSupabase(
      { data: null, error: null },
      { data: [{ id: "h1", expiry_date: "2020-01-01", registration_type_id: "t1" }], error: null },
      { data: [{ id: "t1", label: "Fire certificate" }], error: null },
      EMPTY_OK,
    );
    const { rows, error } = await loadDocumentExpiryOverview(supabase);
    expect(error).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "held:h1", label: "Fire certificate", status: "expired" });
  });
});

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

  // Finding 293 (2026-11-09): statusFor()'s own flat 30-day window ignores
  // each COMPANY_EXPIRY_FIELDS entry's `windowDays` - unlike
  // notifications.ts's getNotifications(), which reads `windowDays ??
  // DOCUMENT_WINDOW_DAYS` (60) per field. Locking in the real, confirmed-
  // live consequence here (not changing it - this file's own header and
  // EXPIRING_SOON_WINDOW_DAYS comments explain why, and whether it should
  // ever change is Sarel's call): a document 31-60 days from expiry reads
  // "Valid" (green, excluded from the "N documents need attention" count)
  // on this overview while the bell is already showing an amber "renew
  // soon" notification for the identical document. If a future change
  // makes statusFor() windowDays-aware, this test should be updated
  // deliberately, not silently broken.
  it("disagrees with notifications.ts's own 60-day default window for 31-60 days left - deliberate, not a regression", () => {
    const bellDefaultWindowDays = 60; // lib/notifications.ts's own DOCUMENT_WINDOW_DAYS
    for (const daysLeft of [31, 45, 60]) {
      expect(statusFor(daysLeft)).toBe("valid"); // this overview: nothing to see here
      expect(daysLeft <= bellDefaultWindowDays).toBe(true); // the bell: already nagging
    }
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
