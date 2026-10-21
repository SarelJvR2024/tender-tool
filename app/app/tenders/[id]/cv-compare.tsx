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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
      <div style={{ border: "1px solid #E3E6EA", borderRadius: 9, padding: "8px 10px", minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#5B6472", letterSpacing: 0.3, marginBottom: 2 }}>ORIGINAL (as uploaded)</div>
        {original ? (
          <>
            <div style={{ fontSize: 12, color: "#16233B", wordBreak: "break-word" }}>{original.original_filename}</div>
            {signed[original.storage_path] && (
              <a href={signed[original.storage_path]} style={{ fontSize: 12, color: "#D97706", fontWeight: 600 }}>Download</a>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: "#8A93A0" }}>No CV uploaded yet.</div>
        )}
        <div style={{ marginTop: 4 }}>
          <Link href={`/people/${personId}#cv-documents`} style={{ fontSize: 11, color: "#5B6472", textDecoration: "underline" }}>
            Edit on People page
          </Link>
        </div>
      </div>
      <div style={{ border: "1px solid #E3E6EA", borderRadius: 9, padding: "8px 10px", minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#5B6472", letterSpacing: 0.3, marginBottom: 2 }}>TAILORED (this tender)</div>
        {tailored ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {tailored.storage_path_pdf && signed[tailored.storage_path_pdf] && (
              <a href={signed[tailored.storage_path_pdf]} style={{ fontSize: 12, color: "#D97706", fontWeight: 600 }}>PDF</a>
            )}
            {tailored.storage_path_docx && signed[tailored.storage_path_docx] && (
              <a href={signed[tailored.storage_path_docx]} style={{ fontSize: 12, color: "#D97706", fontWeight: 600 }}>Word</a>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#8A93A0" }}>Not generated yet - use &quot;Generate tender-specific CV&quot; above.</div>
        )}
      </div>
    </div>
  );
}
