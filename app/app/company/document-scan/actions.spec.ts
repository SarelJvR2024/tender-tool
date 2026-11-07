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
//      by that table's own RLS (an informational pre-check only; see below).
//   2. copyBetweenBuckets() does a real download-then-upload round trip
//      (genuine network time, a real race window) to copy the file from the
//      'onboarding-documents' bucket into the destination bucket.
//   3. (standing review, 2026-11-07, Finding 185) ONE locked RPC call -
//      apply_onboarding_vault_document_checked() / apply_onboarding_id_document_checked()
//      (migration 0124) - that re-locks the onboarding_document_results row,
//      re-checks company membership/not-employee and review_status under
//      that lock, writes the destination table, and marks the row applied,
//      all in one transaction. Before this fix, step 3 was an unlocked
//      `update(...).eq("id", ...)` with no re-check of review_status at all -
//      the TypeScript analog of the Finding-178/180/184 read-then-write race:
//      two concurrent confirms of the SAME onboarding document (double-click,
//      two tabs) both passed loadPendingResult()'s gate and both wrote,
//      silently re-filing an already-reviewed document with no error to
//      either caller (and, pre-0124, a membership-revoked-mid-request zero-
//      row match on that same unlocked update also destroyed the only
//      remaining copy of the document - the original bug this file's tests
//      were first written for, 2026-11-06).
//   4. remove the ORIGINAL onboarding-bucket source file, gated on step 3's
//      RPC call having actually succeeded.
//
// The RPC is mocked as a black box here (success or a named error) - its own
// real lock-check-write behaviour is verified against a real Postgres
// instance separately (see this pass's own scratch-DB reproduction,
// docs/specs/QA-Edge-Case-Findings.md Finding 185), not re-derived at the
// mock layer.
//
// Mocking technique and chain shape copied from the established convention
// (app/company/registrations/actions.spec.ts, app/company/actions.spec.ts,
// app/company/properties/actions.spec.ts), extended with a `download` mock
// for copyBetweenBuckets()'s own storage read and an `rpc` mock for the
// locked confirm calls - calls the real, unmodified exported action, not a
// reimplementation of its logic.

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

function makeSupabase(opts: {
  fromQueues: Resp[][];
  downloadError?: { message: string } | null;
  uploadError?: { message: string } | null;
  rpcResponse?: { error: { message: string } | null };
}) {
  let fromCallIndex = 0;
  const uploadCalls: string[] = [];
  const removeCalls: string[][] = [];
  const updateCalls: unknown[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => {
        const queue = opts.fromQueues[fromCallIndex] ?? [];
        fromCallIndex += 1;
        return makeChain(queue, updateCalls);
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return opts.rpcResponse ?? { data: null, error: null };
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
    rpcCalls,
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

describe("confirmVaultDocument - apply_onboarding_vault_document_checked() reports already-reviewed/not-found", () => {
  it("does not report success and does not delete the only remaining copy of the document", async () => {
    const { client, removeCalls, rpcCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
        [pendingVaultResult], // loadPendingResult
      ],
      rpcResponse: { error: { message: "This document was already reviewed." } },
    });
    supabaseState.current = client;

    const { confirmVaultDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-1" });
    const url = await expectRedirect(confirmVaultDocument(fd));

    expect(url).not.toContain("saved=filed");
    expect(url).toContain("/company/document-scan?error=");
    expect(rpcCalls[0]?.fn).toBe("apply_onboarding_vault_document_checked");

    // The onboarding source file - the document's only remaining copy at
    // this point - must NOT have been deleted.
    const removedPaths = removeCalls.flat();
    expect(removedPaths).not.toContain("company-1/onboarding/raw-iso.pdf");
  });
});

describe("confirmVaultDocument - the locked RPC succeeds", () => {
  it("files the document and removes the onboarding source file when the RPC genuinely applies", async () => {
    const { client, removeCalls, rpcCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingVaultResult],
      ],
      rpcResponse: { error: null },
    });
    supabaseState.current = client;

    const { confirmVaultDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-1" });
    const url = await expectRedirect(confirmVaultDocument(fd));

    expect(url).toContain("saved=filed");
    expect(rpcCalls[0]?.args.p_result_id).toBe("result-1");
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

describe("confirmIdDocument - apply_onboarding_id_document_checked() reports already-reviewed/not-found", () => {
  it("does not report success and does not delete the only remaining copy of the document", async () => {
    const { client, removeCalls, rpcCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }], // requireCompanyId
        [pendingIdResult], // loadPendingResult
        [{ data: { id: "principal-1" }, error: null }], // company_principals existence pre-check
      ],
      rpcResponse: { error: { message: "This document was already reviewed." } },
    });
    supabaseState.current = client;

    const { confirmIdDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-2", principal_id: "principal-1" });
    const url = await expectRedirect(confirmIdDocument(fd));

    expect(url).not.toContain("saved=filed");
    expect(url).toContain("/company/document-scan?error=");
    expect(rpcCalls[0]?.fn).toBe("apply_onboarding_id_document_checked");

    const removedPaths = removeCalls.flat();
    expect(removedPaths).not.toContain("company-1/onboarding/raw-id.pdf");
  });
});

describe("confirmIdDocument - the locked RPC succeeds", () => {
  it("files the document and removes the onboarding source file when the RPC genuinely applies", async () => {
    const { client, removeCalls, rpcCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingIdResult],
        [{ data: { id: "principal-1" }, error: null }],
      ],
      rpcResponse: { error: null },
    });
    supabaseState.current = client;

    const { confirmIdDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-2", principal_id: "principal-1" });
    const url = await expectRedirect(confirmIdDocument(fd));

    expect(url).toContain("saved=filed");
    expect(rpcCalls[0]?.args.p_principal_id).toBe("principal-1");
    const removedPaths = removeCalls.flat();
    expect(removedPaths).toContain("company-1/onboarding/raw-id.pdf");
  });
});

describe("confirmIdDocument - certified_id_on is SAST-anchored, not a naive UTC date", () => {
  it("stamps certified_id_on from sastToday(), not new Date().toISOString().slice(0, 10)", async () => {
    const { client, rpcCalls } = makeSupabase({
      fromQueues: [
        [{ data: { company_id: "company-1" }, error: null }],
        [pendingIdResult],
        [{ data: { id: "principal-1" }, error: null }],
      ],
      rpcResponse: { error: null },
    });
    supabaseState.current = client;

    const { confirmIdDocument } = await import("./actions");

    const fd = formDataWith({ result_id: "result-2", principal_id: "principal-1" });
    await expectRedirect(confirmIdDocument(fd));

    expect(rpcCalls[0]?.args.p_certified_on).toBe("2099-01-01");
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
