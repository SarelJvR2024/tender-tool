import type { SupabaseClient } from "@supabase/supabase-js";
import { GENERAL_FAMILY, UPLOAD_PREFIX, type ManifestQuestion, type RequirementManifest } from "@/lib/generalTender";

// Feature item 9, "Reuse of past submissions: copy a previous pack as the
// starting point" - scoped to what is genuinely re-typed per tender today.
//
// What a new tender already gets for free (nothing to copy): the vault
// documents (companies.*_path, 0014), the experience library
// (experience_items, 0012), people/CVs and role tags (0008/0016), and the
// SBD 1 company facts the general workspace saves to the company row
// (telephone, cellphone, e-mail, CIDB grading - saveGeneralAnswers()). The
// compliance report (compliance-data.ts) and both pack engines read all of
// those by company_id, never by tender.
//
// What IS re-entered per tender, and so is all this copies:
//   1. tender_answers (0018) - the "questions only you can answer" on the
//      general flow. Only the keys below marked reusable, only where the NEW
//      tender's own manifest asks the question, and never over an answer the
//      new tender already has.
//   2. Confirmed key-position people (tender_pack_assignments, SANRAL) -
//      only where the new tender's SETUP sheet lists the same position code
//      with the same description (DS1 is "Pavement and Materials" on one
//      tender and "Structures" on another), the person is still on file,
//      and the position isn't confirmed yet.
//
// Never copied: price, briefing attendance, JV structure, specific-goal
// points, per-tender uploads (their storage path is tender-scoped by 0018's
// check constraint), the filled forms or the pack itself (regenerated from
// the new tender's own documents), closing date / tasks.

export type ReuseRule = "company_fact" | "same_buyer" | "this_tender_only";

/**
 * Every question key requirements.py QUESTIONS can ask. A key missing from
 * this table is treated as this_tender_only, so a question added to the
 * engine later is never copied until someone decides it's safe.
 */
export const ANSWER_REUSE: Record<string, { label: string; rule: ReuseRule; why: string }> = {
  signatory_person_id: { label: "Who signs the bid", rule: "company_fact", why: "Same company signatory." },
  "sbd1.foreign_based": { label: "Foreign-based supplier (SBD 1)", rule: "company_fact", why: "A fact about the company." },
  "sbd1.accredited_representative": { label: "Accredited representative (SBD 1)", rule: "company_fact", why: "Usually the same for a company's line of work - check it if this tender buys something different." },
  "sbd4.employed_by_state": { label: "Employed by the state (SBD 4)", rule: "company_fact", why: "About the company's directors and shareholders, not the buyer." },
  "sbd8.restricted_supplier": { label: "Restricted supplier (SBD 8)", rule: "company_fact", why: "About the company's record, not the buyer." },
  "sbd8.tender_defaulter": { label: "Tender defaulter (SBD 8)", rule: "company_fact", why: "About the company's record, not the buyer." },
  "sbd8.convicted": { label: "Fraud or corruption conviction (SBD 8)", rule: "company_fact", why: "About the company's record, not the buyer." },
  "sbd8.contract_terminated": { label: "Contract terminated (SBD 8)", rule: "company_fact", why: "About the company's record, not the buyer." },
  "sbd4.relationship_with_employee": { label: "Relationship with a buyer employee (SBD 4)", rule: "same_buyer", why: "About employees of this buyer - only carried over from a tender for the same buyer." },
  total_bid_price: { label: "Total bid price", rule: "this_tender_only", why: "Price is set per tender." },
  "sbd4.interest_in_related_enterprise": { label: "Interest in a related enterprise bidding (SBD 4)", rule: "this_tender_only", why: "About who else is bidding for this contract." },
  "sbd6_1.points_claimed": { label: "Specific-goal points claimed (SBD 6.1)", rule: "this_tender_only", why: "Each buyer sets its own specific-goal table." },
  bidding_as_jv: { label: "Bidding as a joint venture", rule: "this_tender_only", why: "Bid structure is decided per tender." },
  briefing_attended: { label: "Compulsory briefing attended", rule: "this_tender_only", why: "A briefing belongs to one tender." },
};

