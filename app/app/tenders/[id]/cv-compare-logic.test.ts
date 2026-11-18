/**
 * Regression test for cv-compare-logic.ts - Finding 496: CvCompare's own
 * "Tailored (this tender)" preview picked the newest generated_cvs row by
 * `requested_at`, while the real pack builder
 * (engine/pack/process_pack_jobs.py's cv_download_target(), via gather()'s
 * CV loop) picks the newest by `completed_at` among rows that actually
 * have a `storage_path_pdf` - a different variant could finish generating
 * after a later-requested one, making the preview show a CV the real pack
 * would not actually use.
 *
 * Run: node --experimental-strip-types --test "app/app/tenders/[id]/cv-compare-logic.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickTailoredCv } from "./cv-compare-logic.ts";

test("no rows at all: null", () => {
  assert.equal(pickTailoredCv([]), null);
});

test("one ready row with a PDF: picked", () => {
  const rows = [{ id: "a", storage_path_pdf: "a.pdf", storage_path_docx: "a.docx", format: "sanral_keyperson", detail: "summary", completed_at: "2026-11-18T10:00:00Z" }];
  assert.equal(pickTailoredCv(rows)!.id, "a");
});

test("the real bug: requested second but finished first still loses to the one that finished LAST, not the one requested last", () => {
  // "detailed" requested first (takes longer), "summary" requested second
  // (quicker) but finishes first. The real pack builder orders by
  // completed_at, so it picks "detailed" - the one that finished last.
  const rows = [
    { id: "detailed", storage_path_pdf: "d.pdf", storage_path_docx: null, format: "sanral_keyperson", detail: "detailed", completed_at: "2026-11-18T10:05:00Z" },
    { id: "summary", storage_path_pdf: "s.pdf", storage_path_docx: null, format: "sanral_keyperson", detail: "summary", completed_at: "2026-11-18T10:02:00Z" },
  ];
  assert.equal(pickTailoredCv(rows)!.id, "detailed");
});

test("a ready row with no PDF (conversion never produced one) is never picked, even if it's the newest", () => {
  // The real pack builder's cv_download_target() requires storage_path_pdf
  // truthy - a docx-only ready row is invisible to it, falling back to the
  // person's as-is upload instead. This preview must match that exactly.
  const rows = [
    { id: "pdf-older", storage_path_pdf: "old.pdf", storage_path_docx: null, format: "world_bank", detail: "summary", completed_at: "2026-11-18T09:00:00Z" },
    { id: "docx-only-newest", storage_path_pdf: null, storage_path_docx: "newest.docx", format: "world_bank", detail: "detailed", completed_at: "2026-11-18T11:00:00Z" },
  ];
  assert.equal(pickTailoredCv(rows)!.id, "pdf-older");
});

test("every ready row lacks a PDF: null, same as 'not generated yet' - never shows a docx-only row as the tailored CV", () => {
  const rows = [{ id: "a", storage_path_pdf: null, storage_path_docx: "a.docx", format: "sanral_keyperson", detail: "summary", completed_at: "2026-11-18T10:00:00Z" }];
  assert.equal(pickTailoredCv(rows), null);
});

test("three variants, picks the one that completed last among those with a PDF", () => {
  const rows = [
    { id: "first", storage_path_pdf: "f.pdf", storage_path_docx: null, format: "sanral_keyperson", detail: "summary", completed_at: "2026-11-18T08:00:00Z" },
    { id: "last", storage_path_pdf: "l.pdf", storage_path_docx: null, format: "world_bank", detail: "detailed", completed_at: "2026-11-18T12:00:00Z" },
    { id: "middle", storage_path_pdf: "m.pdf", storage_path_docx: null, format: "sanral_keyperson", detail: "detailed", completed_at: "2026-11-18T10:00:00Z" },
  ];
  assert.equal(pickTailoredCv(rows)!.id, "last");
});
