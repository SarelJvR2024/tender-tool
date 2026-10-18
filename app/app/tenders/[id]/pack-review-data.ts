import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadTenderCompliance, packReadiness, PACK_REQUIRED_TEMPLATES } from "./compliance-data";
import { loadB7State } from "./b7-data";
import { TENDER_TEMPLATES } from "@/lib/tenderTemplates";
import type { ChecklistRow } from "./pack-checklist";
import { b7Status, docItemStatus, fieldStatus, humanizeFieldKey, positionStatus, provenanceStatus, signatureStatus, type ReviewStatus } from "./pack-review-logic";

export type { ReviewStatus } from "./pack-review-logic";

/**
 * Pack Review: ONE unified "what will go into this pack" snapshot, read
 * fresh on every page view (same live-computation pattern as
 * requestSubmissionPack()'s own readiness_snapshot in actions.ts - there is
 * nothing stored for the content itself, only for the human's "I've
 * reviewed this" signal, in pack_review_confirmations, migration 0059).
 *
 * Sarel, 2026-10-18: "For each tender before compiling it, share the full
 * list of info, answers, signatures, documents, CVs, alternative options etc
 * to show what is identified to be used to compile the pack so the company
 * have an easy way to confirm or change it." This module assembles that
 * list (reading from Supabase); the pure classification decisions
 * (what counts as confirmed/missing/warning) live in pack-review-logic.ts so
 * they're testable without a database. pack-review.tsx renders the result.
 *
 * Every section is wrapped in its own try/catch (the per-item error-
 * isolation discipline already used elsewhere this session for batch date
 * parsing etc.) so one bad record can't take down the whole review screen -
 * a section that fails renders as "couldn't load this section" instead.
 */

export type ReviewItem = {
  key: string;
  label: string;
  value: string | null;
  status: ReviewStatus;
  note: string | null;
};

export type ReviewSection = {
  key: string;
  title: string;
  /** Where "Change" jumps to - a same-page "#anchor" or a cross-page path. */
  changeHref: string;
  changeLabel: string;
  items: ReviewItem[];
  /** Set instead of items when this section's own data couldn't be read. */
  error: string | null;
};

export type PackReviewSnapshot = {
  mapped: boolean; // false when this tender's family isn't the mapped SANRAL returnable list (compliance-data.ts)
  family: string | null;
  sections: ReviewSection[];
  /** Pre-generation preview of the SAME shape pack-checklist.tsx renders post-generation. */
  checklist: ChecklistRow[];
  gapsCount: number;
  reviewed: { reviewedAt: string; reviewedBy: string | null } | null;
};

function section(key: string, title: string, changeHref: string, changeLabel: string, items: ReviewItem[]): ReviewSection {
  return { key, title, changeHref, changeLabel, items, error: null };
}

function failedSection(key: string, title: string, changeHref: string, changeLabel: string, err: unknown): ReviewSection {
  const message = err instanceof Error ? err.message : String(err);
  return { key, title, changeHref, changeLabel, items: [], error: `Couldn't load this section: ${message}` };
}

