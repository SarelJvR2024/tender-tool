// Per-tender compliance check: which documents the tender requires that the
// company HAS on file, DOESN'T have, or that Tender Ready CAN'T TELL (not
// tracked in the vault yet) - plus key-person minimum requirements.
//
// Requirement list source, read in full rather than assumed: SANRAL
// R.396-010-2025/1F Book 1, "PART T2.1 LIST OF RETURNABLE DOCUMENTS" (T-31/
// T-32) and Tender Data C.3.11 "Stage 2 Mandatory Administration Criteria"
// (T-11); key-person minimums from Book 2/3, C3.1.11(d) "Minimum
// requirements" (C3-14). Same template family ("Conventional Consultant
// Tender") as all six SANRAL tenders seeded in app/supabase/seed_tenders.sql.
// Non-SANRAL tenders (family "General (non-SANRAL)") don't come through here:
// each buyer's returnable list differs (docs/specs/General-Tender-Engine-
// Findings.md), so theirs is read from the tender's own documents by
// engine/general/requirements.py and checked by app/lib/generalTender.ts /
// app/app/tenders/[id]/general-workspace.tsx. This module covers the SANRAL
// Conventional family only.
//
// The vault is the `companies` row (0001, extended by 0014): "has the
// document" means "the identifying number/date is on file and valid on the
// closing date". 0014 added real fields for the SARS TCS PIN, PI insurance,
// ISO 9001, the bank-letter date and the B-BBEE proof type/expiry (Sarel's
// answer 10, 2026-10-16), so those are now real have/missing checks rather
// than "Confirm by hand". An uploaded copy (the *_path columns) is reported
// in the detail text but doesn't change the status - same as COID, whose
// status has always come from the number + expiry on file.

import { closingDayOf, daysUntil } from "./dates";
import { SACQSP_POSITION_RE, SAGC_POSITION_RE, catalogSlug, type CatalogBody, type HeldCatalogRegistration, type PersonCredentialFields } from "./personCredentials";

export type ComplianceStatus = "have" | "missing" | "check";

export type ComplianceItem = {
  key: string;
  form: string;
  label: string;
  status: ComplianceStatus;
  mandatory: boolean; // Stage 2 "Mandatory Administration Criteria" - failing it disqualifies
  detail: string;
  // Valid on the closing date, but renewal falls within RENEW_SOON_DAYS of
  // today - shown as an amber "Renew soon" chip next to an "On file" row.
  expiring?: boolean;
  // Not valid at closing (expired / lapses first) BUT a copy is uploaded to
  // the vault: the submission pack still INCLUDES that copy, flagged with a
  // warning on its checklist (engine/pack/pdf_merge.py expiry_warning) -
  // Sarel, 2026-10-17: "Dont include. Add as a warning." Shown as a chip so
  // the report and the pack say the same thing.
  expiredCopy?: boolean;
};

export type CompanyVault = {
  legal_name: string | null;
  csd_supplier_number: string | null;
  income_tax_number: string | null;
  coid_letter_of_good_standing_number: string | null;
  coid_letter_of_good_standing_expiry: string | null;
  bee_level: number | null;
  status: string | null; // e.g. "QSE"
  bank_name: string | null;
  director_name: string | null;
  // 0014_vault_compliance_documents.sql
  coid_letter_document_path: string | null;
  sars_tcs_pin: string | null;
  sars_tcs_pin_expiry: string | null;
  sars_tcs_pin_document_path: string | null;
  pi_insurance_insurer: string | null;
  pi_insurance_policy_number: string | null;
  pi_insurance_expiry: string | null;
  pi_insurance_document_path: string | null;
  iso_9001_certified: boolean | null;
  iso_9001_certificate_number: string | null;
  iso_9001_expiry: string | null;
  iso_9001_document_path: string | null;
  bank_confirmation_letter_date: string | null;
  bank_confirmation_letter_valid_until: string | null; // generated: letter date + 3 months
  bank_confirmation_letter_path: string | null;
  bee_proof_type: "certificate" | "qse_affidavit" | "eme_affidavit" | null;
  bee_proof_expiry: string | null;
  bee_proof_document_path: string | null;
};

/** Column list for a supabase select() of CompanyVault. */
export const COMPANY_VAULT_COLUMNS =
  "id, legal_name, csd_supplier_number, income_tax_number, coid_letter_of_good_standing_number, coid_letter_of_good_standing_expiry, bee_level, status, bank_name, director_name, coid_letter_document_path, sars_tcs_pin, sars_tcs_pin_expiry, sars_tcs_pin_document_path, pi_insurance_insurer, pi_insurance_policy_number, pi_insurance_expiry, pi_insurance_document_path, iso_9001_certified, iso_9001_certificate_number, iso_9001_expiry, iso_9001_document_path, bank_confirmation_letter_date, bank_confirmation_letter_valid_until, bank_confirmation_letter_path, bee_proof_type, bee_proof_expiry, bee_proof_document_path";

const RENEW_SOON_DAYS = 60; // same threshold as app/lib/dates.ts expiryStatus()

const fmt = (d: string) => new Date(d).toLocaleDateString();

/**
 * Validity of a dated document on this tender's closing date. "missing" when
 * it lapses before closing (or has already lapsed, when there's no closing
 * date); "have" otherwise, with `expiring` set when it needs renewing soon.
 */
export function validityAtClosing(
  expiry: string,
  closingDate: string | null,
  renewSoonDays = RENEW_SOON_DAYS,
): { status: "have" | "missing"; expiring: boolean; text: string } {
  const expLeft = daysUntil(expiry) as number;
  const closingLeft = daysUntil(closingDayOf(closingDate)); // calendar day: valid ON the closing day counts
  if (expLeft < 0) return { status: "missing", expiring: false, text: `expired ${fmt(expiry)}` };
  if (closingLeft !== null && expLeft < closingLeft) {
    return { status: "missing", expiring: false, text: `expires ${fmt(expiry)}, before this tender closes - renew it first` };
  }
  const expiring = expLeft <= renewSoonDays;
  return {
    status: "have",
    expiring,
    text: `valid until ${fmt(expiry)}${closingLeft !== null ? " - covers the closing date" : ""}${expiring ? " (renew soon)" : ""}`,
  };
}

