import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * "Tailored CV side-by-side with original" (prompt 10, item 3). Shows the
 * person's own uploaded CV (cv_uploads, 0008 - the file their People page
 * holds, "the original") next to the tender-specific generated one
 * (generated_cvs, same migration - "the tailored" one, built fresh from
 * engine/cv/generate_cv.py onto the SANRAL key-person template), each with a
 * real download link.
 *
 * NOT built: line-level highlighted differences, or "Use tailored"/"Use
 * original" buttons that change which one goes into the pack. Checked both
 * before building this - see app/AGENTS.md ("CV tailoring: side-by-side,
 * honestly") for why neither exists to build honestly from today's data:
 * the two documents aren't the same file with edits (one is a freeform
 * upload, the other a wholesale re-render onto a different template, so
 * there are no "lines" to diff), and the pack engine already auto-picks
 * (newest ready generated CV, else newest as-is upload) with no per-position
 * override input anywhere to write a button's choice into.
 */
export async function CvCompare({ tenderId, positionCode, personId }: { tenderId: string; positionCode: string; personId: string }) {
  const supabase = await createClient();

  const [{ data: uploadRows }, { data: genRows }] = await Promise.all([
    supabase.from("cv_uploads").select("id, storage_path, original_filename, created_at").eq("person_id", personId).order("created_at", { ascending: false }).limit(1),
    supabase
      .from("generated_cvs")
      .select("id, storage_path_docx, storage_path_pdf, format, detail, requested_at")
      .eq("tender_id", tenderId)
      .eq("position_code", positionCode)
      .eq("person_id", personId)
      .eq("status", "ready")
      .order("requested_at", { ascending: false })
      .limit(1),
  ]);

  const original = uploadRows?.[0] ?? null;
  const tailored = genRows?.[0] ?? null;
  if (!original && !tailored) return null;

  const paths = [original?.storage_path, tailored?.storage_path_pdf, tailored?.storage_path_docx].filter((p): p is string => !!p);
  const signed: Record<string, string> = {};
  if (paths.length > 0) {
    const results = await Promise.all(paths.map((p) => supabase.storage.from("cv-documents").createSignedUrl(p, 600)));
    results.forEach((r, i) => {
      if (r.data?.signedUrl) signed[paths[i]] = r.data.signedUrl;
    });
  }

  const actionLinkClass = "text-xs font-semibold text-foreground underline underline-offset-2 hover:text-accent";

  return (
    <div className="mt-2 grid grid-cols-2 gap-2.5">
      <div className="min-w-0 rounded-lg border border-border px-2.5 py-2">
        <div className="mb-0.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Original (as uploaded)</div>
        {original ? (
          <>
            <div className="text-xs break-words text-foreground">{original.original_filename}</div>
            {signed[original.storage_path] && (
              <a href={signed[original.storage_path]} className={actionLinkClass}>
                Download
              </a>
            )}
          </>
        ) : (
          <div className="text-xs text-muted-foreground">No CV uploaded yet.</div>
        )}
        <div className="mt-1">
          <Link href={`/people/${personId}#cv-documents`} className="text-[11px] text-muted-foreground underline underline-offset-2">
            Edit on People page
          </Link>
        </div>
      </div>
      <div className="min-w-0 rounded-lg border border-border px-2.5 py-2">
        <div className="mb-0.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Tailored (this tender)</div>
        {tailored ? (
          <div className="flex flex-wrap gap-2.5">
            {tailored.storage_path_pdf && signed[tailored.storage_path_pdf] && (
              <a href={signed[tailored.storage_path_pdf]} className={actionLinkClass}>
                PDF
              </a>
            )}
            {tailored.storage_path_docx && signed[tailored.storage_path_docx] && (
              <a href={signed[tailored.storage_path_docx]} className={actionLinkClass}>
                Word
              </a>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Not generated yet - use &quot;Generate tender-specific CV&quot; above.</div>
        )}
      </div>
    </div>
  );
}
