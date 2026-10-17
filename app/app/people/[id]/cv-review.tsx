import { applyCvExtraction, discardCvExtraction } from "../actions";
import {
  EXTRACTED_PERSON_FIELDS,
  looksLikeExistingProject,
  type CvExtractionResult,
  type ExtractedPersonField,
} from "@/lib/cvExtraction";

/**
 * Confirm-or-correct card for one AI-extracted CV (cv_extraction_results,
 * 0023). Per field: what's on file now, what the CV says (editable), the CV
 * line it was read from, and a tick. Nothing is saved until "Save ticked
 * fields"; only ticked rows are written (applyCvExtraction).
 *
 * Default ticks, so the common case is one click but nothing risky is:
 *  - ticked: the value was traced to the CV text and the field is empty on file;
 *  - unticked: it would replace a different value already on file, it couldn't
 *    be traced to the CV, a date is a year/month placeholder, or a project looks
 *    like one already on file. Each unticked reason is shown next to the row.
 */

const NAVY = "#16233B";
const MUTED = "#6B6758";
const FAINT = "#9A9684";
const BORDER = "#E5E1D5";

const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", minHeight: 40, padding: "0 10px",
  borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: "system-ui, sans-serif",
  color: NAVY, background: "#FFFFFF",
};
const chip = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-flex", padding: "2px 8px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color,
});