const copyNote = (path: string | null) => (path ? " Copy uploaded to the vault." : " No copy uploaded to the vault yet.");
const EXPIRED_COPY_NOTE = " The expired copy on file still goes into the submission pack, marked with a warning - replace it before you submit.";
/** An expired/lapsing document with an uploaded copy: the pack includes it with a warning. */
const expiredCopy = (status: ComplianceStatus, path: string | null | undefined) => status === "missing" && !!path;

export const BEE_PROOF_LABEL: Record<string, string> = {
  certificate: "B-BBEE verification certificate",
  qse_affidavit: "QSE sworn affidavit",
  eme_affidavit: "EME sworn affidavit",
};

/**
 * Is there valid B-BBEE proof for this level on the closing date? A QSE (or
 * EME) sworn affidavit is the standard DTIC template and counts as equivalent
 * evidence to a verification certificate - Sarel, 2026-10-16: "Yes it is a
 * standard acceptable template." So proof type never makes this fail; only a
 * missing level, an unrecorded proof type, or an expiry before closing does.
 * OPEN (regulatory review 2026-10-17, Tender-Regulatory-Compliance-Review.md
 * §5): SANRAL's own A12 text accepts an affidavit only from an EME under
 * R1.8m (Construction Sector Code) - this rule is for Sarel / a B-BBEE
 * verification professional to confirm, not changed here.
 */
export function beeProofValidAtClosing(c: CompanyVault | null, closingDate: string | null): boolean {
  if (!c?.bee_level || !c.bee_proof_type || !c.bee_proof_expiry) return false;
  return validityAtClosing(c.bee_proof_expiry, closingDate).status === "have";
}

/** SANRAL Form B4 quality-system input for sanralScoring.ts, from the vault. */
export function qualitySystemFromVault(c: CompanyVault | null, closingDate: string | null): "iso" | null {
  if (!c?.iso_9001_certified || !c.iso_9001_expiry) return null; // not stated / no expiry -> leave as a range
  return validityAtClosing(c.iso_9001_expiry, closingDate).status === "have" ? "iso" : null;
}

export type ProvenanceLite = { field_key: string; status: string };

export type ExperienceSummary = {
  // Tagged experience_items completed within 10 years of closing (SANRAL B6
  // window), via experience_matches() (migration 0012).
  qualifyingCount: number;
  scoreableCount: number; // reference letters / CIDB performance reports - what B6 scores
  ratedCount: number; // scoreable AND carrying a poor/adequate/good/excellent rating
};

export const SANRAL_CONVENTIONAL_FAMILY = "Conventional Consultant Tender";

function provenanceFor(rows: ProvenanceLite[], prefixes: string[]) {
  const matching = rows.filter((r) => prefixes.some((p) => r.field_key === p || r.field_key.startsWith(p + ".")));
  return {
    total: matching.length,
    missing: matching.filter((r) => r.status === "missing").length,
    assumed: matching.filter((r) => r.status === "assumed_default").length,
  };
}

function formFillNote(rows: ProvenanceLite[], prefixes: string[], hasPack: boolean): { status: ComplianceStatus | null; note: string } {
  if (!hasPack) return { status: null, note: "" };
  const p = provenanceFor(rows, prefixes);
  if (p.total === 0) return { status: null, note: "" };
  if (p.missing > 0) return { status: "check", note: ` The filled form still has ${p.missing} blank field(s) - see the readiness report.` };
  if (p.assumed > 0) return { status: "check", note: ` ${p.assumed} answer(s) on the filled form are assumed defaults - review before signing.` };
  return { status: null, note: " Form filled from your data." };
}