export const loadPackReviewSnapshot = cache(async (tenderId: string): Promise<PackReviewSnapshot> => {
  const supabase = await createClient();
  const data = await loadTenderCompliance(tenderId);
  const family = data?.family ?? null;

  if (!data || !data.mapped) {
    return { mapped: false, family, sections: [], checklist: [], gapsCount: 0, reviewed: null };
  }

  const readiness = packReadiness(data);
  const sections: ReviewSection[] = [];
  const checklist: ChecklistRow[] = [];
  let checklistNo = 0;
  const pushChecklist = (row: Omit<ChecklistRow, "no">) => checklist.push({ no: ++checklistNo, ...row });

  // --- Reviewed-so-far: who, when (pack_review_confirmations, 0059) --------
  let reviewed: PackReviewSnapshot["reviewed"] = null;
  try {
    const { data: confirmation } = await supabase
      .from("pack_review_confirmations")
      .select("reviewed_at, reviewed_by, people:reviewed_by(name)")
      .eq("tender_id", tenderId)
      .maybeSingle();
    if (confirmation?.reviewed_at) {
      reviewed = {
        reviewedAt: confirmation.reviewed_at as string,
        reviewedBy: ((confirmation as unknown as { people?: { name: string } | null }).people?.name as string | undefined) ?? null,
      };
    }
  } catch {
    // No confirmation to show is not fatal - the card just shows "not reviewed yet".
    reviewed = null;
  }

  // --- 1. Company master data (companies table) + 7. Alternative bid options -
  try {
    const { data: company } = await supabase
      .from("companies")
      .select(
        "legal_name, bee_level, black_ownership_pct, status, head_office, other_offices, ecsa_registered_staff_count, sacpcmp_registered_staff_count, total_employees, typical_jv_share_pct",
      )
      .maybeSingle();
    const c = (company ?? {}) as Record<string, unknown>;
    const field = (key: string, label: string, required = true): ReviewItem => {
      const val = c[key];
      const { status, note } = fieldStatus(val, required);
      return { key, label, value: val === null || val === undefined || val === "" ? null : String(val), status, note };
    };
    sections.push(
      section("company", "Company master data", "/company", "Open company profile", [
        field("legal_name", "Legal name"),
        field("bee_level", "B-BBEE level"),
        field("black_ownership_pct", "Black ownership %", false),
        field("status", "Company status (e.g. QSE)"),
        field("head_office", "Head office (Form B3)"),
        field("other_offices", "Other offices", false),
        field("ecsa_registered_staff_count", "ECSA-registered staff", false),
        field("sacpcmp_registered_staff_count", "SACPCMP-registered staff", false),
        field("total_employees", "Total employees", false),
      ]),
    );
    // Display-only, no JV math performed here or anywhere in this screen (explicit build constraint).
    const jv = c.typical_jv_share_pct;
    const jvEmpty = jv === null || jv === undefined;
    sections.push(
      section("alternative_options", "Alternative bid options", "/company", "Open company profile", [
        {
          key: "typical_jv_share_pct",
          label: "Typical JV share %",
          value: jvEmpty ? null : String(jv),
          status: jvEmpty ? "needs_input" : "confirmed",
          note: jvEmpty
            ? "Not set - this tender will be treated as a sole bid. No JV calculation is performed here."
            : "Shown as on file. No JV calculation is performed - this is the company's own typical-share field, unchanged.",
        },
      ]),
    );
  } catch (err) {
    sections.push(failedSection("company", "Company master data", "/company", "Open company profile", err));
    sections.push(failedSection("alternative_options", "Alternative bid options", "/company", "Open company profile", err));
  }

  // --- 2. Key positions / people / CVs --------------------------------------
  try {
    const items: ReviewItem[] = data.positionRows.map((p) => {
      const confirmedName = p.person?.name ?? null;
      const suggestedName = p.suggested?.name ?? null;
      const hasCv = !!(p.tenderCv?.status === "ready" || p.cv);
      const fitWarning = p.fit.status !== "have" ? p.fit.detail : null;
      const { reviewStatus, checklistStatus, note } = positionStatus({ hasConfirmedPerson: !!confirmedName, hasCv, fitWarning });

      pushChecklist({
        title: confirmedName ? `Form B1/B2 - ${p.code} (${confirmedName})` : `Form B1/B2 - ${p.code}`,
        envelope: "Technical",
        status: checklistStatus,
        pages: null,
        note,
      });

      if (!confirmedName) {
        return {
          key: `position-${p.code}`,
          label: `${p.code}${p.req?.position_description ? ` - ${p.req.position_description}` : ""}`,
          value: suggestedName ? `Suggested: ${suggestedName} (not yet confirmed)` : null,
          status: reviewStatus,
          note: "Confirm a key person for this position before the pack can be generated.",
        };
      }
      const cvStatus = p.tenderCv?.status ?? (p.cv ? "ready" : null);
      const cvNote =
        cvStatus === "ready"
          ? "Tender-specific CV ready."
          : cvStatus === "requested" || cvStatus === "generating"
            ? "Tender-specific CV is being generated."
            : cvStatus === "failed"
              ? "Tender-specific CV generation failed - request it again."
              : p.cv
                ? `Using the as-filed CV upload (${p.cv.original_filename}).`
                : "No CV on file for this person yet.";
      return {
        key: `position-${p.code}`,
        label: `${p.code}${p.req?.position_description ? ` - ${p.req.position_description}` : ""}`,
        value: confirmedName,
        status: reviewStatus,
        note: fitWarning ?? cvNote,
      };
    });
    sections.push(section("key_positions", "Key positions, people & CVs", "#key-positions", "Confirm or change", items));
  } catch (err) {
    sections.push(failedSection("key_positions", "Key positions, people & CVs", "#key-positions", "Confirm or change", err));
  }

  // --- 3. Form answers (field_provenance) -----------------------------------
  try {
    const { data: pack } = await supabase.from("tender_packs").select("id").eq("tender_id", tenderId).maybeSingle();
    const packId = (pack?.id as string | undefined) ?? null;
    let items: ReviewItem[] = [];
    if (packId) {
      const { data: provRows } = await supabase
        .from("field_provenance")
        .select("field_key, status, value, reason")
        .eq("tender_pack_id", packId)
        .order("field_key", { ascending: true });
      const rows = (provRows ?? []) as { field_key: string; status: string; value: string | null; reason: string | null }[];
      items = rows.map((r) => ({
        key: r.field_key,
        label: humanizeFieldKey(r.field_key),
        value: r.value,
        status: provenanceStatus(r.status),
        note: r.reason,
      }));
    }
    sections.push(section("form_answers", "Form answers", "#readiness-report", "Confirm or change", items));
  } catch (err) {
    sections.push(failedSection("form_answers", "Form answers", "#readiness-report", "Confirm or change", err));
  }

  // --- 4. Signature ----------------------------------------------------------
  try {
    const [{ data: signerAnswer }, { data: signers }] = await Promise.all([
      supabase.from("tender_answers").select("value").eq("tender_id", tenderId).eq("field_key", "signatory_person_id").maybeSingle(),
      supabase.from("people").select("id, name, signatory_capacity").not("signatory_capacity", "is", null).order("created_at"),
    ]);
    const signerList = (signers ?? []) as { id: string; name: string; signatory_capacity: string }[];
    const chosenId = (signerAnswer?.value as string | null | undefined) ?? null;
    const fallback = signerList[0] ?? null;
    const { reviewStatus, checklistStatus, value, note } = signatureStatus({ chosenId, fallback });
    pushChecklist({ title: "Signature", envelope: "Technical", status: checklistStatus, pages: null, note });
    sections.push(section("signature", "Signature", "#submission-pack", "Choose signatory", [{ key: "signatory", label: "Who signs this bid", value, status: reviewStatus, note }]));
  } catch (err) {
    sections.push(failedSection("signature", "Signature", "#submission-pack", "Choose signatory", err));
  }

  // --- 5. Supporting / vault documents ---------------------------------------
  try {
    const { data: docRows } = await supabase.from("tender_documents").select("doc_type").eq("tender_id", tenderId);
    const onFile = new Set((docRows ?? []).map((d) => d.doc_type as string));
    const items: ReviewItem[] = PACK_REQUIRED_TEMPLATES.map((t) => {
      const have = onFile.has(t);
      const label = TENDER_TEMPLATES[t]?.label ?? t;
      pushChecklist({
        title: label,
        envelope: "Technical",
        status: have ? "included" : "not_included",
        pages: null,
        note: have ? null : "Blank SANRAL template not uploaded yet.",
      });
      return {
        key: `template-${t}`,
        label,
        value: have ? "Uploaded" : null,
        status: have ? ("confirmed" as ReviewStatus) : ("missing" as ReviewStatus),
        note: have ? null : "Upload this tender's blank SANRAL template before generating the pack.",
      };
    });
    // The rest of the document checklist (vault docs: COID, PI insurance,
    // ISO 9001, SARS TCS, BEE proof, bank letter, ...) - the compliance
    // report's own docItems is already the SAME per-document have/missing/
    // check list the pack bridge checks against, so it's reused here rather
    // than re-derived.
    for (const d of data.docItems) {
      const { reviewStatus, checklistStatus } = docItemStatus(d.status);
      pushChecklist({ title: `${d.form} - ${d.label}`, envelope: "Technical", status: checklistStatus, pages: null, note: d.status === "have" ? null : d.detail });
      items.push({ key: `doc-${d.key}`, label: `${d.form} - ${d.label}`, value: d.status === "have" ? "On file" : null, status: reviewStatus, note: d.detail });
    }
    sections.push(section("documents", "Supporting & vault documents", "#tender-templates", "Upload or change", items));
  } catch (err) {
    sections.push(failedSection("documents", "Supporting & vault documents", "#tender-templates", "Upload or change", err));
  }

  // --- 6. Form B7 subcontracting plan ----------------------------------------
  try {
    const b7 = await loadB7State(tenderId);
    const { reviewStatus, checklistStatus, value, note } = b7Status({
      appliesStatus: b7.applies.status,
      blocker: b7.blocker,
      warnings: b7.warnings,
      planMode: b7.plan?.mode ?? null,
    });
    pushChecklist({ title: "Form B7 - Targeted Enterprise subcontracting", envelope: "Technical", status: checklistStatus, pages: null, note });
    sections.push(
      section("form_b7", "Form B7 - subcontracting plan", "#form-b7", "Confirm or change", [
        { key: "form_b7", label: "Targeted-Enterprise subcontracting", value, status: reviewStatus, note },
      ]),
    );
  } catch (err) {
    sections.push(failedSection("form_b7", "Form B7 - subcontracting plan", "#form-b7", "Confirm or change", err));
  }

  const gapsCount =
    readiness.mandatoryMissing.length +
    readiness.missing.length +
    readiness.toConfirm.length +
    sections.reduce((n, s) => n + s.items.filter((i) => i.status === "missing" || i.status === "warning").length, 0);

  return { mapped: true, family, sections, checklist, gapsCount, reviewed };
});
