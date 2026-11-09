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

// Finding 273 (standing review, 2026-11-09v): chunkRowsBySize() originally
// bounded only the RAW FILE BYTES in a chunk against MAX_CV_BYTES - correct
// for the 1-2-big-files shape Finding 272 was built to fix, but it ignored
// the real multipart/form-data overhead rowsToFormData() itself adds: a
// fixed Content-Disposition/boundary line PER FIELD, and this module emits
// 3 fields per row (kind_i/file_i/person_id_i-or-name_i), not just the file
// bytes. That overhead is negligible for one or two files (confirmed: ~1KB
// for 2 files) but grows linearly with FILE COUNT, not with total bytes -
// so a chunk made of many small CVs (a large personnel roster's worth of
// compact, few-KB-each scanned certs/CVs, no contrived malicious input) can
// still have a raw-byte sum safely under MAX_CV_BYTES while its real
// serialized request body exceeds Vercel's 4.5mb cap anyway, hitting the
// exact same "Error: Body exceeded 4.5mb limit." Finding 272 exists to
// prevent. Confirmed live against a real `next dev` server (next.config.ts's
// own real bodySizeLimit): a single chunk of 270 files, each tiny enough
// that all 270 together still sum to under MAX_CV_BYTES, fails with that
// exact 413; 250 files succeeds. MAX_FILES_PER_CHUNK below is a hard,
// independent second cap - chosen with a wide safety margin, not just at
// the measured 250/270 boundary: measured against FOUR real serialized
// FormData bodies, not reasoned about - (a) the real rowsToFormData() field
// shape with minimal field values (UUID person_id/short "existing"/"new"
// kind): 1000 files' worth of overhead alone is ~360KB; (b) the same shape
// with realistic longer names/filenames: 250 files already exceeds the real
// cap (margin going negative between 220 and 250); (c) the same shape with
// deliberately pathological 120-char filenames and 150-char typed names:
// even 150 files leaves a 23.5KB margin, 80 files leaves 60.4KB. 80 is
// comfortably inside every one of those measured margins, including the
// pathological one, while still allowing a chunk to hold as many files as
// the byte-sum cap alone would (most real CVs are well over 4.4MB/80 ≈ 55KB
// each, so the byte cap - not this one - is what usually ends a chunk
// first; this cap only bites for the specific "many small files" shape it
// exists to close).
export const MAX_FILES_PER_CHUNK = 80;

/** Pure: group rows so each group's own total file size stays <= maxBytes
 * AND each group holds at most maxFiles rows, without ever splitting a
 * single row (every individual row is assumed to already be <= maxBytes on
 * its own - the caller's own per-file check). Two independent caps because
 * either one alone can let the real serialized request exceed Vercel's real
 * body-size ceiling - see MAX_FILES_PER_CHUNK's own comment above for why a
 * byte-sum cap alone (Finding 272's original fix) isn't enough. */
export function chunkRowsBySize<T extends ChunkableRow>(rows: T[], maxBytes: number, maxFiles: number = MAX_FILES_PER_CHUNK): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const row of rows) {
    if (current.length > 0 && (currentBytes + row.file.size > maxBytes || current.length >= maxFiles)) {
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