export function sanralConventionalDocumentChecks(input: {
  company: CompanyVault | null;
  closingDate: string | null;
  provenance: ProvenanceLite[];
  hasPack: boolean;
  financialCaptureStatus: "draft" | "complete" | null;
  briefingTask: { status: string; due_date: string | null } | null;
  experience: ExperienceSummary | null;
  experienceAvailable: boolean;
  // The tender's own experience-evidence rule, evaluated against the
  // Experience Library (experienceEvidence.ts evaluateEvidence) - labelled
  // as an assumption there when the tender's rule hasn't been read. When
  // given, it replaces the fixed SANRAL-B6 reading below.
  evidence?: { status: ComplianceStatus; label: string; detail: string } | null;
  // The company's own A2 letter of authority (company_document_templates, 0037):
  // "uploaded" / "ai_guideline", null = not set up. undefined = not looked up.
  authorityLetter?: "uploaded" | "ai_guideline" | null;
}): ComplianceItem[] {
  const c = input.company;
  const items: ComplianceItem[] = [];
  const closingLeft = daysUntil(closingDayOf(input.closingDate)); // calendar day, as in validityAtClosing()

  // A7 / Stage 2 #2 - registered on CSD.
  items.push({
    key: "csd",
    form: "A7",
    label: "Central Supplier Database (CSD) registration",
    mandatory: true,
    ...(c?.csd_supplier_number
      ? { status: "have" as const, detail: `CSD supplier number ${c.csd_supplier_number} on file. Check the CSD report shows current tax and B-BBEE status before closing.` }
      : { status: "missing" as const, detail: "No CSD supplier number on file - not being registered on CSD disqualifies the tender." }),
  });

  // A20 / Stage 2 #3 - valid COID Letter of Good Standing.
  {
    const exp = c?.coid_letter_of_good_standing_expiry ?? null;
    const expLeft = daysUntil(exp);
    let status: ComplianceStatus;
    let detail: string;
    if (!c?.coid_letter_of_good_standing_number && !exp) {
      status = "missing";
      detail = "No COID Letter of Good Standing on file - a valid one is a mandatory requirement.";
    } else if (!exp) {
      status = "check";
      detail = `Letter ${c?.coid_letter_of_good_standing_number} on file but no expiry date - confirm it is valid on the closing date.`;
    } else if (closingLeft !== null && expLeft !== null && expLeft < closingLeft) {
      status = "missing";
      detail = `Expires ${new Date(exp).toLocaleDateString()}, before this tender closes - renew it first.`;
    } else if (expLeft !== null && expLeft < 0) {
      status = "missing";
      detail = `Expired ${new Date(exp).toLocaleDateString()}.`;
    } else {
      status = "have";
      detail = `Letter ${c?.coid_letter_of_good_standing_number ?? ""} valid until ${new Date(exp).toLocaleDateString()} - covers the closing date.` + copyNote(c?.coid_letter_document_path ?? null);
    }
    const fill = formFillNote(input.provenance, ["a_forms.A20"], input.hasPack);
    const exp_ = !!exp && expiredCopy(status, c?.coid_letter_document_path);
    items.push({ key: "coid", form: "A20", label: "COID Letter of Good Standing", mandatory: true, status: status === "have" && fill.status ? fill.status : status, expiredCopy: exp_, detail: detail + (exp_ ? EXPIRED_COPY_NOTE : "") + fill.note });
  }

  // C1.1.1 / Stage 2 #1 - Form of Offer completed in full and signed.
  {
    const fill = formFillNote(input.provenance, ["c111"], input.hasPack);
    items.push({
      key: "form_of_offer",
      form: "C1.1.1",
      label: "Form of Offer, completed and signed",
      mandatory: true,
      status: fill.status ?? "check",
      detail: (input.hasPack ? "Generated from your company data; it must be signed by hand." : "Not generated yet - create the tender pack first.") + fill.note,
    });
  }

  // Stage 2 #4 - attendance of compulsory briefing session.
  items.push({
    key: "briefing",
    form: "Briefing",
    label: "Attendance at the compulsory briefing session",
    mandatory: true,
    ...(input.briefingTask
      ? input.briefingTask.status === "done"
        ? { status: "have" as const, detail: "Briefing task marked done." }
        : { status: "check" as const, detail: `Briefing task is ${input.briefingTask.status.replace("_", " ")}${input.briefingTask.due_date ? `, due ${new Date(input.briefingTask.due_date).toLocaleDateString()}` : ""}. Missing it disqualifies the tender.` }
      : { status: "check" as const, detail: "No briefing task on this tender. Add one under Tasks & milestones with its date - the date isn't extracted from the tender document yet." }),
  });

  // A9 - tax compliance status (SARS TCS PIN). Real fields since 0014.
  {
    const fill = formFillNote(input.provenance, ["a_forms.A9"], input.hasPack);
    let status: ComplianceStatus;
    let detail: string;
    let expiring = false;
    if (!c?.sars_tcs_pin) {
      status = "missing";
      detail =
        "No SARS Tax Compliance Status PIN on file" +
        (c?.income_tax_number ? ` (income tax number ${c.income_tax_number} is on file, but that is not the PIN)` : "") +
        ". Request one on SARS eFiling and add it to the vault.";
    } else if (!c.sars_tcs_pin_expiry) {
      status = "check";
      detail = `PIN ${c.sars_tcs_pin} on file but no expiry date - add it to the vault so this can be checked against the closing date.`;
    } else {
      const v = validityAtClosing(c.sars_tcs_pin_expiry, input.closingDate);
      status = v.status;
      expiring = v.expiring;
      detail = `PIN ${c.sars_tcs_pin} ${v.text}. SARS lets the taxpayer cancel a PIN early, so re-verify it on eFiling before submitting.`;
    }
    items.push({
      key: "tax",
      form: "A9",
      label: "Tax compliance status (SARS TCS PIN)",
      mandatory: false,
      status: status === "have" && fill.status ? fill.status : status,
      expiring,
      expiredCopy: !!c?.sars_tcs_pin_expiry && expiredCopy(status, c?.sars_tcs_pin_document_path),
      detail:
        detail +
        (c?.sars_tcs_pin ? copyNote(c.sars_tcs_pin_document_path) : "") +
        (c?.sars_tcs_pin_expiry && expiredCopy(status, c?.sars_tcs_pin_document_path) ? EXPIRED_COPY_NOTE : "") +
        fill.note,
    });
  }

  // A12 / SBD 6.1 - B-BBEE (specific goals points; not a disqualifier at SANRAL).
  // A QSE/EME sworn affidavit is valid, equivalent evidence (Sarel's answer 9) -
  // never reported as "no certificate".
  {
    let status: ComplianceStatus;
    let detail: string;
    let expiring = false;
    const levelText = c?.bee_level ? `Level ${c.bee_level}${c.status ? ` (${c.status})` : ""}` : "";
    if (!c?.bee_level) {
      status = "missing";
      detail = "No B-BBEE level on file - you would score 0 of the 10/20 preference points.";
    } else if (!c.bee_proof_type) {
      status = "check";
      detail = `${levelText} on file, but not which proof backs it. Record whether it's a verification certificate or a QSE/EME sworn affidavit, and its expiry - R.396's Form A12 asks for a SANAS certificate and takes an affidavit only from an EME under R1.8m.`;
    } else if (!c.bee_proof_expiry) {
      status = "check";
      detail = `${levelText}, ${BEE_PROOF_LABEL[c.bee_proof_type]} on file, but no expiry date - add it so it can be checked against the closing date.`;
    } else {
      const v = validityAtClosing(c.bee_proof_expiry, input.closingDate);
      status = v.status;
      expiring = v.expiring;
      // Regulatory review 2026-10-17 (docs/specs/Tender-Regulatory-Compliance-Review.md
      // §5): R.396's own Form A12 (Book 1 T-48) and SANRAL's Interim
      // Preferential Procurement Policy (28 Nov 2023, §6.4.1) ask for a SANAS
      // verification certificate under the amended Construction Sector Code;
      // A12 accepts a sworn affidavit / CIPC certificate only from an EME with
      // annual revenue under R1.8 million. Status is unchanged (Sarel's answer
      // 9 stands until he decides otherwise) - the detail now says what the
      // tender's own text says, so a company can check before relying on it.
      const accepted =
        c.bee_proof_type === "certificate"
          ? ""
          : c.bee_proof_type === "qse_affidavit"
            ? " Check before relying on it: R.396's Form A12 asks for a SANAS-accredited verification certificate under the amended Construction Sector Code, and accepts a sworn affidavit only from an EME with annual revenue under R1.8 million - a QSE affidavit is not listed. Confirm this tender's A12 accepts it, or the 10/20 specific-goal points may score 0."
            : " R.396's Form A12 accepts an EME sworn affidavit (or CIPC certificate) only for annual revenue under R1.8 million (amended Construction Sector Code); above that it asks for a SANAS-accredited certificate - confirm against this tender's A12.";
      detail =
        `${levelText}, ${BEE_PROOF_LABEL[c.bee_proof_type]} ${v.text}.${accepted}` +
        (v.status === "missing" ? " Without valid proof you score 0 of the 10/20 preference points (not disqualified)." : "") +
        copyNote(c.bee_proof_document_path) +
        (expiredCopy(status, c.bee_proof_document_path) ? EXPIRED_COPY_NOTE : "");
    }
    const bbbeeExpired = !!c?.bee_proof_expiry && expiredCopy(status, c?.bee_proof_document_path);
    items.push({ key: "bbbee", form: "A12", label: "B-BBEE proof for preference points (SBD 6.1)", mandatory: false, status, expiring, expiredCopy: bbbeeExpired, detail });
  }

  // A2 - authority for signatory.
  {
    const fill = formFillNote(input.provenance, ["a_forms.A2"], input.hasPack);
    items.push({
      key: "authority",
      form: "A2",
      label: "Certificate of authority for signatory",
      mandatory: false,
      // Form-Field-Audit 2026-10-18: this used to be "have" whenever a
      // director's name was on file (the director signs the resolution - true
      // at Klipcorp, where the director is also the signatory). What the pack
      // actually binds in as A2 is the company's OWN letter (0037), so that is
      // what decides the status; the director's name is detail only (and there
      // is no Company-page field for it).
      status:
        input.authorityLetter === undefined
          ? c?.director_name ? fill.status ?? "have" : "missing"
          : input.authorityLetter
            ? fill.status ?? "have"
            : "missing",
      detail:
        (input.authorityLetter === undefined
          ? c?.director_name ? `Director on file (${c.director_name}) to sign the resolution.` : "No director name on file to authorise the signatory."
          : input.authorityLetter
            ? `Your own letter of authority is set up (${input.authorityLetter === "uploaded" ? "your uploaded letter, used as-is" : "generated from your guideline"}) - it goes into the pack to be signed.`
            : "Your letter of authority isn't set up - upload your own or give your guideline on the Company page (Letters & documents); the pack leaves A2 out until then.") +
        (input.authorityLetter !== undefined && c?.director_name ? ` Director on file: ${c.director_name}.` : "") +
        fill.note,
    });
  }

  // A17 - professional indemnity insurance. Real fields since 0014.
  {
    const fill = formFillNote(input.provenance, ["a_forms.A17"], input.hasPack);
    let status: ComplianceStatus;
    let detail: string;
    let expiring = false;
    const policy = c?.pi_insurance_policy_number ? `Policy ${c.pi_insurance_policy_number}${c.pi_insurance_insurer ? ` (${c.pi_insurance_insurer})` : ""}` : "";
    if (!c?.pi_insurance_policy_number && !c?.pi_insurance_expiry) {
      status = "missing";
      detail = "No professional indemnity policy on file - add the policy number and period-to date to the vault.";
    } else if (!c.pi_insurance_expiry) {
      status = "check";
      detail = `${policy} on file but no expiry (period to) date - add it so cover on the closing date can be checked.`;
    } else {
      const v = validityAtClosing(c.pi_insurance_expiry, input.closingDate);
      status = v.status;
      expiring = v.expiring;
      detail = `${policy || "Policy"} ${v.text}.` + copyNote(c.pi_insurance_document_path) + (expiredCopy(status, c.pi_insurance_document_path) ? EXPIRED_COPY_NOTE : "");
    }
    items.push({
      key: "insurance",
      form: "A17",
      label: "Certificate of insurance cover (professional indemnity)",
      mandatory: false,
      status: status === "have" && fill.status ? fill.status : status,
      expiring,
      expiredCopy: !!c?.pi_insurance_expiry && expiredCopy(status, c?.pi_insurance_document_path),
      detail: detail + fill.note,
    });
  }

  // A18 - bank confirmation letter. Usable for 3 months from its date
  // (bank_confirmation_letter_valid_until, a generated column in 0014).
  {
    let status: ComplianceStatus;
    let detail: string;
    let expiring = false;
    if (!c?.bank_confirmation_letter_date || !c.bank_confirmation_letter_valid_until) {
      status = "missing";
      detail = c?.bank_name
        ? `Bank (${c.bank_name}) on file, but no confirmation letter date - get a letter dated within 3 months of closing and add its date to the vault.`
        : "No bank details or confirmation letter on file.";
    } else {
      const v = validityAtClosing(c.bank_confirmation_letter_valid_until, input.closingDate, 30); // 3-month letter: 30-day window, as on the vault
      status = v.status;
      expiring = v.expiring;
      detail =
        `Letter dated ${fmt(c.bank_confirmation_letter_date)}` +
        (v.status === "have"
          ? `, within 3 months of closing (${v.text}).`
          : ` - older than 3 months by the closing date; get a fresh one.`) +
        copyNote(c.bank_confirmation_letter_path) +
        (expiredCopy(status, c.bank_confirmation_letter_path) ? EXPIRED_COPY_NOTE : "");
    }
    const bankExpired = !!c?.bank_confirmation_letter_valid_until && expiredCopy(status, c?.bank_confirmation_letter_path);
    items.push({ key: "bank", form: "A18", label: "Bank confirmation letter", mandatory: false, status, expiring, expiredCopy: bankExpired, detail });
  }

  // A4-A23 declarations - filled from data by fill_a_forms.py, signed by hand.
  {
    const forms = ["A4", "A5", "A6", "A8", "A10", "A11", "A13", "A14", "A15", "A16", "A19", "A21", "A22", "A23"];
    const fill = formFillNote(input.provenance, forms.map((f) => `a_forms.${f}`), input.hasPack);
    items.push({
      key: "declarations",
      form: "A4-A23",
      label: "Standard declarations (debt, fronting, litigation, SBD 4, POPIA, past SCM practices, addenda, commitments...)",
      mandatory: false,
      status: fill.status ?? (input.hasPack ? "have" : "check"),
      detail: (input.hasPack ? "Generated by Tender Ready; each one is signed by hand." : "Generated once the tender pack exists.") + fill.note,
    });
  }

  // B4 - quality system certificate (10 functionality points). Real fields since 0014.
  {
    let status: ComplianceStatus;
    let detail: string;
    let expiring = false;
    const points = "Worth 10 functionality points: ISO certified 10, submitted for ISO 7, in-house 5, none 0.";
    if (c?.iso_9001_certified === true) {
      const cert = `ISO 9001 certified${c.iso_9001_certificate_number ? ` (certificate ${c.iso_9001_certificate_number})` : ""}`;
      if (!c.iso_9001_expiry) {
        status = "check";
        detail = `${cert}, but no certificate expiry date on file - add it so validity on the closing date can be checked. ${points}`;
      } else {
        const v = validityAtClosing(c.iso_9001_expiry, input.closingDate);
        status = v.status;
        expiring = v.expiring;
        detail =
          `${cert}, ${v.text}.` +
          (v.status === "have" ? " Submit the certificate with Form B4 for the full 10 points." : ` Without it, an in-house QMS scores 5. ${points}`) +
          copyNote(c.iso_9001_document_path) +
          (expiredCopy(status, c.iso_9001_document_path) ? EXPIRED_COPY_NOTE : "");
      }
    } else if (c?.iso_9001_certified === false) {
      status = "missing";
      detail = `Not ISO 9001 certified. An in-house QMS on Form B4 scores 5. ${points}`;
    } else {
      status = "check";
      detail = `ISO 9001 certification not stated in the vault yet. ${points}`;
    }
    const isoExpired = c?.iso_9001_certified === true && !!c.iso_9001_expiry && expiredCopy(status, c.iso_9001_document_path);
    items.push({ key: "quality_system", form: "B4", label: "Certificate of quality systems (ISO 9001 or in-house)", mandatory: false, status, expiring, expiredCopy: isoExpired, detail });
  }

  // B6 - past performance (15 functionality points) - company experience.
  if (input.experienceAvailable && input.evidence) {
    items.push({ key: "past_performance", form: "B6", label: input.evidence.label, mandatory: false, status: input.evidence.status, detail: input.evidence.detail });
  } else if (!input.experienceAvailable) {
    items.push({
      key: "past_performance",
      form: "B6",
      label: "Past performance on 3 completed projects (last 10 years)",
      mandatory: false,
      status: "check",
      detail: "The Experience Library couldn't be read for this check, so company project evidence (reference letters, CIDB PSP reports) isn't counted. Worth 15 functionality points.",
    });
  } else {
    const e = input.experience ?? { qualifyingCount: 0, scoreableCount: 0, ratedCount: 0 };
    let status: ComplianceStatus;
    let detail: string;
    if (e.scoreableCount >= 3 && e.ratedCount >= 3) {
      status = "have";
      detail = `${e.scoreableCount} rated reference letter(s)/CIDB report(s) for completed projects in the window - enough for B6.`;
    } else if (e.scoreableCount >= 3) {
      status = "check";
      detail = `${e.scoreableCount} reference letter(s)/CIDB report(s) in the window, ${e.ratedCount} with a rating tagged - tag the ratings so the score estimate can use them.`;
    } else {
      status = "missing";
      detail =
        `Only ${e.scoreableCount} reference letter(s)/CIDB report(s) for completed projects in the last 10 years` +
        (e.qualifyingCount > e.scoreableCount ? ` (${e.qualifyingCount - e.scoreableCount} more completed project(s) tagged, but with evidence B6 doesn't score)` : "") +
        ". The B6 sworn affidavit covers the gap at 'Adequate' - fewer points than a good or excellent letter.";
    }
    items.push({
      key: "past_performance",
      form: "B6",
      label: "Past performance on 3 completed projects (last 10 years)",
      mandatory: false,
      status,
      detail,
    });
  }

  // C2.4 - key persons and normalised hours (30 workplan points).
  items.push({
    key: "hours",
    form: "C2.4",
    label: "Key persons and normalised hours tendered",
    mandatory: false,
    ...(input.financialCaptureStatus === "complete"
      ? { status: "have" as const, detail: "Hours captured." }
      : input.financialCaptureStatus === "draft"
        ? { status: "check" as const, detail: "Hours capture started but not complete. Worth 30 workplan points." }
        : { status: "missing" as const, detail: "No hours captured for this tender yet. Worth 30 workplan points - a blank C2.4 scores 0." }),
  });

  return items;
}

