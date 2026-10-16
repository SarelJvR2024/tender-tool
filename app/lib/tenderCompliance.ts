// Per-tender compliance check: which documents the tender requires that the
// company HAS on file, DOESN'T have, or that Tender Tool CAN'T TELL (not
// tracked in the vault yet) - plus key-person minimum requirements.
//
// Requirement list source, read in full rather than assumed: SANRAL
// R.396-010-2025/1F Book 1, "PART T2.1 LIST OF RETURNABLE DOCUMENTS" (T-31/
// T-32) and Tender Data C.3.11 "Stage 2 Mandatory Administration Criteria"
// (T-11); key-person minimums from Book 2/3, C3.1.11(d) "Minimum
// requirements" (C3-14). Same template family ("Conventional Consultant
// Tender") as all six SANRAL tenders seeded in app/supabase/seed_tenders.sql.
// Non-SANRAL tenders have no extracted requirement list yet (see
// docs/specs/General-Tender-Engine-Findings.md - each buyer's returnable list
// differs), so this module only claims to cover that one family.
//
// The vault is the `companies` row (0001) - there is no per-document upload
// table, so "has the document" means "the identifying number/date is on
// file". Where the schema has no field at all for a required document
// (SARS TCS PIN, insurance, ISO certificate...), the status is "check", never
// "have" - absence of a field is not evidence the company lacks the document.

import { daysUntil } from "./dates";

export type ComplianceStatus = "have" | "missing" | "check";

