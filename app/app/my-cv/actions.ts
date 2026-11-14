"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { safeFileName } from "@/lib/safeFileName";
import { queueStandardCvs } from "@/lib/standardCvQueue";
import { ECSA_LEVELS, EXTRACTED_PERSON_FIELDS, ISO_DATE, QUALIFICATION_LEVELS } from "@/lib/cvExtraction";
import { isValidSaId } from "@/lib/principals";

/**
 * Self-service actions for the My CV page (0065: employee role). Every
 * action here resolves the signed-in user's OWN linked person id server-side
 * (people.linked_user_id = auth.uid()) - it is never taken from a form
 * field, so nothing a client sends can point one of these writes at someone
 * else's record. RLS (0065's "employee restricted to own person" RESTRICTIVE
 * policies) enforces the same boundary underneath this for any role, so this
 * is belt-and-suspenders, not the only check - but it's also what lets a
 * 'member'/'owner'/'admin' who happens to be linked to a person use this
 * same simple page for their own CV without the restriction applying to
 * them at all (they're not 'employee', so the RLS check is a no-op; this
 * function still only ever touches their own linked row).
 */
const BACK = "/my-cv";

function fail(message: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(message)}`);
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

async function requireOwnPerson() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/my-cv");

  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new Error("Couldn't verify your company - try again.");
  if (!membership) redirect("/onboarding");

  const { data: person } = await supabase
    .from("people")
    .select("id")
    .eq("company_id", membership.company_id)
    .eq("linked_user_id", user.id)
    .maybeSingle();
  if (!person) fail("No roster record is linked to your account yet - ask an owner or admin to link one.");

  return { supabase, userId: user.id, companyId: membership.company_id as string, personId: person.id as string };
}

/** A deliberately small set of self-editable identity/qualification fields. */
export async function saveMyDetails(formData: FormData) {
  const { supabase, personId } = await requireOwnPerson();

  // Finding 467: ecsa_level/highest_level must be one of SANRAL's own fixed
  // Form B2.1 option lists (lib/cvExtraction.ts's ECSA_LEVELS/QUALIFICATION_LEVELS)
  // - the same check applyMyCvExtraction() below already runs on these exact
  // two fields (Finding 432), and the same one people/[id]/page.tsx's own
  // manual "edit this person" form now enforces client-side (Finding 466).
  // This is that same manual-edit form's self-service twin - a separate
  // "My details" card on this page, submitted here, not through
  // applyMyCvExtraction() - and it had no such check at all: the page itself
  // still rendered these two as plain free-text <input>s (see page.tsx), so
  // nothing stopped an arbitrary string reaching people.ecsa_level/
  // highest_level here, only for engine/fill_conventional.py's
  // set_dropdown_for() to refuse it outright with a FieldError once a real
  // pack is generated from this exact self-service record.
  const ecsaLevel = str(formData, "ecsa_level");
  if (ecsaLevel && !(ECSA_LEVELS as readonly string[]).includes(ecsaLevel)) {
    fail("ECSA level: choose one of SANRAL's options.");
  }
  const highestLevel = str(formData, "highest_level");
  if (highestLevel && !(QUALIFICATION_LEVELS as readonly string[]).includes(highestLevel)) {
    fail("Highest qualification level: choose one of SANRAL's options.");
  }

  // Finding 482: this form also submits highest_graduated (rendered as a
  // type="date" <input> at my-cv/page.tsx) with NO server-side format check
  // at all, the same unguarded shape Finding 481 just fixed on this
  // column's primary-form twin, savePerson() (app/app/people/actions.ts),
  // and the one this form's own sibling card - applyMyCvExtraction(), via
  // the EXTRACTED_PERSON_FIELDS loop's `f.kind === "date"` branch - already
  // runs for the SAME column. engine/fill_tender.py and
  // engine/fill_conventional.py both call
  // `wb.set_date(T, at(B["highest_date"], base), q["highest_graduated"])`,
  // and sanral_fill.py's set_date() strictly requires `YYYY-MM-DD`,
  // raising ValueError otherwise - so a bad value saved here failed loudly,
  // but only much later, at real pack generation, instead of immediately
  // at data entry. ecsa_date/sacpcmp_date/initial_graduated are NOT part of
  // this manual form at all (only highest_graduated is - see the `row`
  // object below), so there is nothing else of this shape to check here.
  const highestGraduated = str(formData, "highest_graduated");
  if (highestGraduated && !ISO_DATE.test(highestGraduated)) {
    fail(`Date graduated (highest): "${highestGraduated}" isn't a date (yyyy-mm-dd).`);
  }

  const row = {
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    ecsa_level: ecsaLevel,
    ecsa_number: str(formData, "ecsa_number"),
    ecsa_expiry: str(formData, "ecsa_expiry"),
    sacpcmp_number: str(formData, "sacpcmp_number"),
    sacpcmp_expiry: str(formData, "sacpcmp_expiry"),
    highest_level: highestLevel,
    highest_description: str(formData, "highest_description"),
    highest_institution: str(formData, "highest_institution"),
    highest_graduated: highestGraduated,
  };

  // .select("id").maybeSingle() here matters: PostgREST returns a 2xx with
  // `error: null` and zero rows affected when RLS's own "people: employee
  // restricted to own record" RESTRICTIVE policy (0077, using (... or id =
  // own_linked_person_id(company_id)), re-evaluated against the OLD row) no
  // longer matches - e.g. an owner/admin unlinking this person
  // (people.linked_user_id) or removing this user's own company_members row
  // between the My CV page loading and this submit. No destructive
  // consequence here (no file precedes this write), but still a real
  // silent-false-success ("saved" shown when nothing was written) - the same
  // "plain update twin" shape already fixed in company/actions.ts
  // updateCompanyProfile() and people/actions.ts savePerson(), never swept
  // into this self-service file until now (standing review, 2026-11-06).
  const { data: updated, error } = await supabase.from("people").update(row).eq("id", personId).select("id").maybeSingle();
  if (error || !updated) {
    console.error("people update failed (my-cv saveMyDetails)", error);
    fail("Your roster record is no longer linked to your account - refresh and try again.");
  }
  redirect(`${BACK}?saved=details`);
}