// C3.1.11(d) minimum requirements. "Pr Eng or Pr Tech Eng" = registered with
// ECSA as a Professional Engineer or Professional Engineering Technologist
// (footnote 1) - a Professional Engineering Technician does NOT qualify.
//
// Source, per tender (audit Q5, Sarel 2026-10-17 "Rest of Q5: build it"):
// C3.1.11 lives in each tender's own Scope of Services ("The minimum
// qualifications ... shall be as indicated in the table below"), and real
// tenders differ - N.011-010-2027-1F wants Pr Eng (only) for the Contract
// Engineer, 10-15 years for the RE and 5 for the ARE, where R.396 says Pr Eng
// or Pr Tech Eng / 5 / 2. So the check uses THIS tender's own table when
// engine/discovery/key_person_minimums.py has read it into
// tenders.evaluation_rules.key_person_minimums (seed_tender_evaluation_rules.py
// with Book 2/3, or the intake of a manually loaded tender) - exactly as the
// experience-evidence rule uses the tender's own rule. Only when the tender's
// table hasn't been read (or has no row for the position) does it fall back
// to R.396-010-2025/1F Book 2/3 C3.1.11(d) (C3-14/C3-15) below, and then every
// result says "Assumed rule" (same banner as the experience-evidence
// fallback).
//
// Conditional registrations (SACNASP / SAGC: people columns, 0040; SACQSP /
// SACAP / SACPLAN / SACPVP / PSIRA: the person's held_registrations in the
// 0050 catalog): read ONLY for a position whose requirement names that body -
// never for every key person ("don't specifically ask for it unless the
// tender requires it").
export const ASSUMED_MIN_REQ_SOURCE = "R.396-010-2025/1F C3.1.11 table - check this tender's own C3.1.11";
export const OWN_MIN_REQ_SOURCE = "this tender's own C3.1.11 table";

