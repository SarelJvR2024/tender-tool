import { createClient } from "@/lib/supabase/server";
import { loadTenderCompliance, packReadiness, PACK_REQUIRED_TEMPLATES } from "./compliance-data";
import { requestSubmissionPack } from "./actions";
import { PackAutoRefresh } from "./pack-auto-refresh";
import { PackChecklist, checklistOf, type ChecklistRow } from "./pack-checklist";

/**
 * "Generate submission pack" - the whole SANRAL pack (filled workbook, Form B
 * reports, returnable forms, covers, vault documents, CVs) as one ordered,
 * page-numbered PDF. The request is a pack_generation_jobs row (0017);
 * engine/pack/process_pack_jobs.py fulfils it out-of-band, because the web
 * app can't run Python/LibreOffice. Gated on the compliance report's own
 * gaps (compliance-data.ts), never a second readiness rule.
 */

type PackJob = {
  id: string;
  status: "requested" | "generating" | "ready" | "failed";
  requested_at: string;
  completed_at: string | null;
  storage_path_pdf: string | null;
  output_files: Record<string, string> | null;
  page_count: number | null;
  manifest: {
    omitted?: { title: string; envelope: string; reason: string }[];
    warnings?: string[];
    // Every document + its status (engine/pack/pdf_merge.py) - pack-checklist.tsx.
    checklist?: ChecklistRow[];
    sections?: { title: string; envelope: string; start_page: number; end_page: number; warning?: string | null }[];
    // Envelope 2 (Financial) is its own PDF - engine/pack/assemble_pack.py.
    financial?: {
      page_count?: number;
      omitted?: { title: string; envelope: string; reason: string }[];
      checklist?: ChecklistRow[];
      sections?: { title: string; envelope: string; start_page: number; end_page: number; warning?: string | null }[];
    };
  } | null;
  error_message: string | null;
  acknowledged_gaps: boolean;
};

const STATUS: Record<PackJob["status"], { label: string; bg: string; color: string }> = {
  requested: { label: "Requested - waiting for the pack builder", bg: "#FEF3C7", color: "#B45309" },
  generating: { label: "Generating…", bg: "#FEF3C7", color: "#B45309" },
  ready: { label: "Ready", bg: "#DCFCE7", color: "#15803D" },
  failed: { label: "Failed", bg: "#FEE2E2", color: "#B91C1C" },
};

const OUTPUT_LABEL: Record<string, string> = {
  financial_pdf: "Envelope 2 - Financial Submission PDF",
  technical_xlsm: "Technical workbook (.xlsm)",
  financial_xlsm: "Financial workbook (.xlsm)",
  actions_to_sign: "What to sign (ACTIONS_TO_SIGN.md)",
};

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

