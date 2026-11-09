// Pure chunking/FormData-building logic for the bulk CV upload screen,
// extracted from bulk-cv-upload.tsx so it can be tested directly by plain
// Node (node --experimental-strip-types, no bundler) - the same reason
// uploadBatch.ts was extracted from its own original caller (see that
// file's own header comment). A .tsx file with real JSX in it can't be
// imported this way; this file has none.
//
// Finding 272 (standing review, 2026-11-09): bulkUploadCvs()
// (app/app/people/actions.ts) sends every row's own file bytes through ONE
// Server Action request, and Vercel's per-function request-body ceiling
// (next.config.ts's `serverActions.bodySizeLimit`, "4.5mb") applies to that
// WHOLE request, not per file - confirmed live (see bulkUploadCvs()'s own
// header comment for the exact repro) that two files well under this
// screen's own per-file MAX_CV_BYTES cap (4.4 MB), sent together, already
// fail every time with a 413. chunkRowsBySize() splits a real batch into
// several smaller groups instead, each kept under the same per-file ceiling
// this codebase already relies on for a single file (uploadCv()/
// createPersonWithCv() each already send one file this close to the cap,
// proven safe) - a greedy bin-pack, not a fixed files-per-call count, since
// CVs vary wildly in size.

export type ChunkableRow = { file: { size: number }; kind: "existing" | "new"; personId: string; name: string };

/** Pure: group rows so each group's own total file size stays <= maxBytes,
 * without ever splitting a single row (every individual row is assumed to
 * already be <= maxBytes on its own - the caller's own per-file check). */
export function chunkRowsBySize<T extends ChunkableRow>(rows: T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const row of rows) {
    if (current.length > 0 && currentBytes + row.file.size > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(row);
    currentBytes += row.file.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Pure: the exact FormData shape bulkUploadCvs() (app/app/people/actions.ts)
 * expects for one chunk - count/mode plus kind_<i>/file_<i>/person_id_<i>
 * or name_<i> for i = 0..rows.length-1. */
export function rowsToFormData<T extends { file: File; kind: "existing" | "new"; personId: string; name: string }>(
  rows: T[],
  mode: "ai_extract" | "as_is",
): FormData {
  const fd = new FormData();
  fd.append("count", String(rows.length));
  fd.append("mode", mode);
  rows.forEach((r, i) => {
    fd.append(`kind_${i}`, r.kind);
    fd.append(`file_${i}`, r.file);
    if (r.kind === "existing") fd.append(`person_id_${i}`, r.personId);
    else fd.append(`name_${i}`, r.name.trim());
  });
  return fd;
}
