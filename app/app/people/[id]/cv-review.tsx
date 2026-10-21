import { applyCvExtraction, discardCvExtraction } from "../actions";
import {
  EXTRACTED_PERSON_FIELDS,
  looksLikeExistingProject,
  type CvExtractionResult,
  type ExtractedPersonField,
} from "@/lib/cvExtraction";
import { Button } from "@/components/ui/button";

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
 *
 * Verify/Provide/Fix (app/AGENTS.md's product promise): migrated from ad hoc
 * "Waiting for your check"/"check" chips to the real vocabulary. A
 * high-confidence field traced to the CV (`verified`) reads as settled
 * (the "same as on file" green Verify pill, or simply no pill once ticked by
 * default); a low-confidence/unverified field (OCR uncertainty, couldn't be
 * traced, looks like a duplicate project) is Provide (amber) - something
 * only a human look can resolve. There is no Fix here: Fix means a genuine
 * disqualification risk on a REQUIRED field, and nothing in
 * `lib/cvExtraction.ts`'s field/project shape marks any field as required -
 * every gap on this intake screen is "needs a human to confirm or supply
 * it", never "this blocks the bid outright" - documented further in
 * app/AGENTS.md.
 */

type Tone = "success" | "warning" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  muted: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

const fieldClass =
  "min-h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function ValueInput({ field, name, value }: { field: ExtractedPersonField; name: string; value: string }) {
  if (field.kind === "select") {
    return (
      <select className={fieldClass} name={name} defaultValue={value}>
        <option value="">- choose -</option>
        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      className={fieldClass}
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
    <div className="mb-6 rounded-xl border-2 border-warning/40 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div>
          <h2 className="mb-0.5 font-display text-base font-medium text-foreground">Check the fields read from the CV</h2>
          <div className="text-xs text-muted-foreground">
            From <strong>{filename}</strong>
            {result.source_pages ? ` · ${result.source_pages} page(s)` : ""} · read {new Date(result.created_at).toLocaleDateString()}.
            Nothing has been saved yet. Correct anything wrong, untick anything you don&apos;t want, then save.
          </div>
        </div>
        <Pill tone="warning">Provide - check before saving</Pill>
      </div>

      {/* EXPERIMENTAL OCR (engine/ocr/scan_ocr.py): the CV was a scan, read by character recognition. */}
      {result.text_method?.includes("OCR") && (
        <div className="mt-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <strong>Read by OCR from a scan.</strong> This CV (or part of it) had no real text layer, so its text was read by character
          recognition. OCR can misread letters and digits and skip a line, so values read from the scan start unticked - check each
          one against the scan before saving.
        </div>
      )}

      {(result.warnings ?? []).length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {(result.warnings ?? []).map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <form action={applyCvExtraction} className="mt-3">
        <input type="hidden" name="person_id" value={personId} />
        <input type="hidden" name="extraction_id" value={result.id} />

        {fields.length === 0 && (
          <div className="my-2 text-sm text-muted-foreground">No person fields were found on this CV.</div>
        )}

        {groups.map((group) => {
          const inGroup = fields.filter((f) => f.group === group);
          if (inGroup.length === 0) return null;
          return (
            <div key={group} className="mt-2.5">
              <div className="mb-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">
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
                  <div key={f.key} className="cvx-row grid grid-cols-[28px_1fr] items-start gap-2 border-t border-border py-2 sm:grid-cols-[28px_150px_1fr_1fr]">
                    <input type="checkbox" name={`use_${f.key}`} defaultChecked={defaultTick} disabled={same} aria-label={`Save ${f.label}`} className="mt-1 size-[18px] sm:mt-2.5" />
                    <div className="flex flex-col gap-2 sm:contents">
                      <div className="text-sm font-semibold text-foreground sm:pt-2.5">{f.label}</div>
                      <div>
                        <div className="mb-0.5 text-[11px] text-muted-foreground">On file now</div>
                        <div className={`min-h-5 text-sm break-words ${now ? "text-foreground" : "text-muted-foreground/70"}`}>{shownNow}</div>
                      </div>
                      <div>
                        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          From the CV {same ? <Pill tone="success">same as on file</Pill> : !p.verified && <Pill tone="warning">Provide - check</Pill>}
                        </div>
                        <ValueInput field={f} name={`f_${f.key}`} value={proposed} />
                        {p.evidence && f.kind !== "secret" && (
                          <div className="mt-1 text-[11px] break-words text-muted-foreground italic">CV says: &ldquo;{p.evidence}&rdquo;</div>
                        )}
                        {reasons.map((r, i) => (
                          <div key={i} className="mt-0.5 text-[11px] text-warning">{r}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        <div className="mt-4 mb-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Projects ({projects.length})
        </div>
        {projects.length === 0 && <div className="text-sm text-muted-foreground">No projects were found on this CV.</div>}
        {projects.map((proj, i) => {
          const dup = looksLikeExistingProject(proj.client_and_number, existingProjects);
          const reasons = [...(dup ? ["Looks like a project already on file - left unticked so it isn't added twice."] : []), ...proj.warnings];
          return (
            <div key={i} className={`mb-2 rounded-lg border border-border p-3 ${dup ? "bg-muted/40" : "bg-card"}`}>
              <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <input type="checkbox" name={`p${i}_use`} defaultChecked={proj.verified && !dup} className="size-[18px]" />
                Add this project
                {!proj.verified && <Pill tone="warning">Provide - check</Pill>}
                {dup && <Pill tone="muted">already on file?</Pill>}
              </label>
              <div className="cvx-proj grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="mb-0.5 text-[11px] text-muted-foreground">Client and contract number</div>
                  <input className={fieldClass} name={`p${i}_client_and_number`} defaultValue={proj.client_and_number} />
                </div>
                <div><div className="mb-0.5 text-[11px] text-muted-foreground">Position held</div><input className={fieldClass} name={`p${i}_position_held`} defaultValue={proj.position_held ?? ""} /></div>
                <div><div className="mb-0.5 text-[11px] text-muted-foreground">Value (R million)</div><input className={fieldClass} type="number" step="0.01" name={`p${i}_value_rm`} defaultValue={proj.value_rm ?? ""} /></div>
                <div><div className="mb-0.5 text-[11px] text-muted-foreground">Start date</div><input className={fieldClass} type="date" name={`p${i}_start_date`} defaultValue={proj.start_date ?? ""} /></div>
                <div><div className="mb-0.5 text-[11px] text-muted-foreground">End date (empty = ongoing)</div><input className={fieldClass} type="date" name={`p${i}_end_date`} defaultValue={proj.end_date ?? ""} /></div>
                <div><div className="mb-0.5 text-[11px] text-muted-foreground">Referee name</div><input className={fieldClass} name={`p${i}_contact_name`} defaultValue={proj.contact_name ?? ""} /></div>
                <div><div className="mb-0.5 text-[11px] text-muted-foreground">Referee phone</div><input className={fieldClass} name={`p${i}_contact_phone`} defaultValue={proj.contact_phone ?? ""} /></div>
                <div className="sm:col-span-2"><div className="mb-0.5 text-[11px] text-muted-foreground">Referee email</div><input className={fieldClass} type="email" name={`p${i}_contact_email`} defaultValue={proj.contact_email ?? ""} /></div>
              </div>
              {proj.evidence && <div className="mt-1.5 text-[11px] text-muted-foreground italic">CV says: &ldquo;{proj.evidence}&rdquo;</div>}
              {reasons.map((r, j) => <div key={j} className="mt-0.5 text-[11px] text-warning">{r}</div>)}
            </div>
          );
        })}
        {projects.length > 0 && (
          <div className="mb-1 text-[11px] text-muted-foreground">
            Added projects are marked &ldquo;referee unconfirmed&rdquo; until a performance report confirms them. Client type,
            project type and position code (SANRAL&apos;s coded values) aren&apos;t read from CVs - set them on each project.
          </div>
        )}

        {(proposal.other_registrations ?? []).length > 0 && (
          <div className="mt-2.5 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <strong className="text-foreground">Also on the CV, not saved</strong> (there&apos;s no field for these yet):{" "}
            {proposal.other_registrations.map((r) => [r.body, r.level, r.number].filter(Boolean).join(" ")).join("; ")}.
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap gap-2.5">
          <Button type="submit" variant="default" size="lg" className="min-h-11 px-5">
            Save ticked fields
          </Button>
          <Button formAction={discardCvExtraction} type="submit" variant="destructive" size="lg" className="min-h-11 px-4">
            Discard - save nothing
          </Button>
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          Saving also queues the standard CV formats for this person, built from the confirmed fields.
          {result.model && ` Read by ${result.model}.`}
        </div>
      </form>
    </div>
  );
}