export async function SubmissionPack({ tenderId, tenderPackId }: { tenderId: string; tenderPackId: string }) {
  const supabase = await createClient();
  const readiness = packReadiness(await loadTenderCompliance(tenderId));

  const [{ data: docRows }, { data: jobRows }] = await Promise.all([
    supabase.from("tender_documents").select("doc_type").eq("tender_id", tenderId),
    supabase
      .from("pack_generation_jobs")
      .select("id, status, requested_at, completed_at, storage_path_pdf, output_files, page_count, manifest, error_message, acknowledged_gaps")
      .eq("tender_id", tenderId)
      .order("requested_at", { ascending: false })
      .limit(5),
  ]);
  const jobs = (jobRows ?? []) as PackJob[];
  const onFile = new Set((docRows ?? []).map((d) => d.doc_type as string));
  const missingTemplates = PACK_REQUIRED_TEMPLATES.filter((t) => !onFile.has(t));
  const active = jobs.some((j) => j.status === "requested" || j.status === "generating");

  const blockers = [
    ...(readiness.unfilledPositions.length > 0
      ? [`No confirmed key person for ${readiness.unfilledPositions.join(", ")}`]
      : []),
    ...(missingTemplates.length > 0
      ? [`Blank SANRAL templates not uploaded (Blank tender templates, above): ${missingTemplates.join(", ")}`]
      : []),
    ...(active ? ["A pack is already queued or generating for this tender"] : []),
  ];
  const gaps = [
    ...readiness.mandatoryMissing.map((g) => ({ text: g, tone: "red" as const, note: "mandatory - disqualifying" })),
    ...readiness.missing.map((g) => ({ text: g, tone: "red" as const, note: "don't have" })),
    ...readiness.toConfirm.map((g) => ({ text: g, tone: "amber" as const, note: "confirm by hand" })),
  ];
  const needsAck = !readiness.checked || gaps.length > 0;

  // Signed links for ready packs (private 'submission-packs' bucket, 10 min).
  const paths = jobs
    .filter((j) => j.status === "ready")
    .flatMap((j) => [j.storage_path_pdf, ...Object.values(j.output_files ?? {})])
    .filter((p): p is string => !!p);
  const signed: Record<string, string> = {};
  if (paths.length > 0) {
    const results = await Promise.all(paths.map((p) => supabase.storage.from("submission-packs").createSignedUrl(p, 600)));
    results.forEach((r, i) => {
      if (r.data?.signedUrl) signed[paths[i]] = r.data.signedUrl;
    });
  }

  return (
    <div id="submission-pack" style={card}>
      <PackAutoRefresh active={active} />
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Submission pack</div>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
        Two PDFs, one per sealed envelope, each in submission order with a contents page and page numbers. The
        submission pack: outer cover, then Envelope 1 (Technical) - authority letter, A-Forms, your vault documents,
        Contract Data, Forms B1-B2 with each key person&apos;s CV, Forms B3-B7. Envelope 2 (Financial), separately: its
        cover, the Form of Offer and the printed Financial workbook - kept out of the technical pack because it is
        opened only after technical evaluation. The filled .xlsm workbooks come with them. Each contents page doubles as
        the pack&apos;s checklist - every document with its status (included, included with a warning such as an
        expired certificate that must be replaced, or not included and why) - and the same checklist is shown here
        under each pack. Signatures, pricing and the B4/B5 write-ups stay with you.
      </div>

      {blockers.length > 0 && (
        <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#B91C1C" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Can&apos;t generate yet</div>
          {blockers.map((b) => (
            <div key={b}>- {b}</div>
          ))}
        </div>
      )}

      {blockers.length === 0 && needsAck && (
        <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#92400E" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {readiness.checked
              ? `The compliance check above shows ${gaps.length} gap${gaps.length === 1 ? "" : "s"}`
              : "This tender's returnable list isn't mapped, so readiness hasn't been checked"}
          </div>
          {gaps.slice(0, 8).map((g) => (
            <div key={g.text} style={{ color: g.tone === "red" ? "#B91C1C" : "#92400E" }}>
              - {g.text} <span style={{ color: "#9A9684" }}>({g.note})</span>
            </div>
          ))}
          {gaps.length > 8 && <div>…and {gaps.length - 8} more (see the compliance check)</div>}
        </div>
      )}

      {blockers.length === 0 && (
        <form action={requestSubmissionPack} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="tender_id" value={tenderId} />
          <input type="hidden" name="tender_pack_id" value={tenderPackId} />
          {needsAck && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#16233B" }}>
              <input type="checkbox" name="acknowledge_gaps" required style={{ width: 18, height: 18 }} />
              Generate a draft anyway - the gaps will be listed in the pack
            </label>
          )}
          <button
            type="submit"
            style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Generate submission pack
          </button>
        </form>
      )}

      {jobs.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
          {jobs.map((j) => {
            const st = STATUS[j.status] ?? { label: j.status, bg: "#F0EEE6", color: "#6B6758" };
            const warnings = j.manifest?.warnings ?? [];
            const techRows = checklistOf(j.manifest);
            const finRows = checklistOf(j.manifest?.financial);
            return (
              <div key={j.id} style={{ borderTop: "1px solid #F0EEE6", padding: "10px 0", fontSize: 12, color: "#4B5563" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                  <span style={{ color: "#9A9684" }}>
                    requested {new Date(j.requested_at).toLocaleString()}
                    {j.acknowledged_gaps ? " · draft, with known gaps" : ""}
                  </span>
                  {j.status === "ready" && j.storage_path_pdf && signed[j.storage_path_pdf] && (
                    <a href={signed[j.storage_path_pdf]} style={{ color: "#D97706", fontWeight: 700 }}>
                      Download PDF{j.page_count ? ` (${j.page_count} pages)` : ""}
                    </a>
                  )}
                </div>
                {j.status === "failed" && j.error_message && (
                  <div style={{ color: "#B91C1C", marginTop: 4, wordBreak: "break-word" }}>{j.error_message}</div>
                )}
                {j.status === "ready" && (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                    {Object.entries(j.output_files ?? {})
                      .filter(([k, p]) => OUTPUT_LABEL[k] && signed[p])
                      .map(([k, p]) => (
                        <a key={k} href={signed[p]} style={{ color: "#D97706", fontWeight: 600 }}>
                          {OUTPUT_LABEL[k]}
                        </a>
                      ))}
                  </div>
                )}
                {j.status === "ready" && (
                  <>
                    <PackChecklist rows={techRows} title="Submission pack (Envelope 1) checklist" />
                    <PackChecklist rows={finRows} title="Envelope 2 (Financial) checklist" />
                  </>
                )}
                {j.status === "ready" && warnings.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#92400E" }}>
                    {warnings.map((w, i) => (
                      <li key={`w${i}`}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