export type ComplianceItem = {
  key: string;
  form: string;
  label: string;
  status: ComplianceStatus;
  mandatory: boolean; // Stage 2 "Mandatory Administration Criteria" - failing it disqualifies
  detail: string;
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
};

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
}): ComplianceItem[] {
  const c = input.company;
  const items: ComplianceItem[] = [];
  const closingLeft = daysUntil(input.closingDate);

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
      detail = `Letter ${c?.coid_letter_of_good_standing_number ?? ""} valid until ${new Date(exp).toLocaleDateString()} - covers the closing date.`;
    }
    const fill = formFillNote(input.provenance, ["a_forms.A20"], input.hasPack);
    items.push({ key: "coid", form: "A20", label: "COID Letter of Good Standing", mandatory: true, status: status === "have" && fill.status ? fill.status : status, detail: detail + fill.note });
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

  // A9 - tax compliance status (SARS TCS PIN).
  items.push({
    key: "tax",
    form: "A9",
    label: "Tax compliance status (SARS TCS PIN)",
    mandatory: false,
    status: "check",
    detail:
      "The vault has no field for the SARS TCS PIN or its expiry yet" +
      (c?.income_tax_number ? ` (income tax number ${c.income_tax_number} is on file, but that is not the PIN)` : "") +
      " - confirm you have a current PIN." +
      formFillNote(input.provenance, ["a_forms.A9"], input.hasPack).note,
  });

  // A12 / SBD 6.1 - B-BBEE (specific goals points; not a disqualifier at SANRAL).
  items.push({
    key: "bbbee",
    form: "A12",
    label: "B-BBEE proof for preference points (SBD 6.1)",
    mandatory: false,
    ...(c?.bee_level
      ? {
          status: "check" as const,
          detail: `Level ${c.bee_level}${c.status ? ` (${c.status})` : ""} on file. SANRAL asks for a valid B-BBEE verification certificate - if you hold a QSE/EME sworn affidavit instead, confirm SANRAL accepts it. Its expiry isn't tracked in the vault. Without valid proof you score 0 of the 10/20 preference points (not disqualified).`,
        }
      : { status: "missing" as const, detail: "No B-BBEE level on file - you would score 0 of the 10/20 preference points." }),
  });

  // A2 - authority for signatory.
  {
    const fill = formFillNote(input.provenance, ["a_forms.A2"], input.hasPack);
    items.push({
      key: "authority",
      form: "A2",
      label: "Certificate of authority for signatory",
      mandatory: false,
      status: c?.director_name ? fill.status ?? "have" : "missing",
      detail: (c?.director_name ? `Director on file (${c.director_name}) to sign the resolution.` : "No director name on file to authorise the signatory.") + fill.note,
    });
  }

  // A17 - insurance cover.
  items.push({
    key: "insurance",
    form: "A17",
    label: "Certificate of insurance cover (professional indemnity)",
    mandatory: false,
    status: "check",
    detail: "Insurance isn't tracked in the vault yet - confirm the policy schedule is current on the closing date." + formFillNote(input.provenance, ["a_forms.A17"], input.hasPack).note,
  });

  // A18 - bank details / FSP letter.
  items.push({
    key: "bank",
    form: "A18",
    label: "Bank confirmation letter",
    mandatory: false,
    status: c?.bank_name ? "check" : "missing",
    detail: c?.bank_name
      ? `Bank (${c.bank_name}) on file, but the letter's date isn't tracked - most buyers want one dated within 3 months.`
      : "No bank details on file.",
  });

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
      detail: (input.hasPack ? "Generated by Tender Tool; each one is signed by hand." : "Generated once the tender pack exists.") + fill.note,
    });
  }

  // B4 - quality system certificate (10 functionality points).
  items.push({
    key: "quality_system",
    form: "B4",
    label: "Certificate of quality systems (ISO 9001 or in-house)",
    mandatory: false,
    status: "check",
    detail: "Not tracked in the vault. Worth 10 functionality points: ISO certified 10, submitted for ISO 7, in-house 5, none 0.",
  });

  // B6 - past performance (15 functionality points) - company experience.
  if (!input.experienceAvailable) {
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
type MinReq = { registration: "pr_eng_or_tech" | "candidate"; years: number | null; label: string };
export const SANRAL_MIN_REQUIREMENTS: Record<string, MinReq> = {
  PL: { registration: "pr_eng_or_tech", years: 10, label: "Pr Eng or Pr Tech Eng, 10 years' relevant experience" },
  APL: { registration: "pr_eng_or_tech", years: null, label: "Pr Eng or Pr Tech Eng, under 10 years" },
  DS: { registration: "pr_eng_or_tech", years: 10, label: "Pr Eng or Pr Tech Eng, 10 years' relevant experience" },
  ADS: { registration: "pr_eng_or_tech", years: null, label: "Pr Eng or Pr Tech Eng, under 10 years" },
  CE: { registration: "pr_eng_or_tech", years: 10, label: "Pr Eng or Pr Tech Eng, 10 years' relevant experience" },
  ACE: { registration: "pr_eng_or_tech", years: null, label: "Pr Eng or Pr Tech Eng, under 10 years" },
  RE: { registration: "pr_eng_or_tech", years: 5, label: "Pr Eng or Pr Tech Eng, 5 years' relevant experience" },
  ARE: { registration: "candidate", years: 2, label: "Registered candidate (engineer, technologist or technician), 2 years" },
};

const PR_ENG_OR_TECH_RE = /professional\s+engineer(?!ing\s+technician)|professional\s+engineering\s+technologist|\bpr\.?\s*eng\b|\bpr\.?\s*tech\s*eng\b/i;
const CANDIDATE_RE = /candidate|professional|\bpr\.?\s*(eng|tech)/i;

export type PersonFacts = {
  name: string;
  ecsa_level: string | null;
  ecsa_number: string | null;
  initial_graduated: string | null;
};

export function checkMinimumRequirement(
  positionCode: string,
  person: PersonFacts | null,
  closingDate: string | null,
): { status: ComplianceStatus; detail: string; requirement: string | null } {
  const code = positionCode.replace(/\d+$/, "");
  const req = SANRAL_MIN_REQUIREMENTS[code];
  if (!person) return { status: "missing", detail: "No key person confirmed for this position.", requirement: req?.label ?? null };
  if (!req) return { status: "check", detail: "No minimum requirement on file for this position code - check the tender's C3.1.11 table.", requirement: null };

  const problems: string[] = [];
  const unknowns: string[] = [];
  const level = person.ecsa_level ?? "";
  const regOk = req.registration === "pr_eng_or_tech" ? PR_ENG_OR_TECH_RE.test(level) : CANDIDATE_RE.test(level);
  if (!level) unknowns.push("no ECSA registration on file");
  else if (!regOk) problems.push(`ECSA "${level}" doesn't meet "${req.registration === "pr_eng_or_tech" ? "Pr Eng or Pr Tech Eng" : "registered candidate"}"`);
  else if (!person.ecsa_number) unknowns.push("ECSA number not on file");

  let yearsNote = "";
  if (req.years !== null) {
    if (person.initial_graduated && closingDate) {
      const yrs = (new Date(closingDate).getTime() - new Date(person.initial_graduated).getTime()) / (365.25 * 24 * 3600 * 1000);
      const y = Math.floor(yrs);
      yearsNote = ` ${y} years since first degree (a proxy - SANRAL counts relevant experience, not years since graduating).`;
      if (yrs < req.years) problems.push(`only ${y} years since first degree, ${req.years} needed`);
    } else {
      unknowns.push("no graduation date to count experience from");
    }
  }

  if (problems.length) {
    const yearsProblem = problems.some((p) => p.includes("since first degree"));
    return { status: "missing", detail: `Doesn't meet the minimum: ${problems.join("; ")}.${yearsProblem ? " (Years since first degree is a proxy - SANRAL counts relevant experience.)" : yearsNote}`, requirement: req.label };
  }
  if (unknowns.length) return { status: "check", detail: `Can't confirm: ${unknowns.join("; ")}.${yearsNote}`, requirement: req.label };
  return { status: "have", detail: `${level}${person.ecsa_number ? ` (ECSA ${person.ecsa_number})` : ""}.${yearsNote}`, requirement: req.label };
}
