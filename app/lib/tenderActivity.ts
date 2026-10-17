// Tender Workspace activity log: one chronological "who did what, when" feed
// for a tender, built from rows the app already writes (feature list item
// 15's "version history"; see migration 0033's header for why this is a read
// of existing columns and not a new versioning system).
//
// Pure on purpose - the Tender Workspace's activity-log.tsx does the reads,
// this turns rows into entries - so the rules below are checkable without a
// database.
//
// What it can and can't say, stated plainly because a log that over-claims
// is worse than none:
// - tender_tasks, tender_packs and tender_documents hold their CURRENT state
//   plus one timestamp. A task's status/assignee change or a pipeline-stage
//   move shows only the latest one (the earlier ones were overwritten), and
//   neither records who made it - those entries carry no actor.
// - A replaced template keeps only its newest upload.
// Everything else (notes, task creation, pack/CV requests and their results,
// answers, key-position confirmation) has both a time and, where a person
// did it, who.

import { STAGE_META, isPipelineStage } from "./pipeline";
import { TENDER_TEMPLATES, isTenderTemplateType } from "./tenderTemplates";

export type ActivityActor =
  | { kind: "user"; userId: string | null } // null = a removed user
  | { kind: "system" } // the Tender Tool itself (bridge worker, auto-seed)
  | { kind: "other_company" }; // a shared tender's template, uploaded by another company

export type ActivityCategory = "note" | "task" | "stage" | "positions" | "template" | "pack" | "cv" | "answers" | "tender" | "update";

export type ActivityEntry = {
  key: string;
  at: string;
  // null = no person to name: not recorded (see the header), or an outcome
  // rather than an action (a pack finishing). Shown without a name.
  actor: ActivityActor | null;
  category: ActivityCategory;
  text: string;
  detail?: string | null;
  // Notes only.
  commentId?: string;
  body?: string;
};

export type ActivityInput = {
  companyId: string;
  tender: { created_at: string | null; owner_company_id: string | null } | null;
  comments: { id: string; author_id: string | null; body: string; created_at: string }[];
  tasks: {
    id: string;
    description: string;
    status: string;
    kind: string | null;
    is_standard: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    assignee_name: string | null;
  }[];
  pack: {
    created_at: string;
    confirmed_by: string | null;
    confirmed_at: string | null;
    pipeline_stage: string;
    stage_changed_at: string | null;
    submitted_at: string | null;
  } | null;
  templates: {
    doc_type: string;
    original_filename: string | null;
    uploaded_by: string | null;
    uploaded_by_company: string | null;
    downloaded_at: string;
  }[];
  jobs: {
    id: string;
    engine: string;
    kind: string;
    status: string;
    requested_by: string | null;
    requested_at: string;
    completed_at: string | null;
    page_count: number | null;
    error_message: string | null;
  }[];
  cvs: {
    id: string;
    position_code: string | null;
    person_name: string | null;
    status: string;
    requested_by: string | null;
    requested_at: string;
    completed_at: string | null;
    error_message: string | null;
  }[];
  answers: { field_key: string; original_filename: string | null; answered_by: string | null; updated_at: string }[];
  // Documents the buyer added after discovery (0039, tender_watched_documents,
  // non-baseline). Optional so callers built before 0039 still type-check.
  updates?: { id: string; title: string | null; source: string; first_seen_at: string; summary: string | null }[];
};

// A row whose updated_at/stage_changed_at is within this of its created_at
// was not changed after creation (same statement, or the insert trigger).
const SAME_MOMENT_MS = 5_000;

const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}

function laterThan(a: string | null, b: string | null): boolean {
  const x = ms(a);
  const y = ms(b);
  return !Number.isNaN(x) && !Number.isNaN(y) && x - y > SAME_MOMENT_MS;
}

