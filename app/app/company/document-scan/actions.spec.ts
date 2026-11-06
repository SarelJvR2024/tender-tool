import { afterEach, describe, expect, it, vi } from "vitest";

// Server Action correctness tests for app/company/document-scan/actions.ts's
// confirmVaultDocument() and confirmIdDocument().
//
// Same bug class as 23b43b4 (app/company/registrations/actions.ts's
// saveHeldRegistration()) and the two 7345243 fixes (app/company/actions.ts's
// uploadVaultDocument(), app/company/properties/actions.ts's
// savePropertyDocument()) - but the destroyed file here is worse: it's the
// ONLY remaining copy of the onboarding-scanned document, not a superseded
// previous one.
//
// Both functions share this shape:
//   1. loadPendingResult() reads the onboarding_document_results row (and its
//      joined onboarding_uploads.storage_path) early in the request - gated
//      by that table's own RLS.
//   2. copyBetweenBuckets() does a real download-then-upload round trip
//      (genuine network time, a real race window) to copy the file from the
//      'onboarding-documents' bucket into the destination bucket.
//   3. An `update(...).eq("id", ...)` on "companies" (confirmVaultDocument)
//      or "company_principals" (confirmIdDocument) - gated by
//      is_company_member(...)-based RLS, USING only, re-evaluated against
//      the OLD row - checking only `error`.
//   4. unconditionally remove the ORIGINAL onboarding-bucket source file,
//      with no gate on step 3 having actually matched a row.
//
// If the signed-in user's own company_members row is deleted between step 1
// and step 3 - another admin calling removeMember() (remove_member_checked(),
// 0114) during the real download+upload round trip at step 2 -
// PostgREST's real behaviour for step 3 is a 2xx with zero rows affected and
// `error: null`. Pre-fix, the code then: (a) never cleans up the just-copied
// destination file (orphaned), AND (b) still unconditionally deletes the
// ORIGINAL onboarding source file at step 4 - and since the same race also
// blocks markApplied()'s own update, the onboarding_document_results row is
// left stuck on review_status "pending_review", implying the source file is
// still there to act on. The document is destroyed outright, not just
// orphaned, while the UI reports "filed".
//
// Mocking technique and chain shape copied from the established convention
// (app/company/registrations/actions.spec.ts, app/company/actions.spec.ts,
// app/company/properties/actions.spec.ts), extended with a `download` mock
// for copyBetweenBuckets()'s own storage read - calls the real, unmodified
// exported action, not a reimplementation of its logic.

type Resp = { data: unknown; error: { message: string } | null };

function makeChain(queue: Resp[], updateCalls?: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "delete", "eq", "order", "single"];
  for (const m of methods) chain[m] = () => chain;
  chain.update = (payload: unknown) => {
    updateCalls?.push(payload);
    return chain;
  };
  chain.maybeSingle = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: Resp) => void) => {
    const next = queue.shift();
    resolve(next ?? { data: null, error: null });
  };
  return chain;
}

function makeSupabase(opts: { fromQueues: Resp[][]; downloadError?: { message: string } | null; uploadError?: { message: string } | null }) {
  let fromCallIndex = 0;
  const uploadCalls: string[] = [];
  const removeCalls: string[][] = [];
  const updateCalls: unknown[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = opts.fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue, updateCalls);
      },
      storage: {
        from: () => ({
          download: async () => ({ data: opts.downloadError ? null : { size: 4 }, error: opts.downloadError ?? null }),
          upload: async (path: string) => {
            uploadCalls.push(path);
            return { data: { path }, error: opts.uploadError ?? null };
          },
          remove: async (paths: string[]) => {
            removeCalls.push(paths);
            return { data: null, error: null };
          },
        }),
      },
    },
    uploadCalls,
    removeCalls,
    updateCalls,
  };
}

const supabaseState: { current: ReturnType<typeof makeSupabase>["client"] | null } = { current: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseState.current,
}));

