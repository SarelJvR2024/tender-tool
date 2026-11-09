/**
 * Pure-logic tests for the bulk-CV-upload chunking helpers (Finding 272,
 * standing review, 2026-11-09). Same pattern as uploadBatch.test.ts: no
 * DOM, no Supabase, no React - just the pure functions bulk-cv-upload.tsx
 * builds its real Server Action calls from.
 *
 * Run: node --experimental-strip-types --test app/app/people/_components/bulkCvChunking.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkRowsBySize, rowsToFormData, type ChunkableRow } from "./bulkCvChunking.ts";

const MAX = 4.4 * 1024 * 1024;

function row(name: string, sizeBytes: number, kind: "existing" | "new" = "new", personId = "", rowName = name): ChunkableRow {
  return { file: { size: sizeBytes }, kind, personId, name: rowName };
}

test("chunkRowsBySize: several small files that together stay under the limit form ONE chunk", () => {
  const rows = [row("a.pdf", 1_000_000), row("b.pdf", 1_000_000), row("c.pdf", 1_000_000)];
  const chunks = chunkRowsBySize(rows, MAX);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 3);
});

test("chunkRowsBySize: two files that together exceed the limit split into two chunks (the real Finding 272 shape)", () => {
  // Exactly the repro this finding confirmed live: two ~3 MB files, each
  // comfortably under the 4.4 MB per-file cap, but 6 MB together - over
  // Vercel's real 4.5 MB Server Action body ceiling.
  const rows = [row("cv1.pdf", 3_000_000), row("cv2.pdf", 3_000_000)];
  const chunks = chunkRowsBySize(rows, MAX);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 1);
  assert.equal(chunks[1].length, 1);
  assert.equal(chunks[0][0].file.size, 3_000_000);
  assert.equal(chunks[1][0].file.size, 3_000_000);
});

test("chunkRowsBySize: a single file right at the per-file cap still gets its own chunk, never split or dropped", () => {
  const rows = [row("big.pdf", MAX)];
  const chunks = chunkRowsBySize(rows, MAX);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 1);
});

test("chunkRowsBySize: a mixed batch packs greedily - small files fill a chunk until the next one would overflow it", () => {
  const rows = [
    row("a.pdf", 2_000_000),
    row("b.pdf", 2_000_000),
    row("c.pdf", 2_000_000), // a+b+c = 6,000,000 > MAX, so c must start a new chunk
    row("d.pdf", 1_000_000), // fits with c (3,000,000 <= MAX)
  ];
  const chunks = chunkRowsBySize(rows, MAX);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].map((r) => r.name), ["a.pdf", "b.pdf"]);
  assert.deepEqual(chunks[1].map((r) => r.name), ["c.pdf", "d.pdf"]);
});

test("chunkRowsBySize: every row from the input batch appears exactly once across all chunks, none dropped or duplicated", () => {
  const rows = [
    row("a.pdf", 4_000_000),
    row("b.pdf", 500_000),
    row("c.pdf", 4_000_000),
    row("d.pdf", 4_000_000),
    row("e.pdf", 100),
  ];
  const chunks = chunkRowsBySize(rows, MAX);
  const flat = chunks.flat();
  assert.equal(flat.length, rows.length);
  assert.deepEqual(flat.map((r) => r.name).sort(), rows.map((r) => r.name).sort());
  for (const c of chunks) {
    const total = c.reduce((sum, r) => sum + r.file.size, 0);
    assert.ok(total <= MAX, `chunk total ${total} must not exceed ${MAX}`);
  }
});

test("chunkRowsBySize: an empty batch produces no chunks", () => {
  assert.deepEqual(chunkRowsBySize([], MAX), []);
});

test("rowsToFormData: builds the exact field shape bulkUploadCvs() expects, for both existing and new rows", () => {
  const existingRow = { file: new File(["x"], "existing.pdf"), kind: "existing" as const, personId: "person-9", name: "" };
  const newRow = { file: new File(["y"], "new.pdf"), kind: "new" as const, personId: "", name: "  Jane Doe  " };
  const fd = rowsToFormData([existingRow, newRow], "ai_extract");

  assert.equal(fd.get("count"), "2");
  assert.equal(fd.get("mode"), "ai_extract");
  assert.equal(fd.get("kind_0"), "existing");
  assert.equal(fd.get("person_id_0"), "person-9");
  assert.equal(fd.get("name_0"), null);
  assert.equal(fd.get("kind_1"), "new");
  // Name is trimmed, same as the server action's own str() helper would do
  // anyway - but trimming here means the chunk's own per-row name is never
  // silently different from what the user actually typed, before or after
  // chunking.
  assert.equal(fd.get("name_1"), "Jane Doe");
  assert.equal(fd.get("person_id_1"), null);
});
