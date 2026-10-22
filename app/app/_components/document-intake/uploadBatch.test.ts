/**
 * Pure-logic tests for the shared document-intake upload engine (spec v3
 * Batch 2). No Supabase, no DOM - same pattern as onboardingScan.test.ts.
 * The behaviour these pin: a failed file never discards, hides or alters
 * any other file in the same batch (the original upload-form.tsx bug this
 * batch fixes - see uploadBatch.ts's own header comment).
 *
 * Run: node --experimental-strip-types --test app/app/_components/document-intake/uploadBatch.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyUploadResult, markUploading, partitionBatch, type FileUploadState } from "./uploadBatch.ts";

function file(name: string): File {
  return new File(["x"], name, { type: "application/pdf" });
}

test("markUploading: every queued or previously-failed file moves to uploading; nothing else does", () => {
  const states: FileUploadState[] = [
    { file: file("a.pdf"), status: "queued" },
    { file: file("b.pdf"), status: "failed", error: "boom" },
    { file: file("c.pdf"), status: "uploaded", storagePath: "x/c.pdf" },
  ];
  const next = markUploading(states);
  assert.equal(next[0].status, "uploading");
  assert.equal(next[1].status, "uploading");
  assert.equal(next[2].status, "uploaded"); // already-done file is untouched
});

test("applyUploadResult: a failure for one file never touches another file's slot", () => {
  const states: FileUploadState[] = [
    { file: file("a.pdf"), status: "uploading" },
    { file: file("b.pdf"), status: "uploading" },
    { file: file("c.pdf"), status: "uploading" },
  ];
  let next = applyUploadResult(states, 0, { ok: true, storagePath: "co/a.pdf" });
  next = applyUploadResult(next, 1, { ok: false, error: "network error" });
  next = applyUploadResult(next, 2, { ok: true, storagePath: "co/c.pdf" });

  assert.equal(next[0].status, "uploaded");
  assert.equal((next[0] as { storagePath: string }).storagePath, "co/a.pdf");
  assert.equal(next[1].status, "failed");
  assert.equal((next[1] as { error: string }).error, "network error");
  assert.equal(next[2].status, "uploaded");
  assert.equal((next[2] as { storagePath: string }).storagePath, "co/c.pdf");
});

test("partitionBatch: succeeded/failed/pending split correctly, and a failed file is never counted as succeeded", () => {
  const states: FileUploadState[] = [
    { file: file("a.pdf"), status: "uploaded", storagePath: "co/a.pdf" },
    { file: file("b.pdf"), status: "failed", error: "boom" },
    { file: file("c.pdf"), status: "uploaded", storagePath: "co/c.pdf" },
    { file: file("d.pdf"), status: "uploading" },
  ];
  const { succeeded, failed, pending } = partitionBatch(states);
  assert.equal(succeeded.length, 2);
  assert.deepEqual(succeeded.map((s) => s.storagePath).sort(), ["co/a.pdf", "co/c.pdf"]);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].error, "boom");
  assert.equal(pending, true); // the still-uploading file means this batch isn't fully settled yet
});

test("partitionBatch: a fully settled batch (nothing queued/uploading) reports pending=false", () => {
  const states: FileUploadState[] = [
    { file: file("a.pdf"), status: "uploaded", storagePath: "co/a.pdf" },
    { file: file("b.pdf"), status: "failed", error: "boom" },
  ];
  assert.equal(partitionBatch(states).pending, false);
});

test("a 3-file batch where only the middle file fails still returns both outer files as succeeded (the regression this batch fixes)", () => {
  // Simulates uploadBatch()'s own loop without the network call: apply
  // results in order, exactly as the real function does, and confirm the
  // two successful files survive a sibling's failure instead of being
  // rolled back and discarded (the pre-fix upload-form.tsx behaviour).
  let states: FileUploadState[] = markUploading([
    { file: file("a.pdf"), status: "queued" },
    { file: file("b.pdf"), status: "queued" },
    { file: file("c.pdf"), status: "queued" },
  ]);
  states = applyUploadResult(states, 0, { ok: true, storagePath: "co/a.pdf" });
  states = applyUploadResult(states, 1, { ok: false, error: "Could not upload b.pdf - try again." });
  states = applyUploadResult(states, 2, { ok: true, storagePath: "co/c.pdf" });

  const { succeeded, failed } = partitionBatch(states);
  assert.equal(succeeded.length, 2, "a.pdf and c.pdf must both still be registerable after b.pdf failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].file.name, "b.pdf");
});