export type RegistrationCode =
  | "pr_eng"
  | "pr_eng_or_tech"
  | "pr_tech_eng"
  | "pr_techni_eng"
  | "candidate"
  | "pr_sci_nat"
  | "sagc"
  | "sacqsp"
  | "sacap"
  | "sacplan"
  | "sacpvp"
  | "psira"
  | "sacpcmp"
  | "none"
  | "qualification"
  | "refer"
  | "alternatives";

/** One row of a tender's own C3.1.11 table (engine/discovery/key_person_minimums.py). */
export type KeyPersonMinimumRow = {
  position: string;
  position_code: string | null;
  specialist: string | null;
  qualification: string | null;
  registration: RegistrationCode | null;
  bodies: string[];
  years_text: string | null;
  years_min: number | null;
  years_under: number | null;
  other: string | null;
  alternatives: { qualification: string; registration: RegistrationCode | null; years_text: string; years_min: number | null }[];
  quote: string;
};
export type KeyPersonMinimums = {
  source: "tender_document" | "not_found";
  clause: string | null;
  rows: KeyPersonMinimumRow[];
  unparsed?: string[];
  reason?: string;
};

export type MinReq = {
  registration: RegistrationCode | null;
  years: number | null;
  label: string;
  source: "tender_document" | "assumed";
  other?: string | null;
  alternatives?: KeyPersonMinimumRow["alternatives"];
  qualification?: string | null;
};
const ENGINEERING_GEOLOGIST_REQ: MinReq = { registration: "pr_sci_nat", years: 5, label: "Pr Sci.Nat (SACNASP), member of SAIEG, 5 years' relevant experience", source: "assumed" };
const SURVEYOR_REQ: MinReq = { registration: "sagc", years: 5, label: "Registered with SAGC (SA Geomatics Council), 5 years' relevant experience", source: "assumed" };
const PR_SCI_NAT_RE = /pr\.?\s*sci\.?\s*nat|professional\s+natural\s+scientist/i;
const CAND_SCI_NAT_RE = /cand\.?\s*sci\.?\s*nat|cert\.?\s*sci\.?\s*nat|candidate|certificated/i;
export const SANRAL_MIN_REQUIREMENTS: Record<string, MinReq> = {
  PL: { registration: "pr_eng_or_tech", years: 10, label: "Pr Eng or Pr Tech Eng, 10 years' relevant experience", source: "assumed" },
  APL: { registration: "pr_eng_or_tech", years: null, label: "Pr Eng or Pr Tech Eng, under 10 years", source: "assumed" },
  DS: { registration: "pr_eng_or_tech", years: 10, label: "Pr Eng or Pr Tech Eng, 10 years' relevant experience", source: "assumed" },
  ADS: { registration: "pr_eng_or_tech", years: null, label: "Pr Eng or Pr Tech Eng, under 10 years", source: "assumed" },
  CE: { registration: "pr_eng_or_tech", years: 10, label: "Pr Eng or Pr Tech Eng, 10 years' relevant experience", source: "assumed" },
  ACE: { registration: "pr_eng_or_tech", years: null, label: "Pr Eng or Pr Tech Eng, under 10 years", source: "assumed" },
  RE: { registration: "pr_eng_or_tech", years: 5, label: "Pr Eng or Pr Tech Eng, 5 years' relevant experience", source: "assumed" },
  ARE: { registration: "candidate", years: 2, label: "Registered candidate (engineer, technologist or technician), 2 years", source: "assumed" },
};

