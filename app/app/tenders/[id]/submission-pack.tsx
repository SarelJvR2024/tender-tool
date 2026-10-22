import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadTenderCompliance, packReadiness, complianceItemLabel, PACK_REQUIRED_TEMPLATES } from "./compliance-data";
import { loadB7State } from "./b7-data";
import { requestSubmissionPack } from "./actions";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { PackChecklist, checklistOf, type ChecklistRow } from "./pack-checklist";
import { pickDefaultSignatory, NO_TENDER_SCOPE, type Signatory, type SignatoryScope } from "./signatory-logic";
import { loadPackReviewSnapshot } from "./pack-review-data";
import { classifyComplianceItem } from "./bid-task-status";
import { computeTenderReadiness } from "./tender-readiness";
import { SanralProgress } from "./sanral-progress";
import { DownloadAllButton } from "./download-all-button";

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
  started_at: string | null;
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

const STATUS: Record<PackJob["status"], { label: string; className: string }> = {
  requested: { label: "Requested - waiting for the pack builder", className: "bg-warning/10 text-warning" },
  generating: { label: "Generating…", className: "bg-warning/10 text-warning" },
  ready: { label: "Ready", className: "bg-success/10 text-success" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
};

const OUTPUT_LABEL: Record<string, string> = {
  financial_pdf: "Envelope 2 - Financial Submission PDF",
  technical_xlsm: "Technical workbook (.xlsm)",
  financial_xlsm: "Financial workbook (.xlsm)",
  actions_to_sign: "What to sign (summary)",
};

// "SANRAL schedules" premium feature (item 2 of 10): the marketing claim
// itself ("usually 6 to 8 hours by hand") is Sarel's own fixed copy, not a
// per-tender measurement - nothing in this app tracks how long a human would
// have taken by hand. What IS real and already stored (requested_at/
// started_at/completed_at, 0017) is how long the engine itself took on this
// run, shown alongside it so the claim has a real number next to it rather
// than standing alone.
function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h${rem ? ` ${rem}m` : ""}`;
}

export async function SubmissionPack({ tenderId, tenderPackId }: { tenderId: string; tenderPackId: string }) {
  const supabase = await createClient();
  const complianceData = await loadTenderCompliance(tenderId);
  const readiness = packReadiness(complianceData);
  const b7 = await loadB7State(tenderId);

  const [{ data: docRows }, { data: jobRows }, { data: signerRows }, { data: signerAnswer }, { data: reviewRow }, { data: scopeRows }, { data: tenderRow }] = await Promise.all([
    supabase.from("tender_documents").select("doc_type").eq("tender_id", tenderId),
    supabase
      .from("pack_generation_jobs")
      .select("id, status, requested_at, started_at, completed_at, storage_path_pdf, output_files, page_count, manifest, error_message, acknowledged_gaps")
      .eq("tender_id", tenderId)
      .order("requested_at", { ascending: false })
      .limit(5),
    // Everyone who can sign (People page signatory capacity), oldest first -
    // the pack's default when no one is chosen for this tender.
    supabase.from("people").select("id, name, signatory_capacity").not("signatory_capacity", "is", null).order("created_at"),
    supabase.from("tender_answers").select("value").eq("tender_id", tenderId).eq("field_key", "signatory_person_id").maybeSingle(),
    // Pack review (0059): has a human looked at the full pre-compile list (pack-review.tsx) yet?
    supabase.from("pack_review_confirmations").select("reviewed_at").eq("tender_id", tenderId).maybeSingle(),
    // signatory_scopes (0061): optional region/industry/discipline tags per
    // signatory - advisory only, used to suggest a default below.
    supabase.from("signatory_scopes").select("person_id, region, industry_tag, discipline_tag"),
    supabase.from("tenders").select("region, industry_tags, discipline_tags").eq("id", tenderId).maybeSingle(),
  ]);
  const signers = (signerRows ?? []) as Signatory[];
  const scopes = (scopeRows ?? []) as SignatoryScope[];
  const tenderScope = tenderRow
    ? { region: (tenderRow.region as string | null) ?? null, industryTags: (tenderRow.industry_tags as string[] | null) ?? [], disciplineTags: (tenderRow.discipline_tags as string[] | null) ?? [] }
    : NO_TENDER_SCOPE;
  const suggested = pickDefaultSignatory({ signers, scopes, tender: tenderScope });
  const chosenSigner = (signerAnswer?.value as string | null | undefined) ?? "";
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
    // Form B7 (0056): applies, or can't be ruled out, and the company hasn't answered.
    ...(b7.blocker ? [b7.blocker] : []),
    ...(active ? ["A pack is already queued or generating for this tender"] : []),
  ];
  // Verify/Provide/Fix (app/AGENTS.md), not the old pre-unification
  // "mandatory - disqualifying"/"don't have"/"confirm by hand" wording - and
  // run through the exact same classifyComplianceItem() the Compliance Check
  // card above uses, rather than compliance-data.ts's own mandatory-blind
  // mandatoryMissing/missing/toConfirm split (which bucketed a mandatory-but-
  // merely-unconfirmed item as "toConfirm"/amber here while the card one
  // screen up correctly shows it as Fix - the exact same bug this session's
  // "pack-review's own mandatory-blind bug" piece already fixed for
  // pack-review-data.ts/general-pack-review-data.ts). A doc item the
  // classifier buckets as Verify (confirmed, or an optional item still
  // needing a look) isn't a gap, so it's left out here, same as
  // pack-review-data.ts's own gapsCount.
  const gaps = [
    ...(complianceData?.mapped
      ? complianceData.docItems
          .map((d) => ({ item: d, task: classifyComplianceItem(d) }))
          .filter(({ task }) => task.status === "fix" || task.status === "provide")
          .map(({ item, task }) => ({
            text: complianceItemLabel(item),
            tone: task.status === "fix" ? ("red" as const) : ("amber" as const),
            note: task.status === "fix" ? "Fix" : "Provide",
          }))
      : []),
    ...b7.warnings.map((g) => ({ text: `Form B7: ${g}`, tone: "amber" as const, note: "Provide" })),
  ];
  const needsAck = !readiness.checked || gaps.length > 0;
  const reviewed = !!reviewRow?.reviewed_at;

  // Verify/Provide/Fix (app/AGENTS.md): the Submit button itself stays
  // disabled while any Fix item is open, on top of the existing "pack
  // review confirmed" gate above - reuses the exact same cached snapshot
  // the workspace header's readiness score reads, so this can't disagree
  // with what the header already shows.
  const packReviewSnapshot = await loadPackReviewSnapshot(tenderId);
  const fixCount = packReviewSnapshot.mapped ? computeTenderReadiness(packReviewSnapshot.sections).fix.length : 0;
  const disabledReason = fixCount > 0
    ? `Fix ${fixCount} item${fixCount === 1 ? "" : "s"} first - see the Fix list above`
    : !reviewed
      ? "Confirm the Pack review above first"
      : null;

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
    <div id="submission-pack" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <AutoRefresh active={active} />
      <div className="mb-2.5 flex items-center gap-2.5 rounded-lg border border-warning/30 bg-gradient-to-r from-warning/10 to-card px-3.5 py-2.5">
        <span className="text-lg" aria-hidden>⚡</span>
        <div className="text-[13px] leading-snug font-semibold text-warning">
          SANRAL schedules - usually 6 to 8 hours by hand. We fill them in minutes.
        </div>
      </div>
      <div className="mb-0.5 text-[15px] font-bold text-foreground">Submission pack</div>
      <div className="mb-3 text-xs text-muted-foreground">
        Two PDFs, one per sealed envelope, each in submission order with a contents page and page numbers. The
        submission pack: outer cover, then Envelope 1 (Technical) - authority letter, A-Forms, your vault documents,
        Contract Data, Forms B1-B2 with each key person&apos;s CV, Forms B3-B5, and Form B7 from your own
        subcontracting answer when it applies (otherwise listed as not included, with why). Envelope 2 (Financial), separately: its
        cover, the Form of Offer and the printed Financial workbook - kept out of the technical pack because it is
        opened only after technical evaluation. The filled .xlsm workbooks come with them. Each contents page doubles as
        the pack&apos;s checklist - every document with its status (included, included with a warning such as an
        expired certificate that must be replaced, or not included and why) - and the same checklist is shown here
        under each pack. Signatures, pricing and the B4/B5 write-ups stay with you.
      </div>

      {blockers.length > 0 && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          <div className="mb-1 font-bold">Can&apos;t generate yet</div>
          {blockers.map((b) => (
            <div key={b}>- {b}</div>
          ))}
        </div>
      )}

      {blockers.length === 0 && needsAck && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-warning">
          <div className="mb-1 font-bold">
            {readiness.checked
              ? `The compliance check above shows ${gaps.length} gap${gaps.length === 1 ? "" : "s"}`
              : "This tender's returnable list isn't mapped, so readiness hasn't been checked"}
          </div>
          {gaps.slice(0, 8).map((g) => (
            <div key={g.text} className={g.tone === "red" ? "text-destructive" : "text-warning"}>
              - {g.text} <span className="text-muted-foreground">({g.note})</span>
            </div>
          ))}
          {gaps.length > 8 && <div>…and {gaps.length - 8} more (see the compliance check)</div>}
        </div>
      )}

      {blockers.length === 0 && !reviewed && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-warning">
          <div className="mb-0.5 font-bold">Review the pack first</div>
          See the full <a href="#pack-review" className="font-bold text-warning">Pack review</a> above - company data,
          key positions and CVs, form answers, signature, documents, Form B7 - and click &quot;I&apos;ve reviewed this&quot;
          there before generating.
        </div>
      )}

      {blockers.length === 0 && (
        <form action={requestSubmissionPack} className="flex flex-wrap items-center gap-2.5">
          <input type="hidden" name="tender_id" value={tenderId} />
          <input type="hidden" name="tender_pack_id" value={tenderPackId} />
          {signers.length === 0 && (
            <div className="text-xs text-warning">
              No one on your <Link href="/people" className="font-bold text-warning">People page</Link> has a signatory
              capacity set yet - add one before generating, so the pack has someone to name as signing it.
            </div>
          )}
          {signers.length === 1 && (
            <div className="text-xs text-foreground">
              Signs this bid: <strong>{signers[0].name} - {signers[0].signatory_capacity}</strong>
            </div>
          )}
          {signers.length > 1 && (
            <label id="signatory-select" className="flex flex-wrap items-center gap-1.5 text-xs text-foreground">
              Who signs this bid
              <select name="signatory_person_id" defaultValue={signers.some((p) => p.id === chosenSigner) ? chosenSigner : ""}
                className="min-h-9 max-w-full rounded-md border border-border px-2 text-xs">
                <option value="">
                  Not chosen - {suggested?.name ?? signers[0].name} (suggested for this tender; the pack will say so)
                </option>
                {signers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} - {p.signatory_capacity}{p.id === suggested?.id ? " (suggested)" : ""}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="submit"
            disabled={!!disabledReason}
            title={disabledReason ?? undefined}
            className={`min-h-10 rounded-lg border-none px-4 text-[13px] font-semibold whitespace-nowrap text-white ${
              disabledReason ? "cursor-not-allowed bg-muted-foreground" : "cursor-pointer bg-foreground"
            }`}
          >
            Fill SANRAL schedules
          </button>
          {/* title= (hover) doesn't reach touch devices - the same reason as
              visible text so a phone user isn't left guessing why it's grey. */}
          {disabledReason && (
            <div className="w-full text-[11px] text-warning">{disabledReason}</div>
          )}
        </form>
      )}

      <SanralProgress active={active} />

      {jobs.length > 0 && (
        <div className="mt-3.5 flex flex-col">
          {jobs.map((j) => {
            const st = STATUS[j.status] ?? { label: j.status, className: "bg-muted text-muted-foreground" };
            const warnings = j.manifest?.warnings ?? [];
            const techRows = checklistOf(j.manifest);
            const finRows = checklistOf(j.manifest?.financial);
            return (
              <div key={j.id} className="border-t border-border py-2.5 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.className}`}>
                    {st.label}
                  </span>
                  <span className="text-muted-foreground">
                    requested {new Date(j.requested_at).toLocaleString()}
                    {j.acknowledged_gaps ? " · draft, with known gaps" : ""}
                  </span>
                  {j.status === "ready" && j.storage_path_pdf && signed[j.storage_path_pdf] && (
                    <a href={signed[j.storage_path_pdf]} className="font-bold text-accent">
                      Download PDF{j.page_count ? ` (${j.page_count} pages)` : ""}
                    </a>
                  )}
                  {j.status === "ready" && (
                    <DownloadAllButton
                      urls={[j.storage_path_pdf, ...Object.values(j.output_files ?? {})]
                        .filter((p): p is string => !!p)
                        .map((p) => signed[p])
                        .filter((u): u is string => !!u)}
                    />
                  )}
                </div>
                {j.status === "failed" && j.error_message && (
                  <div className="mt-1 break-words text-destructive">{j.error_message}</div>
                )}
                {j.status === "ready" && j.started_at && j.completed_at && (
                  <div className="mt-1 font-semibold text-success">
                    Time saved: usually 6-8 hours by hand - this run took{" "}
                    {formatDuration(new Date(j.completed_at).getTime() - new Date(j.started_at).getTime())}.
                  </div>
                )}
                {j.status === "ready" && (
                  <div className="mt-1 flex flex-wrap gap-3">
                    {Object.entries(j.output_files ?? {})
                      .filter(([k, p]) => OUTPUT_LABEL[k] && signed[p])
                      .map(([k, p]) => (
                        <a key={k} href={signed[p]} className="font-semibold text-accent">
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
                  <ul className="mt-1.5 pl-[18px] text-warning">
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