function ValueInput({ field, name, value }: { field: ExtractedPersonField; name: string; value: string }) {
  if (field.kind === "select") {
    return (
      <select style={input} name={name} defaultValue={value}>
        <option value="">- choose -</option>
        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      style={input}
      name={name}
      defaultValue={value}
      type={field.kind === "date" ? "date" : field.kind === "secret" ? "password" : "text"}
      autoComplete="off"
    />
  );
}

export function CvExtractionReview({
  result,
  filename,
  personId,
  current,
  existingProjects,
}: {
  result: CvExtractionResult;
  filename: string;
  personId: string;
  current: Record<string, string | null>;
  existingProjects: string[];
}) {
  const proposal = result.proposed;
  const fields = EXTRACTED_PERSON_FIELDS.filter((f) => proposal.person?.[f.key]?.value != null || (proposal.person?.[f.key]?.warnings ?? []).length > 0);
  const projects = proposal.projects ?? [];
  const groups = ["Identity", "Registrations", "Qualifications"] as const;

  return (
    <div style={{ background: "#FFFFFF", border: "2px solid #D97706", borderRadius: 12, padding: "16px 16px 14px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: NAVY, margin: "0 0 2px" }}>Check the fields read from the CV</h2>
          <div style={{ fontSize: 12, color: MUTED }}>
            From <strong>{filename}</strong>
            {result.source_pages ? ` · ${result.source_pages} page(s)` : ""} · read {new Date(result.created_at).toLocaleDateString()}.
            Nothing has been saved yet. Correct anything wrong, untick anything you don&apos;t want, then save.
          </div>
        </div>
        <span style={chip("#FEF3C7", "#B45309")}>Waiting for your check</span>
      </div>

      {(result.warnings ?? []).length > 0 && (
        <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "9px 12px", margin: "12px 0 0", fontSize: 12, color: "#92400E" }}>
          {(result.warnings ?? []).map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <form action={applyCvExtraction} style={{ marginTop: 12 }}>
        <input type="hidden" name="person_id" value={personId} />
        <input type="hidden" name="extraction_id" value={result.id} />

        {fields.length === 0 && (
          <div style={{ fontSize: 13, color: MUTED, margin: "8px 0" }}>No person fields were found on this CV.</div>
        )}

        {groups.map((group) => {
          const inGroup = fields.filter((f) => f.group === group);
          if (inGroup.length === 0) return null;
          return (
            <div key={group} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: FAINT, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                {group}
              </div>
              {inGroup.map((f) => {
                const p = proposal.person[f.key];
                const now = current[f.key] ?? null;
                const proposed = p.value ?? "";
                const same = now != null && now === proposed;
                const replaces = now != null && now !== "" && !same;
                const defaultTick = p.verified && !replaces && !same && proposed !== "";
                const reasons = [
                  ...(replaces ? ["Would replace what's on file."] : []),
                  ...p.warnings,
                ];
                const shownNow = now == null || now === "" ? "-" : f.kind === "secret" ? "on file (hidden)" : now;
                return (
                  <div key={f.key} className="cvx-row" style={{ display: "grid", gridTemplateColumns: "28px 150px 1fr 1fr", gap: 8, alignItems: "start", padding: "8px 0", borderTop: "1px solid #F0EEE6" }}>
                    <input type="checkbox" name={`use_${f.key}`} defaultChecked={defaultTick} disabled={same} aria-label={`Save ${f.label}`} style={{ width: 18, height: 18, marginTop: 10 }} />
                    <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, paddingTop: 10 }}>{f.label}</div>
                    <div>
                      <div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>On file now</div>
                      <div style={{ fontSize: 13, color: now ? NAVY : FAINT, minHeight: 20, wordBreak: "break-word" }}>{shownNow}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>
                        From the CV {same ? <span style={chip("#DCFCE7", "#15803D")}>same as on file</span> : !p.verified && <span style={chip("#FEF3C7", "#B45309")}>check</span>}
                      </div>
                      <ValueInput field={f} name={`f_${f.key}`} value={proposed} />
                      {p.evidence && f.kind !== "secret" && (
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 3, fontStyle: "italic", wordBreak: "break-word" }}>CV says: &ldquo;{p.evidence}&rdquo;</div>
                      )}
                      {reasons.map((r, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>{r}</div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        <div style={{ fontSize: 12, fontWeight: 700, color: FAINT, textTransform: "uppercase", letterSpacing: "0.04em", margin: "16px 0 6px" }}>
          Projects ({projects.length})
        </div>
        {projects.length === 0 && <div style={{ fontSize: 13, color: MUTED }}>No projects were found on this CV.</div>}
        {projects.map((proj, i) => {
          const dup = looksLikeExistingProject(proj.client_and_number, existingProjects);
          const reasons = [...(dup ? ["Looks like a project already on file - left unticked so it isn't added twice."] : []), ...proj.warnings];
          return (
            <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: dup ? "#FAFAF7" : "#FFFFFF" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 8 }}>
                <input type="checkbox" name={`p${i}_use`} defaultChecked={proj.verified && !dup} style={{ width: 18, height: 18 }} />
                Add this project
                {!proj.verified && <span style={chip("#FEF3C7", "#B45309")}>check</span>}
                {dup && <span style={chip("#F0EEE6", MUTED)}>already on file?</span>}
              </label>
              <div className="cvx-proj" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>Client and contract number</div>
                  <input style={input} name={`p${i}_client_and_number`} defaultValue={proj.client_and_number} />
                </div>
                <div><div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>Position held</div><input style={input} name={`p${i}_position_held`} defaultValue={proj.position_held ?? ""} /></div>
                <div><div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>Value (R million)</div><input style={input} type="number" step="0.01" name={`p${i}_value_rm`} defaultValue={proj.value_rm ?? ""} /></div>
                <div><div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>Start date</div><input style={input} type="date" name={`p${i}_start_date`} defaultValue={proj.start_date ?? ""} /></div>
                <div><div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>End date (empty = ongoing)</div><input style={input} type="date" name={`p${i}_end_date`} defaultValue={proj.end_date ?? ""} /></div>
                <div><div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>Referee name</div><input style={input} name={`p${i}_contact_name`} defaultValue={proj.contact_name ?? ""} /></div>
                <div><div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>Referee phone</div><input style={input} name={`p${i}_contact_phone`} defaultValue={proj.contact_phone ?? ""} /></div>
                <div style={{ gridColumn: "1 / -1" }}><div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>Referee email</div><input style={input} type="email" name={`p${i}_contact_email`} defaultValue={proj.contact_email ?? ""} /></div>
              </div>
              {proj.evidence && <div style={{ fontSize: 11, color: MUTED, marginTop: 6, fontStyle: "italic" }}>CV says: &ldquo;{proj.evidence}&rdquo;</div>}
              {reasons.map((r, j) => <div key={j} style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>{r}</div>)}
            </div>
          );
        })}
        {projects.length > 0 && (
          <div style={{ fontSize: 11, color: FAINT, marginBottom: 4 }}>
            Added projects are marked &ldquo;referee unconfirmed&rdquo; until a performance report confirms them. Client type,
            project type and position code (SANRAL&apos;s coded values) aren&apos;t read from CVs - set them on each project.
          </div>
        )}

        {(proposal.other_registrations ?? []).length > 0 && (
          <div style={{ background: "#F6F5F1", borderRadius: 9, padding: "9px 12px", margin: "10px 0 0", fontSize: 12, color: MUTED }}>
            <strong style={{ color: NAVY }}>Also on the CV, not saved</strong> (there&apos;s no field for these yet):{" "}
            {proposal.other_registrations.map((r) => [r.body, r.level, r.number].filter(Boolean).join(" ")).join("; ")}.
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button type="submit" style={{ minHeight: 44, padding: "0 18px", borderRadius: 10, background: NAVY, color: "#FFFFFF", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}>
            Save ticked fields
          </button>
          <button formAction={discardCvExtraction} type="submit" style={{ minHeight: 44, padding: "0 16px", borderRadius: 10, background: "#FFFFFF", color: "#B91C1C", fontWeight: 600, fontSize: 13, border: "1px solid #FCA5A5", cursor: "pointer" }}>
            Discard - save nothing
          </button>
        </div>
        <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>
          Saving also queues the standard CV formats for this person, built from the confirmed fields.
          {result.model && ` Read by ${result.model}.`}
        </div>
      </form>
    </div>
  );
}
