// What counts as company-experience evidence FOR THIS TENDER, and how the
// Experience Library measures up against it.
//
// Sarel, 2026-10-16: "experience evidence is specific to each tender, need
// to assess each tender what counts as evidence they normally specify in the
// functional requirements." Real tenders disagree on every axis
// (docs/specs/Tender-Evaluation-Engine-Audit.md "Round 2"):
//   SANRAL B6        3 projects / 10 years / CIDB Annex 1 or reference letter, rated
//   Gauteng DRT      completion certificates since 2000, per project (Sched. A);
//                    reference letters + aligned appointment letters (Sched. B)
//   Transnet TPT     5 award letters/POs WITH completion proof, 10 years
//   DPWI EC          3 contactable references, 3 in the last 5 years
//   uMlalazi LM      appointment letters + completion certificates, 6 years
//   TNPA             reference letters / completion certificates, 10 years
//   Dawid Kruiper    3 signed reference letters on letterhead, else non-responsive
// The tender's own rule is read from its text by
// engine/discovery/score_outlook.py extract_experience_evidence() and stored
// in tenders.evaluation_rules (migration 0016). Only when that is absent does
// this fall back to SANRAL's B6 pattern - and then says plainly it's an
// assumption, not the tender's stated rule.

import type { ComplianceStatus } from "./tenderCompliance";

export type EvidenceCode = "performance_report" | "reference_letter" | "completion_certificate" | "award_letter" | "affidavit";

export type EvidenceRule = {
  projects_required: number | null;
  scored_per_project: boolean;
  window_years: number | null;
  since_year: number | null;
  accepted_evidence: EvidenceCode[];
  requires_appointment_and_completion: boolean;
  practical_completion_excluded: boolean;
  scope: string | null;
  consequence: "points" | "disqualify" | "zero_points" | null;
  disqualification_mentioned?: boolean;
  quote: string;
};

export type EvaluationRules = {
  experience_evidence?: { source: "tender_document" | "not_found"; rules: EvidenceRule[]; reason?: string } | null;
  locality?: { rows: import("./locality").LocalityRow[]; mandatory_local_office: { area: string; disqualifies: boolean; quote: string } | null } | null;
  source_document?: string;
  extracted_at?: string;
};

/** SANRAL Form B6 as Book 1 states it - used ONLY as a labelled fallback. */
export const SANRAL_B6_ASSUMED_RULE: EvidenceRule = {
  projects_required: 3,
  scored_per_project: false,
  window_years: 10,
  since_year: null,
  accepted_evidence: ["performance_report", "reference_letter"],
  requires_appointment_and_completion: false,
  practical_completion_excluded: false,
  scope: "similar scope",
  consequence: "points",
  quote: "Past Performance reports must be submitted by the tenderer for any 3 (three) completed projects of similar scope in the last 10 (ten) years (SANRAL Book 1, R.396-010-2025/1F)",
};

export type ChosenRule = { rule: EvidenceRule; source: "tender_document" | "assumed"; otherRules: number };

/**
 * The rule to check this tender against: its own (first stated) rule when
 * read, else the SANRAL B6 assumption. When a tender states several (DRT has
 * one per schedule), the first is used and the count of others is reported.
 */
export function chooseEvidenceRule(rules: EvaluationRules | null): ChosenRule {
  const own = rules?.experience_evidence?.rules ?? [];
  if (own.length > 0) return { rule: own[0], source: "tender_document", otherRules: own.length - 1 };
  return { rule: SANRAL_B6_ASSUMED_RULE, source: "assumed", otherRules: 0 };
}

const EVIDENCE_LABEL: Record<string, string> = {
  performance_report: "CIDB performance reports",
  reference_letter: "reference letters",
  completion_certificate: "completion certificates",
  award_letter: "award/appointment letters or POs",
  affidavit: "an affidavit (fallback)",
};

export function describeRule(r: EvidenceRule): string {
  const parts: string[] = [];
  if (r.projects_required) parts.push(r.scored_per_project ? `scored per project, full points at ${r.projects_required}` : `${r.projects_required} project(s)`);
  if (r.window_years) parts.push(`in the last ${r.window_years} years`);
  if (r.since_year) parts.push(`since ${r.since_year}`);
  const ev = r.accepted_evidence.map((e) => EVIDENCE_LABEL[e] ?? e);
  if (ev.length) parts.push(`proof: ${ev.join(" / ")}`);
  if (r.requires_appointment_and_completion) parts.push("appointment AND completion proof per project");
  if (r.practical_completion_excluded) parts.push("practical completion certificates not accepted");
  if (r.consequence === "disqualify") parts.push("non-responsive without it");
  if (r.consequence === "zero_points") parts.push("0 points without it");
  return parts.join(", ");
}