class RedirectSignal extends Error {
  url: string;
  constructor(url: string) {
    super("NEXT_REDIRECT");
    this.url = url;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

// Standing review, 2026-11-06: confirmIdDocument()'s certified_id_on stamp
// must come from sastToday() (lib/principals.ts's certificationStatus()
// measures "days ago" against it for a real compliance warning), not a raw
// new Date().toISOString().slice(0, 10) - that's always UTC, so it silently
// reads one calendar day early for the 00:00-01:59 SAST window every day.
// Mocked to a fixed sentinel so the test below can assert the real helper
// was actually used, not a coincidentally-matching raw UTC date.
vi.mock("@/lib/publicHolidays", () => ({
  sastToday: () => "2099-01-01",
}));

function formDataWith(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    throw new Error("expected a redirect, action returned normally");
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
}

afterEach(() => {
  vi.resetModules();
  supabaseState.current = null;
});

const pendingVaultResult = {
  data: {
    id: "result-1",
    company_id: "company-1",
    onboarding_upload_id: "upload-1",
    document_kind: "iso_9001_certificate",
    fields: {},
    review_status: "pending_review",
    onboarding_uploads: { storage_path: "company-1/onboarding/raw-iso.pdf", original_filename: "iso.pdf" },
  },
  error: null,
};

describe("confirmVaultDocument - membership revoked mid-request (companies update matches zero rows)", () => {
  it("does not report success and does not delete the only remaining copy of the document", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
        [pendingVaultResult], // loadPendingResult
        [{ data: null, error: null }], // companies update - membership revoked -> 0 rows
        [{ data: null, error: null }], // markApplied (unused result)
      ],
    });
    supabaseState.current = client;

    const { confirmVaultDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-1" });
    const url = await expectRedirect(confirmVaultDocument(fd));

    expect(url).not.toContain("saved=filed");
    expect(url).toContain("/company/document-scan?error=");

    // The onboarding source file - the document's only remaining copy at
    // this point - must NOT have been deleted.
    const removedPaths = removeCalls.flat();
    expect(removedPaths).not.toContain("company-1/onboarding/raw-iso.pdf");
  });
});

describe("confirmVaultDocument - real update still succeeds", () => {
  it("files the document and removes the onboarding source file when the update genuinely matches the row", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingVaultResult],
        [{ data: { id: "company-1" }, error: null }], // real match
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { confirmVaultDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-1" });
    const url = await expectRedirect(confirmVaultDocument(fd));

    expect(url).toContain("saved=filed");
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain("company-1/onboarding/raw-iso.pdf");
  });
});

const pendingIdResult = {
  data: {
    id: "result-2",
    company_id: "company-1",
    onboarding_upload_id: "upload-2",
    document_kind: "id_document",
    fields: {},
    review_status: "pending_review",
    onboarding_uploads: { storage_path: "company-1/onboarding/raw-id.pdf", original_filename: "id.pdf" },
  },
  error: null,
};

describe("confirmIdDocument - membership revoked mid-request (company_principals update matches zero rows)", () => {
  it("does not report success and does not delete the only remaining copy of the document", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
        [pendingIdResult], // loadPendingResult
        [{ data: { id: "principal-1" }, error: null }], // company_principals existence check
        [{ data: null, error: null }], // company_principals update - membership revoked -> 0 rows
        [{ data: null, error: null }], // markApplied (unused result)
      ],
    });
    supabaseState.current = client;

    const { confirmIdDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-2", principal_id: "principal-1" });
    const url = await expectRedirect(confirmIdDocument(fd));

    expect(url).not.toContain("saved=filed");
    expect(url).toContain("/company/document-scan?error=");

    const removedPaths = removeCalls.flat();
    expect(removedPaths).not.toContain("company-1/onboarding/raw-id.pdf");
  });
});

describe("confirmIdDocument - real update still succeeds", () => {
  it("files the document and removes the onboarding source file when the update genuinely matches the row", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingIdResult],
        [{ data: { id: "principal-1" }, error: null }],
        [{ data: { id: "principal-1" }, error: null }], // real match
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { confirmIdDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-2", principal_id: "principal-1" });
    const url = await expectRedirect(confirmIdDocument(fd));

    expect(url).toContain("saved=filed");
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain("company-1/onboarding/raw-id.pdf");
  });
});

describe("confirmIdDocument - certified_id_on is SAST-anchored, not a naive UTC date", () => {
  it("stamps certified_id_on from sastToday(), not new Date().toISOString().slice(0, 10)", async () => {
    const { client, updateCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingIdResult],
        [{ data: { id: "principal-1" }, error: null }],
        [{ data: { id: "principal-1" }, error: null }], // real match
        [{ data: null, error: null }],
      ],
    });
    supabaseState.current = client;

    const { confirmIdDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-2", principal_id: "principal-1" });
    await expectRedirect(confirmIdDocument(fd));

    const principalUpdate = updateCalls.find(
      (c): c is { certified_id_on: string } => typeof c === "object" && c !== null && "certified_id_on" in c,
    );
    expect(principalUpdate?.certified_id_on).toBe("2099-01-01");
  });
});