const PR_ENG_OR_TECH_RE = /professional\s+engineer(?!ing\s+technician)|professional\s+engineering\s+technologist|\bpr\.?\s*eng\b|\bpr\.?\s*tech\s*eng\b/i;
// "Pr Eng" only (N.011's Contract Engineer): a Professional Engineer, not a technologist.
const PR_ENG_ONLY_RE = /professional\s+engineer\b|\bpr\.?\s*eng\b/i;
const PR_TECH_ENG_RE = /professional\s+engineer\b|professional\s+engineering\s+technologist|\bpr\.?\s*(?:eng|tech\s*eng)\b/i;
// Pr Techni Eng minimum: a professional technician, or a higher professional category.
const PR_TECHNI_ENG_RE = /professional\s+engineer|professional\s+engineering\s+(?:technologist|technician)|\bpr\.?\s*(?:eng|tech\s*eng|techni\s*eng)\b/i;
const CANDIDATE_RE = /candidate|professional|\bpr\.?\s*(eng|tech)/i;

// Catalog body (0050 held_registrations) per registration code.
const BODY_FOR_CODE: Partial<Record<RegistrationCode, CatalogBody>> = {
  sacqsp: "SACQSP",
  sacap: "SACAP",
  sacplan: "SACPLAN",
  sacpvp: "SACPVP",
  psira: "PSIRA",
};

export type PersonFacts = {
  name: string;
  ecsa_level: string | null;
  ecsa_number: string | null;
  initial_graduated: string | null;
  // 0035 - read only when the position's requirement names SACPCMP
  sacpcmp_number?: string | null;
  sacpcmp_expiry?: string | null;
  // 0050 catalog registrations this person holds (SACQSP, SACAP, ...)
  held?: HeldCatalogRegistration[];
} & PersonCredentialFields;

// A position whose own SETUP description names a profession with its own
// council is checked against that council, not ECSA.
function specialistOf(description: string | null): string | null {
  if (!description) return null;
  if (/geolog/i.test(description)) return "engineering_geologist";
  if (SACQSP_POSITION_RE.test(description)) return "quantity_surveyor";
  if (SAGC_POSITION_RE.test(description)) return "surveyor";
  return null;
}