function clip(text: string | null, max = 160): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function humanizeKey(key: string): string {
  return key
    .replace(/^upload:/, "")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function user(userId: string | null): ActivityActor {
  return { kind: "user", userId };
}

const SYSTEM: ActivityActor = { kind: "system" };

export function buildTenderActivity(input: ActivityInput): ActivityEntry[] {
  const out: ActivityEntry[] = [];

  for (const c of input.comments) {
    out.push({ key: `note:${c.id}`, at: c.created_at, actor: user(c.author_id), category: "note", text: "Left a note", commentId: c.id, body: c.body });
  }

  if (input.tender?.owner_company_id && input.tender.owner_company_id === input.companyId && input.tender.created_at) {
    out.push({ key: "tender:loaded", at: input.tender.created_at, actor: null, category: "tender", text: "Tender loaded with its own documents" });
  }

  for (const t of input.tasks) {
    const auto = t.is_standard && !t.created_by;
    out.push({
      key: `task:${t.id}:created`,
      at: t.created_at,
      actor: auto ? null : user(t.created_by),
      category: "task",
      text: auto ? `Milestone added automatically: “${t.description}”` : `Added task “${t.description}”`,
    });
    if (laterThan(t.updated_at, t.created_at)) {
      const status = TASK_STATUS_LABEL[t.status] ?? t.status;
      out.push({
        key: `task:${t.id}:updated`,
        at: t.updated_at,
        actor: null,
        category: "task",
        text: `Task “${t.description}” updated`,
        detail: `Now ${status.toLowerCase()}${t.assignee_name ? `, assigned to ${t.assignee_name}` : ", unassigned"} (latest change only)`,
      });
    }
  }

  const pack = input.pack;
  if (pack) {
    const stage = isPipelineStage(pack.pipeline_stage) ? STAGE_META[pack.pipeline_stage].label : pack.pipeline_stage;
    // The pipeline board's first move inserts the pack row already at its
    // new stage (stage_changed_at = created_at): one entry, not two.
    const movedLater = pack.pipeline_stage !== "found" && laterThan(pack.stage_changed_at, pack.created_at);
    out.push({
      key: "pack:created",
      at: pack.created_at,
      actor: null,
      category: "stage",
      text: pack.pipeline_stage === "found" || movedLater ? "Started working on this tender" : `Started working on this tender, at ${stage}`,
    });
    if (pack.submitted_at && laterThan(pack.stage_changed_at, pack.submitted_at) && laterThan(pack.submitted_at, pack.created_at)) {
      out.push({ key: "pack:submitted", at: pack.submitted_at, actor: null, category: "stage", text: "Pipeline stage moved to Submitted" });
    }
    if (movedLater && pack.stage_changed_at) {
      out.push({ key: "pack:stage", at: pack.stage_changed_at, actor: null, category: "stage", text: `Pipeline stage moved to ${stage}`, detail: "Latest move only" });
    }
    if (pack.confirmed_at) {
      out.push({ key: "pack:confirmed", at: pack.confirmed_at, actor: user(pack.confirmed_by), category: "positions", text: "Confirmed a person for every key position" });
    }
  }

  for (const d of input.templates) {
    const label = isTenderTemplateType(d.doc_type) ? TENDER_TEMPLATES[d.doc_type].label : d.doc_type;
    const actor: ActivityActor | null = !d.uploaded_by
      ? null
      : d.uploaded_by_company && d.uploaded_by_company !== input.companyId
        ? { kind: "other_company" }
        : user(d.uploaded_by);
    out.push({
      key: `template:${d.doc_type}`,
      at: d.downloaded_at,
      actor,
      category: "template",
      text: d.uploaded_by ? `Uploaded the ${label}` : `${label} downloaded from the buyer`,
      detail: d.original_filename ? `${d.original_filename}${d.uploaded_by ? " (newest upload only)" : ""}` : null,
    });
  }

  for (const j of input.jobs) {
    const isRead = j.kind === "extract_requirements";
    const what = isRead ? "the tender's documents to be read" : j.engine === "sanral" ? "the submission pack" : "the tender pack";
    out.push({ key: `job:${j.id}:requested`, at: j.requested_at, actor: j.requested_by ? user(j.requested_by) : SYSTEM, category: "pack", text: `Asked for ${what}` });
    if (j.completed_at && (j.status === "ready" || j.status === "failed")) {
      const noun = isRead ? "Tender documents read" : j.engine === "sanral" ? "Submission pack ready" : "Tender pack ready";
      out.push({
        key: `job:${j.id}:done`,
        at: j.completed_at,
        actor: null,
        category: "pack",
        text: j.status === "ready" ? noun : isRead ? "Reading the tender's documents failed" : "Pack generation failed",
        detail: j.status === "failed" ? clip(j.error_message) : j.page_count ? `${j.page_count} pages` : null,
      });
    }
  }

  for (const cv of input.cvs) {
    const forWhom = [cv.position_code, cv.person_name].filter(Boolean).join(" - ");
    out.push({ key: `cv:${cv.id}:requested`, at: cv.requested_at, actor: user(cv.requested_by), category: "cv", text: `Asked for a tender-specific CV${forWhom ? ` (${forWhom})` : ""}` });
    if (cv.completed_at && (cv.status === "ready" || cv.status === "failed")) {
      out.push({
        key: `cv:${cv.id}:done`,
        at: cv.completed_at,
        actor: null,
        category: "cv",
        text: cv.status === "ready" ? `Tender-specific CV ready${forWhom ? ` (${forWhom})` : ""}` : `Tender-specific CV failed${forWhom ? ` (${forWhom})` : ""}`,
        detail: cv.status === "failed" ? clip(cv.error_message) : null,
      });
    }
  }

  // One "Save answers" press upserts every answer in one statement, so rows
  // with the same person and the same minute are one entry, not twenty.
  const groups = new Map<string, { at: string; by: string | null; count: number }>();
  for (const a of input.answers) {
    if (a.field_key.startsWith("upload:")) {
      out.push({
        key: `answer:${a.field_key}`,
        at: a.updated_at,
        actor: user(a.answered_by),
        category: "answers",
        text: `Attached a document for “${humanizeKey(a.field_key)}”`,
        detail: a.original_filename,
      });
      continue;
    }
    const minute = a.updated_at.slice(0, 16);
    const gk = `${a.answered_by ?? "-"}@${minute}`;
    const g = groups.get(gk);
    if (g) {
      g.count += 1;
      if (ms(a.updated_at) > ms(g.at)) g.at = a.updated_at;
    } else {
      groups.set(gk, { at: a.updated_at, by: a.answered_by, count: 1 });
    }
  }
  for (const [gk, g] of groups) {
    out.push({
      key: `answers:${gk}`,
      at: g.at,
      actor: user(g.by),
      category: "answers",
      text: `Saved ${g.count} answer${g.count === 1 ? "" : "s"} to this tender's questions`,
      detail: "Latest save only",
    });
  }

  for (const u of input.updates ?? []) {
    out.push({
      key: `update:${u.id}`,
      at: u.first_seen_at,
      actor: SYSTEM,
      category: "update",
      text: `Found a new document on ${u.source === "sanral_page" ? "SANRAL's tender page" : "eTenders"}: “${u.title ?? "untitled"}”`,
      detail: clip(u.summary),
    });
  }

  return out
    .filter((e) => !Number.isNaN(ms(e.at)))
    .sort((a, b) => ms(b.at) - ms(a.at) || a.key.localeCompare(b.key));
}

// South African time (UTC+2, no DST - same convention as dates.ts
// closingDayOf), so a note left at 09:00 doesn't read 07:00 on a server
// running in UTC.
const SAST = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatActivityTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : SAST.format(d);
}