/** Same upload flow as app/app/people/actions.ts uploadCv - scoped to self. */
export async function uploadMyCv(formData: FormData) {
  const { supabase, userId, companyId, personId } = await requireOwnPerson();

  const mode = str(formData, "mode");
  const file = formData.get("file") as File | null;
  if (mode !== "as_is" && mode !== "ai_extract") fail("Choose how this CV should be used: as-is or AI-extract.");
  if (!file || file.size === 0) fail("Choose a CV file to upload.");

  const safeName = safeFileName(file.name);
  const storagePath = `${companyId}/people/${personId}/uploads/${randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("cv-documents")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) fail(`Could not upload file: ${uploadError.message}`);

  const { error: insertError } = await supabase.from("cv_uploads").insert({
    company_id: companyId,
    person_id: personId,
    storage_path: storagePath,
    original_filename: file.name,
    mode,
    status: mode === "as_is" ? "uploaded" : "extraction_requested",
    uploaded_by: userId,
  });
  if (insertError) {
    // Finding 422 (same gap as app/app/people/actions.ts's uploadCv() -
    // this function's own header comment says it follows "the same upload
    // flow"): the file above already made it into cv-documents - clean it
    // up rather than orphaning it when the row that was supposed to record
    // it never gets written.
    await supabase.storage.from("cv-documents").remove([storagePath]);
    fail(insertError.message);
  }
  redirect(`${BACK}?saved=cv`);
}

/**
 * Confirm or correct an AI-extracted CV, same shape as
 * app/app/people/actions.ts applyCvExtraction but scoped to self and with
 * no project-adding step (kept deliberately small for this page - projects
 * stay something an owner/admin/member adds on the full People page).
 *
 * Also queues the same four standard (non-tender-specific) CV formats
 * applyCvExtraction() does, via the now-shared queueStandardCvs()
 * (app/lib/standardCvQueue.ts) - found missing here entirely (standing
 * solution-architect review, 2026-11-07): this function is the ONLY way an
 * employee using My CV self-service ever confirms their own extracted
 * fields, and apply_my_cv_extraction_checked()/apply_cv_extraction_checked()
 * both require review_status to still be 'pending_review', so once this
 * ran without queuing anything, nobody - not even an owner on the full
 * People page - could ever trigger it for that extraction again.
 *
 * Standing solution-architect review, 2026-11-11 (Finding 431): this
 * function's own `fields` list used to be a hand-typed subset of ten keys
 * (present since this file's first commit, eb5a846f) instead of the
 * canonical app/lib/cvExtraction.ts EXTRACTED_PERSON_FIELDS that
 * app/app/people/actions.ts applyCvExtraction() and people/[id]/cv-review.tsx
 * both already use for the full People page's identical review card - never
 * kept in sync with it, so it silently dropped 7 of the 17 real fields
 * extract_cv_fields.py's own PERSON_FIELDS (engine/cv/extract_cv_fields.py)
 * genuinely proposes for every real CV: id_number, role, phone, email,
 * initial_description, initial_institution, initial_graduated. Confirmed
 * live-reachable, not theoretical: my-cv/page.tsx's own review card reused
 * this exact same local list to decide which proposed fields to even show a
 * checkbox for (see that file), so an employee ticking every box this page
 * offered still never persisted those 7 - including initial_graduated, which
 * engine/pack_generator/confirm_pack.py HARD-STOPS pack confirmation on when
 * missing for a key person ("no initial_graduated date on file -
 * years_experience cannot be computed, refusing to guess one"), telling the
 * company to "fix it on the People page" - exactly the manual admin
 * intervention this self-service page exists to avoid. Fixed by importing
 * the one canonical list instead of re-typing a subset of it.
 */
export async function applyMyCvExtraction(formData: FormData) {
  const { supabase, userId, companyId, personId } = await requireOwnPerson();
  const extractionId = str(formData, "extraction_id");
  if (!extractionId) redirect(BACK);

  const { data: row, error: readError } = await supabase
    .from("cv_extraction_results")
    .select("id, person_id, review_status, proposed")
    .eq("id", extractionId)
    .maybeSingle();
  if (readError) fail(readError.message);
  if (!row || row.person_id !== personId) fail("That extraction result wasn't found for you.");
  if (row.review_status !== "pending_review") fail("These extracted fields were already saved or discarded.");

  // Finding 432: this loop used to write whatever was ticked straight
  // through with NO validation at all - not even the three checks its own
  // sibling applyCvExtraction() (app/app/people/actions.ts) already runs on
  // the exact same canonical EXTRACTED_PERSON_FIELDS list (required name,
  // ISO date format, and - crucially - that a "select" field's value is one
  // of SANRAL's own fixed options; this page's own review card renders every
  // field, select ones included, as a plain free-text <input>, so nothing
  // ever constrained what could be typed into ecsa_level/highest_level
  // before this fix). engine/fill_conventional.py "refuses any other label"
  // than the exact ECSA_LEVELS/QUALIFICATION_LEVELS strings when it fills a
  // real pack (lib/cvExtraction.ts's own header comment) - an employee
  // retyping either field here, then confirming, could save a value that
  // later hard-fails that person's own real SANRAL submission. id_number
  // gets the same isValidSaId() gate savePerson() already has (Finding 219)
  // and applyCvExtraction() now also has (Finding 432) - the AI only ever
  // PROPOSES a plausible ID number, but this box is freely editable before
  // ticking "use".
  const personUpdate: Record<string, string | null> = {};
  for (const f of EXTRACTED_PERSON_FIELDS) {
    if (formData.get(`use_${f.key}`) !== "on") continue;
    let v = str(formData, `f_${f.key}`);
    if (f.key === "name" && !v) fail("A ticked name can't be empty.");
    if (v && f.kind === "date" && !ISO_DATE.test(v)) fail(`${f.label}: "${v}" isn't a date (yyyy-mm-dd).`);
    if (v && f.kind === "select" && !(f.options ?? []).includes(v)) fail(`${f.label}: choose one of SANRAL's options.`);
    if (f.key === "id_number") {
      v = v?.replace(/\s+/g, "") ?? null;
      if (v && !isValidSaId(v)) fail("That ID number isn't a valid 13-digit South African ID number.");
    }
    personUpdate[f.key] = v;
  }
  if (Object.keys(personUpdate).length === 0) fail("Nothing was ticked. Tick the fields to save, or discard the extraction.");

  // Was two separate, unlocked writes here (people update, then marking the
  // extraction applied) with the SECOND one never re-checking review_status
  // in its own .eq() chain - a genuine two-concurrent-invocations race
  // (double-click, two tabs on the same pending review card), same shape as
  // app/app/people/actions.ts applyCvExtraction() (0123) and the exact thing
  // this file's own discardMyCvExtraction() already guards against below
  // (standing review, 2026-11-06) - the "apply" twin never got that same
  // guard until now. Moved into one locked SQL transaction
  // (apply_my_cv_extraction_checked, 0123): a second concurrent call for the
  // SAME extraction blocks on the row's own `for update` lock until the
  // first commits, then raises instead of silently re-applying. The zero-
  // rows-matched RLS-revocation race this replaced is still covered - the
  // RPC's own is_company_member() check inside the same lock catches it, as
  // a thrown error instead of a silent zero-row match.
  const { error } = await supabase.rpc("apply_my_cv_extraction_checked", {
    p_extraction_id: extractionId,
    p_person_id: personId,
    p_person_fields: personUpdate,
    p_applied_meta: { person_fields: Object.keys(personUpdate) },
  });
  if (error) {
    console.error("apply_my_cv_extraction_checked rpc failed", error);
    fail(error.message);
  }

  const queueError = await queueStandardCvs(supabase, companyId, personId, userId);
  if (queueError) fail("Fields saved, but your standard CVs could not be queued - try again. If it keeps happening, let us know.");
  redirect(`${BACK}?saved=extracted`);
}

export async function discardMyCvExtraction(formData: FormData) {
  const { supabase, userId, personId } = await requireOwnPerson();
  const extractionId = str(formData, "extraction_id");
  if (!extractionId) redirect(BACK);

  // Same shape as applyMyCvExtraction()'s mark-applied write above - checked
  // only `error` before, so a membership/link revocation mid-request (or
  // the row having moved on from 'pending_review' already) would silently
  // match zero rows while still redirecting as if the discard happened.
  const { data: discarded, error } = await supabase
    .from("cv_extraction_results")
    .update({ review_status: "discarded", reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", extractionId)
    .eq("person_id", personId)
    .eq("review_status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error || !discarded) {
    console.error("cv_extraction_results discard failed (my-cv discardMyCvExtraction)", error);
    fail(error ? error.message : "That extraction result is no longer there to discard - refresh and try again.");
  }
  redirect(BACK);
}