function fromOwnRow(r: KeyPersonMinimumRow): MinReq {
  const years =
    r.registration === "alternatives"
      ? null
      : r.years_under
        ? null
        : r.years_min;
  const parts = [r.qualification ?? "no qualification stated"];
  if (r.years_under) parts.push(`under ${r.years_under} years`);
  else if (r.years_text && /\d/.test(r.years_text) && !/[A-Za-z]/.test(r.years_text)) parts.push(`${r.years_text} years' relevant experience`);
  else if (r.years_text) parts.push(`experience: ${r.years_text}`);
  return {
    registration: r.registration,
    years,
    label: `${r.position}: ${parts.join(", ")}`,
    source: "tender_document",
    other: r.other,
    alternatives: r.alternatives,
    qualification: r.qualification,
  };
}

/**
 * Which requirement applies to a position: THIS tender's own C3.1.11 row
 * when its table was read (matched by the position's own SETUP description
 * for a specialist - geologist, surveyor, quantity surveyor - else by the
 * position code), otherwise R.396's table (source "assumed").
 */
export function minimumRequirementFor(
  positionCode: string,
  description: string | null,
  own: KeyPersonMinimums | null = null,
): MinReq | undefined {
  const code = positionCode.replace(/\d+$/, "");
  const spec = specialistOf(description);
  if (own?.source === "tender_document") {
    const row = spec ? own.rows.find((r) => r.specialist === spec) : own.rows.find((r) => r.position_code === code);
    if (row) return fromOwnRow(row);
  }
  if (spec === "engineering_geologist") return ENGINEERING_GEOLOGIST_REQ;
  if (spec === "surveyor") return SURVEYOR_REQ;
  if (spec === "quantity_surveyor") {
    // R.396's table has no QS row; the council is the one fact the position
    // itself gives. Years not assumed.
    return { registration: "sacqsp", years: null, label: "Registered with SACQSP (the position is a quantity surveyor - years not assumed)", source: "assumed" };
  }
  return SANRAL_MIN_REQUIREMENTS[code];
}

/** A registration with an expiry: valid on the closing date? (null = no expiry recorded) */
function registrationValidity(expiry: string | null | undefined, closingDate: string | null): { ok: boolean; text: string } | null {
  if (!expiry) return null;
  const v = validityAtClosing(expiry, closingDate);
  return { ok: v.status === "have", text: v.text };
}

type RegResult = { problems: string[]; unknowns: string[]; regText: string };

/** Does the person's record meet one registration code? */
function checkRegistration(reg: RegistrationCode | null, qualification: string | null | undefined, person: PersonFacts, closingDate: string | null): RegResult {
  const problems: string[] = [];
  const unknowns: string[] = [];
  let regText = "";
  const level = person.ecsa_level ?? "";
  const ecsa = (re: RegExp, need: string) => {
    if (!level) unknowns.push("no ECSA registration on file");
    else if (!re.test(level)) problems.push(`ECSA "${level}" doesn't meet "${need}"`);
    else if (!person.ecsa_number) unknowns.push("ECSA number not on file");
  };
  switch (reg) {
    case "pr_eng_or_tech":
      ecsa(PR_ENG_OR_TECH_RE, "Pr Eng or Pr Tech Eng");
      break;
    case "pr_eng":
      ecsa(PR_ENG_ONLY_RE, "Pr Eng");
      break;
    case "pr_tech_eng":
      ecsa(PR_TECH_ENG_RE, "Pr Tech Eng");
      break;
    case "pr_techni_eng":
      ecsa(PR_TECHNI_ENG_RE, "Pr Techni Eng");
      break;
    case "candidate":
      ecsa(CANDIDATE_RE, "registered candidate");
      break;
    case "pr_sci_nat": {
      // SACNASP fields (0040). Older records may only carry it in the ECSA
      // level text, so that still counts as stated.
      const cat = person.sacnasp_category ?? "";
      const stated = PR_SCI_NAT_RE.test(cat) || PR_SCI_NAT_RE.test(level);
      if (!person.sacnasp_number && !cat && !PR_SCI_NAT_RE.test(level)) {
        unknowns.push("no SACNASP registration on file - add it on the People page (it appears there because this tender asks for it)");
      } else if (cat && !stated && CAND_SCI_NAT_RE.test(cat)) {
        problems.push(`SACNASP "${cat}" isn't Pr Sci.Nat (professional) registration`);
      } else {
        if (!stated) unknowns.push("SACNASP category not recorded - confirm it is Pr Sci.Nat");
        if (!person.sacnasp_number) unknowns.push("SACNASP number not on file");
        const v = registrationValidity(person.sacnasp_expiry, closingDate);
        if (v && !v.ok) problems.push(`SACNASP registration ${v.text}`);
        else if (!v && person.sacnasp_number) unknowns.push("SACNASP renewal date not on file");
        regText = `SACNASP ${cat || "registration"}${person.sacnasp_number ? ` ${person.sacnasp_number}` : ""}${v ? `, ${v.text}` : ""}`;
      }
      break;
    }
    case "sacpcmp": {
      if (!person.sacpcmp_number) unknowns.push("no SACPCMP registration on file");
      else {
        const v = registrationValidity(person.sacpcmp_expiry, closingDate);
        if (v && !v.ok) problems.push(`SACPCMP registration ${v.text}`);
        else if (!v) unknowns.push("SACPCMP renewal date not on file");
        regText = `SACPCMP ${person.sacpcmp_number}${v ? `, ${v.text}` : ""}`;
      }
      unknowns.push("confirm the SACPCMP category (e.g. Construction Health and Safety Agent) against the table");
      break;
    }
    case "sagc": {
      const cat = person.sagc_category ?? "";
      if (!person.sagc_number && !cat) {
        unknowns.push("no SAGC registration on file - add it on the People page (it appears there because this tender asks for it)");
      } else {
        if (!person.sagc_number) unknowns.push("SAGC number not on file");
        const v = registrationValidity(person.sagc_expiry, closingDate);
        if (v && !v.ok) problems.push(`SAGC registration ${v.text}`);
        else if (!v) unknowns.push("SAGC renewal date not on file");
        regText = `SAGC ${cat || "registration"}${person.sagc_number ? ` ${person.sagc_number}` : ""}${v ? `, ${v.text}` : ""}`;
      }
      break;
    }
    case "sacqsp":
    case "sacap":
    case "sacplan":
    case "sacpvp":
    case "psira": {
      // The 0050 catalog: the person may hold several (e.g. renewed); the
      // one valid longest counts (an undated one last).
      const body = BODY_FOR_CODE[reg]!;
      const held = (person.held ?? [])
        .filter((h) => h.slug === catalogSlug(body))
        .sort((a, b) => (b.expiry_date ?? "0000").localeCompare(a.expiry_date ?? "0000"));
      const h = held[0];
      if (!h) {
        unknowns.push(`no ${body} registration on file - add it on the People page (it appears there because this tender asks for it)`);
      } else {
        if (!h.registration_number) unknowns.push(`${body} number not on file`);
        const v = registrationValidity(h.expiry_date, closingDate);
        if (v && !v.ok) problems.push(`${body} registration ${v.text}`);
        else if (!v) unknowns.push(`${body} renewal date not on file`);
        regText = `${body} ${h.category || "registration"}${h.registration_number ? ` ${h.registration_number}` : ""}${v ? `, ${v.text}` : ""}`;
      }
      break;
    }
    case "none":
      regText = "no registration required";
      break;
    case "qualification":
      unknowns.push(`the tender asks for a qualification ("${qualification ?? ""}") - check it against the CV`);
      break;
    case "refer":
      unknowns.push(`the tender's table says "${qualification ?? "refer to another document"}" - check that document`);
      break;
    default:
      unknowns.push(`couldn't read what "${qualification ?? "the table"}" requires - check the tender's table`);
  }
  return { problems, unknowns, regText };
}