export function reuseRuleFor(key: string) {
  return ANSWER_REUSE[key] ?? { label: key, rule: "this_tender_only" as const, why: "Not marked as safe to carry over." };
}

/** SANRAL tenders carry no buyer text; both pack families are SANRAL's. */
export const SANRAL_PACK_FAMILIES = ["Conventional Consultant Tender", "RRM Consultant Tender"];

export type FlowKind = "general" | "sanral";
export function flowOf(family: string | null): FlowKind | null {
  if (family === GENERAL_FAMILY) return "general";
  if (family && SANRAL_PACK_FAMILIES.includes(family)) return "sanral";
  return null;
}

function normBuyer(b: string | null | undefined, flow: FlowKind | null) {
  if (flow === "sanral") return "sanral";
  const s = (b ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return s || null;
}

function normDesc(d: string | null | undefined) {
  return (d ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type AnswerCopy = { key: string; label: string; value: string; why: string };
export type Skipped = { key: string; label: string; reason: string };

/** Pure: which of the source tender's answers go onto the target tender. */
export function planAnswerReuse(args: {
  sourceAnswers: { field_key: string; value: string | null; storage_path: string | null }[];
  targetQuestions: ManifestQuestion[];
  targetAnsweredKeys: Set<string>;
  sameBuyer: boolean;
  personIds: Set<string>;
}): { copy: AnswerCopy[]; skip: Skipped[] } {
  const asked = new Map(args.targetQuestions.map((q) => [q.key, q]));
  const copy: AnswerCopy[] = [];
  const skip: Skipped[] = [];
  for (const a of args.sourceAnswers) {
    if (a.field_key.startsWith(UPLOAD_PREFIX) || a.storage_path) {
      skip.push({ key: a.field_key, label: `Uploaded for that tender: ${a.field_key.slice(UPLOAD_PREFIX.length)}`, reason: "Documents uploaded for one tender stay with it - upload again, or keep it in the vault." });
      continue;
    }
    if (a.value === null || a.value === "") continue;
    const q = asked.get(a.field_key);
    const rule = reuseRuleFor(a.field_key);
    const label = q?.label ?? rule.label;
    if (rule.rule === "this_tender_only") { skip.push({ key: a.field_key, label, reason: rule.why }); continue; }
    if (!q) { skip.push({ key: a.field_key, label, reason: "This tender's forms don't ask it." }); continue; }
    if (args.targetAnsweredKeys.has(a.field_key)) { skip.push({ key: a.field_key, label, reason: "Already answered on this tender - left as it is." }); continue; }
    if (rule.rule === "same_buyer" && !args.sameBuyer) { skip.push({ key: a.field_key, label, reason: rule.why }); continue; }
    if (q.type === "person" && !args.personIds.has(a.value)) { skip.push({ key: a.field_key, label, reason: "That person is no longer on the People page." }); continue; }
    if (q.type === "yes_no" && a.value !== "yes" && a.value !== "no") continue;
    copy.push({ key: a.field_key, label, value: a.value, why: rule.why });
  }
  return { copy, skip };
}

export type PositionCopy = { code: string; description: string | null; personId: string };

/** Pure: which confirmed key-position people carry over. */
export function planPositionReuse(args: {
  sourcePositions: { position_code: string; position_description: string | null }[];
  sourceConfirmed: { position_code: string; confirmed_person_id: string | null }[];
  targetPositions: { position_code: string; position_description: string | null }[];
  targetConfirmedCodes: Set<string>;
  personIds: Set<string>;
}): { copy: PositionCopy[]; skip: Skipped[] } {
  const srcDesc = new Map(args.sourcePositions.map((p) => [p.position_code, p.position_description]));
  const target = new Map(args.targetPositions.map((p) => [p.position_code, p.position_description]));
  const copy: PositionCopy[] = [];
  const skip: Skipped[] = [];
  for (const s of args.sourceConfirmed) {
    if (!s.confirmed_person_id) continue;
    const code = s.position_code;
    if (!target.has(code)) { skip.push({ key: code, label: code, reason: "This tender doesn't list this position." }); continue; }
    const from = normDesc(srcDesc.get(code));
    const to = normDesc(target.get(code));
    if (!from || !to) { skip.push({ key: code, label: code, reason: "Can't tell it's the same role - a position description is missing." }); continue; }
    if (from !== to) { skip.push({ key: code, label: code, reason: `A different role on this tender (${target.get(code)}).` }); continue; }
    if (args.targetConfirmedCodes.has(code)) { skip.push({ key: code, label: code, reason: "Already confirmed on this tender - left as it is." }); continue; }
    if (!args.personIds.has(s.confirmed_person_id)) { skip.push({ key: code, label: code, reason: "That person is no longer on the People page." }); continue; }
    copy.push({ code, description: target.get(code) ?? null, personId: s.confirmed_person_id });
  }
  return { copy, skip };
}

export type PastTender = {
  tender_id: string;
  contract_no: string | null;
  title: string;
  buyer: string | null;
  stage: string;
  submitted_at: string | null;
  sameBuyer: boolean;
};

const DONE_STAGES = ["submitted", "won", "lost"];

type TenderRow = { id: string; contract_no: string | null; title: string | null; description: string | null; buyer: string | null; family: string | null; document_requirements?: RequirementManifest | null };

/**
 * This company's tenders that went in (submitted / won / lost on the
 * pipeline board, 0021) and use the same flow as the target, same buyer
 * first, then most recently submitted. RLS scopes tender_packs to the company.
 */
export async function listPastSubmissions(supabase: SupabaseClient, target: TenderRow): Promise<PastTender[]> {
  const flow = flowOf(target.family);
  if (!flow) return [];
  const { data } = await supabase
    .from("tender_packs")
    .select("tender_id, pipeline_stage, submitted_at, tenders(id, contract_no, title, description, buyer, family)")
    .in("pipeline_stage", DONE_STAGES)
    .neq("tender_id", target.id);
  const targetBuyer = normBuyer(target.buyer, flow);
  const rows = ((data ?? []) as unknown as { tender_id: string; pipeline_stage: string; submitted_at: string | null; tenders: TenderRow | null }[])
    .filter((r) => r.tenders && flowOf(r.tenders.family) === flow)
    .map((r) => ({
      tender_id: r.tender_id,
      contract_no: r.tenders!.contract_no,
      title: r.tenders!.title ?? r.tenders!.description ?? "Untitled tender",
      buyer: flow === "sanral" ? "SANRAL" : r.tenders!.buyer,
      stage: r.pipeline_stage,
      submitted_at: r.submitted_at,
      sameBuyer: !!targetBuyer && normBuyer(r.tenders!.buyer, flow) === targetBuyer,
    }));
  rows.sort((a, b) => Number(b.sameBuyer) - Number(a.sameBuyer) || (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
  return rows;
}

export type ReusePlan = {
  source: PastTender;
  flow: FlowKind;
  answers: { copy: AnswerCopy[]; skip: Skipped[] };
  positions: { copy: PositionCopy[]; skip: Skipped[] };
  targetPackId: string | null;
  /** Why a whole part can't be copied yet (e.g. this tender's documents not read). */
  notes: string[];
};

/**
 * Builds the plan from the database. Used both to show the preview and,
 * again from scratch, by the apply action - the browser only ever sends the
 * two tender ids.
 */
export async function buildReusePlan(supabase: SupabaseClient, targetTenderId: string, sourceTenderId: string): Promise<ReusePlan | null> {
  const { data: t } = await supabase
    .from("tenders")
    .select("id, contract_no, title, description, buyer, family, document_requirements")
    .eq("id", targetTenderId)
    .maybeSingle();
  if (!t) return null;
  const target = t as TenderRow;
  const flow = flowOf(target.family);
  if (!flow) return null;
  const source = (await listPastSubmissions(supabase, target)).find((p) => p.tender_id === sourceTenderId);
  if (!source) return null;

  const [{ data: people }, { data: packs }] = await Promise.all([
    supabase.from("people").select("id"),
    supabase.from("tender_packs").select("id, tender_id").in("tender_id", [targetTenderId, sourceTenderId]),
  ]);
  const personIds = new Set(((people ?? []) as { id: string }[]).map((p) => p.id));
  const packOf = new Map(((packs ?? []) as { id: string; tender_id: string }[]).map((p) => [p.tender_id, p.id]));
  const targetPackId = packOf.get(targetTenderId) ?? null;
  const sourcePackId = packOf.get(sourceTenderId) ?? null;
  const notes: string[] = [];

  let answers: ReusePlan["answers"] = { copy: [], skip: [] };
  if (flow === "general") {
    const manifest = target.document_requirements ?? null;
    const [{ data: src }, { data: mine }] = await Promise.all([
      supabase.from("tender_answers").select("field_key, value, storage_path").eq("tender_id", sourceTenderId),
      supabase.from("tender_answers").select("field_key, value").eq("tender_id", targetTenderId),
    ]);
    if (!manifest) {
      notes.push("This tender's documents haven't been read yet, so it isn't known which questions its forms ask. Come back once the needs list is shown.");
    } else {
      answers = planAnswerReuse({
        sourceAnswers: (src ?? []) as { field_key: string; value: string | null; storage_path: string | null }[],
        targetQuestions: manifest.questions,
        targetAnsweredKeys: new Set(((mine ?? []) as { field_key: string; value: string | null }[]).filter((a) => a.value).map((a) => a.field_key)),
        sameBuyer: source.sameBuyer,
        personIds,
      });
    }
  }

  let positions: ReusePlan["positions"] = { copy: [], skip: [] };
  if (flow === "sanral" && sourcePackId) {
    const [{ data: srcReq }, { data: tgtReq }, { data: srcAsg }, { data: tgtAsg }] = await Promise.all([
      supabase.from("tender_requirements").select("position_code, position_description").eq("tender_id", sourceTenderId).eq("is_alternate", false),
      supabase.from("tender_requirements").select("position_code, position_description").eq("tender_id", targetTenderId).eq("is_alternate", false),
      supabase.from("tender_pack_assignments").select("position_code, confirmed_person_id").eq("tender_pack_id", sourcePackId),
      targetPackId
        ? supabase.from("tender_pack_assignments").select("position_code, confirmed_person_id").eq("tender_pack_id", targetPackId)
        : Promise.resolve({ data: [] }),
    ]);
    const targetPositions = (tgtReq ?? []) as { position_code: string; position_description: string | null }[];
    if (!targetPackId) notes.push("Start a pack for this tender first - key positions hang off it.");
    else if (targetPositions.length === 0) notes.push("This tender's key positions aren't known yet: they're read from its Technical workbook once it's uploaded under Blank tender templates.");
    else {
      positions = planPositionReuse({
        sourcePositions: (srcReq ?? []) as { position_code: string; position_description: string | null }[],
        sourceConfirmed: (srcAsg ?? []) as { position_code: string; confirmed_person_id: string | null }[],
        targetPositions,
        targetConfirmedCodes: new Set(((tgtAsg ?? []) as { position_code: string; confirmed_person_id: string | null }[]).filter((a) => a.confirmed_person_id).map((a) => a.position_code)),
        personIds,
      });
    }
  }

  return { source, flow, answers, positions, targetPackId, notes };
}
