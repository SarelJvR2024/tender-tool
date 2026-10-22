import { createClient } from "@/lib/supabase/server";
import { buildTenderActivity, formatActivityTime, type ActivityActor, type ActivityCategory, type ActivityInput } from "@/lib/tenderActivity";
import { addTenderComment, deleteTenderComment } from "./comment-actions";

/**
 * "Notes & activity" - feature list item 15's comments + "version history".
 * A plain note box (tender_comments, 0033) above one chronological feed of
 * what has happened on this tender, read from the rows that already record
 * it (app/lib/tenderActivity.ts says which, and what each can't say).
 */

// Newest first; the rest behind "Show all", so a long-running tender doesn't
// add a page of history to an already long workspace.
const FEED_LIMIT = 25;

const CATEGORY_DOT: Record<ActivityCategory, string> = {
  note: "bg-accent",
  task: "bg-foreground",
  stage: "bg-foreground",
  positions: "bg-success",
  template: "bg-muted-foreground",
  pack: "bg-muted-foreground",
  cv: "bg-muted-foreground",
  answers: "bg-muted-foreground",
  tender: "bg-muted-foreground",
  update: "bg-warning",
};

export async function ActivityLog({ tenderId, showAll }: { tenderId: string; showAll: boolean }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership } = user
    ? await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle()
    : { data: null };
  if (!user || !membership) return null;
  const companyId = membership.company_id as string;

  const [tenderRes, commentsRes, tasksRes, packRes, templatesRes, jobsRes, cvsRes, answersRes, labelsRes, updatesRes] = await Promise.all([
    supabase.from("tenders").select("created_at, owner_company_id").eq("id", tenderId).maybeSingle(),
    supabase.from("tender_comments").select("id, author_id, body, created_at").eq("tender_id", tenderId),
    supabase
      .from("tender_tasks")
      .select("id, description, status, kind, is_standard, created_by, created_at, updated_at, people:assigned_to(name)")
      .eq("tender_id", tenderId),
    supabase
      .from("tender_packs")
      .select("created_at, confirmed_by, confirmed_at, pipeline_stage, stage_changed_at, submitted_at")
      .eq("tender_id", tenderId)
      .maybeSingle(),
    // Who uploaded a shared template is only ours to see for our own uploads
    // (migration 0043: the uploader columns aren't readable directly).
    supabase.rpc("tender_document_uploads", { p_tender_id: tenderId }),
    supabase
      .from("pack_generation_jobs")
      .select("id, engine, kind, status, requested_by, requested_at, completed_at, page_count, error_message")
      .eq("tender_id", tenderId),
    supabase
      .from("generated_cvs")
      .select("id, position_code, status, requested_by, requested_at, completed_at, error_message, people:person_id(name)")
      .eq("tender_id", tenderId),
    supabase.from("tender_answers").select("field_key, original_filename, answered_by, updated_at").eq("tender_id", tenderId),
    supabase.rpc("company_member_labels"),
    supabase.from("tender_watched_documents").select("id, title, source, first_seen_at, summary, changes").eq("tender_id", tenderId).eq("baseline", false),
  ]);

  // A source that fails to load is named, not silently left out of the history.
  const failed = [
    ["notes", commentsRes.error],
    ["tasks", tasksRes.error],
    ["pipeline", packRes.error],
    ["templates", templatesRes.error],
    ["pack requests", jobsRes.error],
    ["CV requests", cvsRes.error],
    ["answers", answersRes.error],
    ["tender updates", updatesRes.error],
  ]
    .filter(([, e]) => !!e)
    .map(([name]) => name as string);

  type Named = { people: { name: string } | null };
  const input: ActivityInput = {
    companyId,
    tender: (tenderRes.data as ActivityInput["tender"]) ?? null,
    comments: (commentsRes.data ?? []) as ActivityInput["comments"],
    tasks: ((tasksRes.data ?? []) as unknown as (Omit<ActivityInput["tasks"][number], "assignee_name"> & Named)[]).map((t) => ({
      ...t,
      assignee_name: t.people?.name ?? null,
    })),
    pack: (packRes.data as ActivityInput["pack"]) ?? null,
    templates: (templatesRes.data ?? []) as ActivityInput["templates"],
    jobs: (jobsRes.data ?? []) as ActivityInput["jobs"],
    cvs: ((cvsRes.data ?? []) as unknown as (Omit<ActivityInput["cvs"][number], "person_name"> & Named)[]).map((c) => ({
      ...c,
      person_name: c.people?.name ?? null,
    })),
    answers: (answersRes.data ?? []) as ActivityInput["answers"],
    updates: (updatesRes.data ?? []) as NonNullable<ActivityInput["updates"]>,
  };

  const entries = buildTenderActivity(input);
  const shown = showAll ? entries : entries.slice(0, FEED_LIMIT);
  const noteCount = input.comments.length;

  const labels = new Map<string, string>();
  for (const r of (labelsRes.data ?? []) as { user_id: string; label: string }[]) labels.set(r.user_id, r.label);
  const actorName = (a: ActivityActor | null): string | null => {
    if (!a) return null;
    if (a.kind === "system") return "Tender Ready";
    if (a.kind === "other_company") return "Another company on this tender";
    if (!a.userId) return "A former member";
    if (a.userId === user.id) return "You";
    return labels.get(a.userId) ?? "A former member";
  };

  return (
    <div id="activity" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 flex flex-wrap items-start justify-between gap-2.5">
        <div className="text-[15px] font-bold text-foreground">Notes &amp; activity</div>
        {noteCount > 0 && (
          <span className="inline-flex rounded-full bg-warning/10 px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-warning">
            {noteCount} note{noteCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        Internal notes for your team, and what has happened on this tender, newest first. Only people in your
        company see these. Status and stage changes show their latest change only - earlier ones aren&apos;t kept.
      </div>

      <form action={addTenderComment} className="mb-3.5 flex flex-col gap-2">
        <input type="hidden" name="tender_id" value={tenderId} />
        <label htmlFor="tender-note" className="text-[11px] font-semibold text-foreground">Add a note</label>
        <textarea
          id="tender-note"
          name="body"
          required
          maxLength={4000}
          rows={3}
          placeholder="e.g. Client confirmed the briefing is non-compulsory - spoke to Thandi on the phone"
          className="w-full resize-y rounded-lg border border-border px-[11px] py-[9px] font-sans text-sm"
        />
        <div>
          <button
            type="submit"
            className="min-h-10 cursor-pointer rounded-lg border-none bg-foreground px-4 text-sm font-semibold text-white"
          >
            Add note
          </button>
        </div>
      </form>

      {failed.length > 0 && (
        <div className="mb-2 text-xs text-destructive">
          Could not load {failed.join(", ")} - the history below is missing those.
        </div>
      )}

      {entries.length === 0 ? (
        <div className="border-t border-border pt-2.5 text-xs text-muted-foreground">Nothing recorded yet.</div>
      ) : (
        <ol className="m-0 list-none p-0">
          {shown.map((e) => {
            const who = actorName(e.actor);
            const own = e.category === "note" && e.actor?.kind === "user" && e.actor.userId === user.id;
            return (
              <li key={e.key} className="flex gap-2.5 border-t border-border py-2.5">
                <span aria-hidden className={`mt-[5px] size-2 shrink-0 rounded-full ${CATEGORY_DOT[e.category]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div className="min-w-0 text-[13px] break-words text-foreground">
                      {who && <span className="font-bold">{who} </span>}
                      <span className={e.category === "note" ? "font-normal" : "font-semibold"}>
                        {who ? e.text.charAt(0).toLowerCase() + e.text.slice(1) : e.text}
                      </span>
                    </div>
                    <time dateTime={e.at} className="text-[11px] whitespace-nowrap text-muted-foreground">{formatActivityTime(e.at)}</time>
                  </div>
                  {e.body && (
                    <div className="mt-1 rounded-lg border border-border bg-card px-[11px] py-2 text-[13px] break-words whitespace-pre-wrap text-foreground">
                      {e.body}
                    </div>
                  )}
                  {e.detail && <div className="mt-0.5 text-xs break-words text-muted-foreground">{e.detail}</div>}
                  {own && e.commentId && (
                    <form action={deleteTenderComment} className="mt-1">
                      <input type="hidden" name="tender_id" value={tenderId} />
                      <input type="hidden" name="comment_id" value={e.commentId} />
                      <button type="submit" className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-muted-foreground">
                        Delete note
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!showAll && entries.length > FEED_LIMIT && (
        <a href={`/tenders/${tenderId}?activity=all#activity`} className="mt-2.5 inline-block text-xs font-semibold text-accent">
          Show all {entries.length} entries
        </a>
      )}
    </div>
  );
}