function yearsCheck(years: number | null, person: PersonFacts, closingDate: string | null) {
  const problems: string[] = [];
  const unknowns: string[] = [];
  let yearsNote = "";
  if (years !== null) {
    const yrs = person.initial_graduated && closingDate
      ? (new Date(closingDate).getTime() - new Date(person.initial_graduated).getTime()) / (365.25 * 24 * 3600 * 1000)
      : NaN;
    // NaN (no date, or one that can't be read) is unknown - a NaN "yrs < years"
    // is false, which used to pass the check silently for an unreadable date.
    if (!Number.isNaN(yrs)) {
      const y = Math.floor(yrs);
      yearsNote = ` ${y} years since first degree (a proxy - SANRAL counts relevant experience, not years since graduating).`;
      if (yrs < years) problems.push(`only ${y} years since first degree, ${years} needed`);
    } else {
      unknowns.push("no graduation date to count experience from");
    }
  }
  return { problems, unknowns, yearsNote };
}

export function checkMinimumRequirement(
  positionCode: string,
  person: PersonFacts | null,
  closingDate: string | null,
  description: string | null = null,
  own: KeyPersonMinimums | null = null,
): { status: ComplianceStatus; detail: string; requirement: string | null; source: "tender_document" | "assumed" | null } {
  const found = minimumRequirementFor(positionCode, description, own);
  const req = found ? { ...found, label: `${found.label} (${found.source === "tender_document" ? OWN_MIN_REQ_SOURCE : ASSUMED_MIN_REQ_SOURCE})` } : undefined;
  const source = req?.source ?? null;
  if (!person) return { status: "missing", detail: "No key person confirmed for this position.", requirement: req?.label ?? null, source };
  if (!req) return { status: "check", detail: "No minimum requirement on file for this position code - check the tender's C3.1.11 table.", requirement: null, source };

  // The table's "Other requirements" (permanent employment, SAIEG
  // membership, a road-safety course) aren't on the person's record - named,
  // never counted as met or failed.
  // ("Member of SAGC" / "SACQSP" in that column is the registration itself,
  // which IS checked.)
  const otherIsTheBody = !!req.other && /^(?:member\s+of\s+)?(?:SAGC|SACQSP|SACAP|SACPLAN|SACPVP|PSIRA|SACNASP|SACPCMP)$/i.test(req.other.trim());
  const otherNote = req.other && !otherIsTheBody ? ` Also required by the table (not checked from records): ${req.other}.` : "";

  if (req.registration === "alternatives" && req.alternatives?.length) {
    // Several qualification/years pairs (Senior Materials Technician): met
    // when ANY one is.
    const results = req.alternatives.map((a) => {
      const r = checkRegistration(a.registration, a.qualification, person, closingDate);
      const y = yearsCheck(a.years_min, person, closingDate);
      const problems = [...r.problems, ...y.problems];
      const unknowns = [...r.unknowns, ...y.unknowns];
      return { a, problems, unknowns, status: (problems.length ? "missing" : unknowns.length ? "check" : "have") as ComplianceStatus, note: y.yearsNote, regText: r.regText };
    });
    const best = results.find((r) => r.status === "have") ?? results.find((r) => r.status === "check") ?? results[0];
    const which = `${best.a.qualification}, ${best.a.years_text} years`;
    if (best.status === "have") return { status: "have", detail: `Meets the "${which}" option.${best.note}${otherNote}`, requirement: req.label, source };
    if (best.status === "check") return { status: "check", detail: `Can't confirm any option; closest "${which}": ${best.unknowns.join("; ")}.${best.note}${otherNote}`, requirement: req.label, source };
    return { status: "missing", detail: `Doesn't meet any option (e.g. "${which}": ${best.problems.join("; ")}).${best.note}${otherNote}`, requirement: req.label, source };
  }

  const r = checkRegistration(req.registration, req.qualification ?? null, person, closingDate);
  const y = yearsCheck(req.years, person, closingDate);
  const problems = [...r.problems, ...y.problems];
  const unknowns = [...r.unknowns, ...y.unknowns];
  if (problems.length) {
    const yearsProblem = problems.some((p) => p.includes("since first degree"));
    return { status: "missing", detail: `Doesn't meet the minimum: ${problems.join("; ")}.${yearsProblem ? " (Years since first degree is a proxy - SANRAL counts relevant experience.)" : y.yearsNote}${otherNote}`, requirement: req.label, source };
  }
  if (unknowns.length) return { status: "check", detail: `Can't confirm: ${unknowns.join("; ")}.${y.yearsNote}${otherNote}`, requirement: req.label, source };
  const level = person.ecsa_level ?? "";
  const held = r.regText || `${level}${person.ecsa_number ? ` (ECSA ${person.ecsa_number})` : ""}`;
  return { status: "have", detail: `${held}.${y.yearsNote}${otherNote}`, requirement: req.label, source };
}
