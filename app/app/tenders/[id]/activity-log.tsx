import { createClient } from "@/lib/supabase/server";
import { buildTenderActivity, formatActivityTime, type ActivityActor, type ActivityCategory, type ActivityInput } from "@/lib/tenderActivity";
import { addTenderComment, deleteTenderComment } from "./comment-actions";

/**
 * "Notes & activity" - feature list item 15's comments + "version history".
 * A plain note box (tender_comments, 0033) above one chronological feed of
 * what has happened on this tender, read from the rows that already record
 * it (app/lib/tenderActivity.ts says which, and what each can't say).
 */

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

// Newest first; the rest behind "Show all", so a long-running tender doesn't
// add a page of history to an already long workspace.
const FEED_LIMIT = 25;

const CATEGORY_DOT: Record<ActivityCategory, string> = {
  note: "#D97706",
  task: "#16233B",
  stage: "#16233B",
  positions: "#15803D",
  template: "#6B6758",
  pack: "#6B6758",
  cv: "#6B6758",
  answers: "#6B6758",
  tender: "#6B6758",
  update: "#B45309",
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
    if (a.kind === "system") return "Tender Tool";
    if (a.kind === "other_company") return "Another company on this tender";
    if (!a.userId) return "A former member";
    if (a.userId === user.id) return "You";
    return labels.get(a.userId) ?? "A former member";
  };

  return (
    <div id="activity" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>Notes &amp; activity</div>
        {noteCount > 0 && (
          <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "#FEF3C7", color: "#B45309", whiteSpace: "nowrap" }}>
            {noteCount} note{noteCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
        Internal notes for your team, and what has happened on this tender, newest first. Only people in your
        company see these. Status and stage changes show their latest change only - earlier ones aren&apos;t kept.
      </div>

      <form action={addTenderComment} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <input type="hidden" name="tender_id" value={tenderId} />
        <label htmlFor="tender-note" style={{ fontSize: 11, fontWeight: 600, color: "#16233B" }}>Add a note</label>
        <textarea
          id="tender-note"
          name="body"
          required
          maxLength={4000}
          rows={3}
          placeholder="e.g. Client confirmed the briefing is non-compulsory - spoke to Thandi on the phone"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
        />
        <div>
          <button
            type="submit"
            style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}
          >
            Add note
          </button>
        </div>
      </form>

      {failed.length > 0 && (
        <div style={{ fontSize: 12, color: "#B91C1C", marginBottom: 8 }}>
          Could not load {failed.join(", ")} - the history below is missing those.
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9A9684", borderTop: "1px solid #F0EEE6", paddingTop: 10 }}>Nothing recorded yet.</div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {shown.map((e) => {
            const who = actorName(e.actor);
            const own = e.category === "note" && e.actor?.kind === "user" && e.actor.userId === user.id;
            return (
              <li key={e.key} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid #F0EEE6" }}>
                <span aria-hidden style={{ flexShrink: 0, width: 8, height: 8, borderRadius: 100, marginTop: 5, background: CATEGORY_DOT[e.category] }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13, color: "#16233B", minWidth: 0, wordBreak: "break-word" }}>
                      {who && <span style={{ fontWeight: 700 }}>{who} </span>}
                      <span style={{ fontWeight: e.category === "note" ? 400 : 600 }}>
                        {who ? e.text.charAt(0).toLowerCase() + e.text.slice(1) : e.text}
                      </span>
                    </div>
                    <time dateTime={e.at} style={{ fontSize: 11, color: "#9A9684", whiteSpace: "nowrap" }}>{formatActivityTime(e.at)}</time>
                  </div>
                  {e.body && (
                    <div style={{ marginTop: 4, padding: "8px 11px", borderRadius: 8, background: "#F6F5F1", border: "1px solid #E5E1D5", fontSize: 13, color: "#16233B", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {e.body}
                    </div>
                  )}
                  {e.detail && <div style={{ fontSize: 12, color: "#6B6758", marginTop: 2, wordBreak: "break-word" }}>{e.detail}</div>}
                  {own && e.commentId && (
                    <form action={deleteTenderComment} style={{ marginTop: 4 }}>
                      <input type="hidden" name="tender_id" value={tenderId} />
                      <input type="hidden" name="comment_id" value={e.commentId} />
                      <button type="submit" style={{ background: "none", border: "none", padding: 0, fontSize: 11, fontWeight: 600, color: "#9A9684", cursor: "pointer" }}>
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
        <a href={`/tenders/${tenderId}?activity=all#activity`} style={{ display: "inline-block", marginTop: 10, fontSize: 12, fontWeight: 600, color: "#D97706" }}>
          Show all {entries.length} entries
        </a>
      )}
    </div>
  );
}