// discardOnboardingDocument() - a sibling of confirmVaultDocument()/
// confirmIdDocument() above, in this SAME file, never checked before this
// pass (found re-reading the whole file end to end for siblings of its own
// already-fixed functions, standing review, 2026-11-06). Pre-fix it did
// `.update({ review_status: "discarded" }).eq("id", result.id)` with NO
// check at all - not even `error` - then unconditionally removed the
// upload's storage file regardless. A membership-revoked-mid-request zero-
// row match left the file destroyed while onboarding_document_results
// stayed stuck on "pending_review" with nothing left to review.
const pendingDiscardResult = {
  data: {
    id: "result-3",
    company_id: "company-1",
    onboarding_upload_id: "upload-3",
    document_kind: "unknown",
    fields: {},
    review_status: "pending_review",
    onboarding_uploads: { storage_path: "company-1/onboarding/raw-discard.pdf", original_filename: "discard.pdf" },
  },
  error: null,
};

describe("discardOnboardingDocument - membership revoked mid-request (update matches zero rows)", () => {
  it("does not report success and does not delete the file", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
        [pendingDiscardResult], // loadPendingResult
        [{ data: null, error: null }], // discard update - membership revoked -> 0 rows
      ],
    });
    supabaseState.current = client;

    const { discardOnboardingDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-3" });
    const url = await expectRedirect(discardOnboardingDocument(fd));

    expect(url).not.toContain("saved=discarded");
    expect(url).toContain("/company/document-scan?error=");
    const removedPaths = removeCalls.flat();
    expect(removedPaths).not.toContain("company-1/onboarding/raw-discard.pdf");
  });
});

describe("discardOnboardingDocument - real update still succeeds", () => {
  it("discards and removes the file when the update genuinely matches the row", async () => {
    const { client, removeCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingDiscardResult],
        [{ data: { id: "result-3" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { discardOnboardingDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-3" });
    const url = await expectRedirect(discardOnboardingDocument(fd));

    expect(url).toContain("saved=discarded");
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain("company-1/onboarding/raw-discard.pdf");
  });
});

// skipOnboardingDocument() - another sibling, in this SAME file, never
// checked before this pass (TS-sweep's own "actions.ts out of scope"
// continuation, standing review, 2026-11-06). Pre-fix it did
// `.update({ review_status: "skipped" }).eq("id", result.id)` with NO check
// at all - not even `error` - then unconditionally redirected with
// "saved=skipped". A membership-revoked-mid-request zero-row match left the
// row stuck on "pending_review" (so it silently stays in the "To review"
// queue) while the UI still reported the skip as having worked.
const pendingSkipResult = {
  data: {
    id: "result-4",
    company_id: "company-1",
    onboarding_upload_id: "upload-4",
    document_kind: "unknown",
    fields: {},
    review_status: "pending_review",
    onboarding_uploads: { storage_path: "company-1/onboarding/raw-skip.pdf", original_filename: "skip.pdf" },
  },
  error: null,
};

describe("skipOnboardingDocument - membership revoked mid-request (update matches zero rows)", () => {
  it("does not report success", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
        [pendingSkipResult], // loadPendingResult
        [{ data: null, error: null }], // skip update - membership revoked -> 0 rows
      ],
    });
    supabaseState.current = client;

    const { skipOnboardingDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-4" });
    const url = await expectRedirect(skipOnboardingDocument(fd));

    expect(url).not.toContain("saved=skipped");
    expect(url).toContain("/company/document-scan?error=");
  });
});

describe("skipOnboardingDocument - real update still succeeds", () => {
  it("reports success when the update genuinely matches the row", async () => {
    const { client } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingSkipResult],
        [{ data: { id: "result-4" }, error: null }], // real match
      ],
    });
    supabaseState.current = client;

    const { skipOnboardingDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-4" });
    const url = await expectRedirect(skipOnboardingDocument(fd));

    expect(url).toContain("saved=skipped");
  });
});