// experience_items.document_type values (0012) that satisfy each evidence code.
const DOC_TYPES_FOR: Record<EvidenceCode, string[]> = {
  performance_report: ["performance_report"],
  reference_letter: ["reference_letter"],
  completion_certificate: ["completion_certificate", "closeout_report"],
  award_letter: ["award_letter"],
  affidavit: [],
};

export function acceptedDocTypes(rule: EvidenceRule): Set<string> {
  const types = new Set<string>();
  for (const e of rule.accepted_evidence) for (const t of DOC_TYPES_FOR[e] ?? []) types.add(t);
  // When appointment AND completion proof are both required, an award letter
  // alone proves nothing - the completion document is the one that counts.
  if (rule.requires_appointment_and_completion) types.delete("award_letter");
  return types;
}

type ExperienceLite = { document_type: string; performance_rating: string | null; completion_date: string | null };

export type EvidenceEvaluation = {
  status: ComplianceStatus;
  label: string;
  detail: string;
  qualifying: number;
};

/**
 * items: tagged Experience Library rows already filtered to the rule's
 * window (findMatchingExperience with completedWithinYears = window_years).
 * ratingsMatter: SANRAL B6 scores each letter by its rating, so unrated
 * letters leave the score uncertain.
 */
export function evaluateEvidence(chosen: ChosenRule, items: ExperienceLite[], ratingsMatter: boolean): EvidenceEvaluation {
  const { rule, source } = chosen;
  const accepted = acceptedDocTypes(rule);
  const inSince = (i: ExperienceLite) => !rule.since_year || (!!i.completion_date && Number(i.completion_date.slice(0, 4)) >= rule.since_year);
  const qualifyingItems = items.filter((i) => accepted.has(i.document_type) && inSince(i));
  const n = qualifyingItems.length;
  const rated = qualifyingItems.filter((i) => !!i.performance_rating).length;
  const need = rule.projects_required;
  const otherEvidence = items.filter((i) => !accepted.has(i.document_type)).length;

  const ruleText = describeRule(rule);
  const prefix =
    source === "tender_document"
      ? `This tender's own rule: ${ruleText}.${chosen.otherRules > 0 ? ` (The document states ${chosen.otherRules} more experience rule(s) - e.g. per schedule - check which applies.)` : ""}`
      : `ASSUMED - this tender's own evidence rule hasn't been read from its document yet, so SANRAL's Form B6 pattern is used: ${ruleText}. Read the tender's functionality criteria to confirm.`;
  const label = `Company experience evidence${need ? ` (${need} project${need === 1 ? "" : "s"}${rule.window_years ? `, ${rule.window_years} years` : ""})` : ""}`;

  let status: ComplianceStatus;
  let body: string;
  if (need === null) {
    status = n > 0 ? "check" : "missing";
    body = `${n} qualifying item(s) in the Experience Library; the tender doesn't state a count - check how many it scores.`;
  } else if (n >= need) {
    if (rule.requires_appointment_and_completion) {
      status = "check";
      body = `${n} item(s) with completion proof. This tender also wants the matching appointment/award letter for each project - confirm both are on file for every one.`;
    } else if (ratingsMatter && rated < need) {
      status = "check";
      body = `${n} qualifying item(s), ${rated} with a rating tagged - tag the ratings so the score estimate can use them.`;
    } else {
      status = "have";
      body = `${n} qualifying item(s) - enough.`;
    }
  } else {
    status = "missing";
    body =
      `Only ${n} of ${need} qualifying item(s)` +
      (otherEvidence > 0 ? ` (${otherEvidence} more tagged project(s) have evidence this tender doesn't accept)` : "") +
      "." +
      (rule.scored_per_project ? " Scored per project, so each one added earns points." : "") +
      (rule.consequence === "disqualify" ? " The tender is non-responsive without it." : "") +
      (source === "assumed" || rule.accepted_evidence.includes("affidavit") ? " SANRAL's B6 sworn affidavit covers the gap at 'Adequate'." : "");
  }
  return { status, label, detail: `${prefix} ${body}`, qualifying: n };
}
