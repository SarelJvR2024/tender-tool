import { describe, expect, it } from "vitest";
import { cleanDocuments } from "@/lib/manualTender";

// cleanDocuments() correctness test (the function itself lives in
// @/lib/manualTender, not here - see that module's own comment for why a
// "use server" file's plain sync helpers can't be exported/unit-tested
// directly from the actions.ts file that calls them).
//
// The bug this guards against: cleanDocuments() rejected a storage_path
// containing the bare SUBSTRING ".." anywhere in it, not just a real ".."
// path-traversal SEGMENT. app/lib/safeFileName.ts (the one shared filename
// sanitizer every upload path in this app uses, including
// app/app/_components/document-intake/uploadBatch.ts's own uploadBatch() -
// what manual-tender-form.tsx actually calls) keeps '.' in its allowed
// character set, so an entirely ordinary document named e.g.
// "Tender Notice..pdf" (a version marker, an export tool's naming, a simple
// typo) produced a storage_path containing the substring "..", and
// cleanDocuments() returned null for the WHOLE batch - silently failing
// registerManualTender()/addManualTenderDocuments()/addPrivateTenderDocuments()
// with "Upload at least one of the tender's own documents." even though
// every file really was uploaded under this company's own folder. Finding 35
// (2026-10-20) found and fixed the identical false positive in
// engine/onboarding/process_onboarding_jobs.py's own inline check, but it
// was never swept here, or to the matching SQL-level checks the standing
// review's own 0135 migration fixes.

const PREFIX = "manual/22222222-2222-2222-2222-222222222222/66666666-6666-6666-6666-666666666666/";

describe("cleanDocuments", () => {
  it("accepts a legitimate filename with two consecutive dots, under the right prefix", () => {
    const out = cleanDocuments(
      [{ title: "Tender Notice..pdf", storage_path: `${PREFIX}abc12345-Tender Notice..pdf` }],
      PREFIX,
    );
    expect(out).not.toBeNull();
    expect(out).toHaveLength(1);
    expect(out![0].storage_path).toBe(`${PREFIX}abc12345-Tender Notice..pdf`);
  });

  it("still rejects a real '..' path-traversal segment", () => {
    const out = cleanDocuments(
      [{ title: "x.pdf", storage_path: `manual/22222222-2222-2222-2222-222222222222/../other/x.pdf` }],
      PREFIX,
    );
    expect(out).toBeNull();
  });

  it("still rejects a path outside the given prefix entirely", () => {
    const out = cleanDocuments(
      [{ title: "x.pdf", storage_path: "manual/99999999-9999-9999-9999-999999999999/other/x.pdf" }],
      PREFIX,
    );
    expect(out).toBeNull();
  });

  it("still rejects when any ONE document in the batch fails, even if the others are fine", () => {
    const out = cleanDocuments(
      [
        { title: "ok.pdf", storage_path: `${PREFIX}aaa-ok.pdf` },
        { title: "bad.pdf", storage_path: `manual/22222222-2222-2222-2222-222222222222/../x.pdf` },
      ],
      PREFIX,
    );
    expect(out).toBeNull();
  });
});
