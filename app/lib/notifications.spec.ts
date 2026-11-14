import { describe, expect, it, vi } from "vitest";
import { getNotifications } from "./notifications";

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minimal Supabase client stub - same shape as complianceDigestCandidates.spec.ts's own
 * stubSupabase(), extended with the `tenders` table getNotifications() also reads. Every
 * chain method returns the same thenable `self`, so both call shapes work: awaiting the
 * chain directly, and calling .maybeSingle() on it for the single `companies` row. */
function stubSupabase(opts: {
  company: Record<string, unknown> | null;
  held?: Record<string, unknown>[];
  types?: Record<string, unknown>[];
  people?: Record<string, unknown>[];
  tenders?: Record<string, unknown>[];
  watchedDocs?: Record<string, unknown>[];
  /** Table name whose read should come back with a real Supabase error, e.g. "held_registrations". */
  erroringTable?: string;
}) {
  const rowsByTable: Record<string, unknown[]> = {
    held_registrations: opts.held ?? [],
    registration_types: opts.types ?? [],
    people: opts.people ?? [],
    tenders: opts.tenders ?? [],
    tender_watched_documents: opts.watchedDocs ?? [],
  };
  const errFor = (table: string) => (table === opts.erroringTable ? { message: `${table} read failed` } : null);
  return {
    from(table: string) {
      const self: Record<string, unknown> = {
        select: () => self,
        eq: () => self,
        not: () => self,
        order: () => self,
        maybeSingle: async () => ({ data: table === "companies" ? opts.company : null, error: errFor(table) }),
        then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
          resolve({ data: rowsByTable[table] ?? [], error: errFor(table) }),
      };
      return self;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const blankCompany = {
  coid_letter_of_good_standing_expiry: null,
  cidb_expiry: null,
  sars_tcs_pin_expiry: null,
  pi_insurance_expiry: null,
  iso_9001_expiry: null,
  bank_confirmation_letter_valid_until: null,
  bee_proof_expiry: null,
};

// Standing solution-architect review, 2026-11-06: getNotifications() used to
// destructure all 5 of its parallel reads as just `{ data }`, with no error
// captured at all - a 4th blind spot in the standing TS-sweep's own grep
// (array/tuple Promise.all destructures never match its literal
// "const { data" pattern). A real failure on any read fell through to the
// same `?? []`/null defaults as a genuine "nothing expiring/closing soon"
// case, so the topbar bell (AppShell.tsx) and the dashboard's own
// "Documents expiring" stat card could both show a false all-clear. Fixed
// by throwing instead - both call sites already have error-isolation built
// specifically to catch an exception from this function (AppShell.tsx's own
// `.catch()`, dashboard/page.tsx's own top-level try/catch); it just never
// fired for this bug class, since nothing here used to throw on a soft
// `{ error }` failure.
describe("getNotifications - a read failure throws, instead of a false all-clear", () => {
  it("throws when the companies read fails", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = stubSupabase({ company: blankCompany, erroringTable: "companies" });
    await expect(getNotifications(supabase)).rejects.toThrow(/companies read failed/);
    expect(logSpy).toHaveBeenCalled();
  });

  it("throws when the held_registrations read fails, even though every other read succeeded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = stubSupabase({ company: blankCompany, erroringTable: "held_registrations" });
    await expect(getNotifications(supabase)).rejects.toThrow(/held_registrations read failed/);
  });

  it("does not throw and returns real notifications on the ordinary success path", async () => {
    const supabase = stubSupabase({ company: { ...blankCompany, sars_tcs_pin_expiry: daysFromNow(45) } });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).toContain("company:sars_tcs_pin_expiry");
  });
});

describe("getNotifications - company field windows", () => {
  it("flags a 60-day field (e.g. SARS TCS PIN) at 45 days out - within the default window", async () => {
    const supabase = stubSupabase({ company: { ...blankCompany, sars_tcs_pin_expiry: daysFromNow(45) } });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).toContain("company:sars_tcs_pin_expiry");
  });

  it("does NOT flag the bank confirmation letter at 45 days out - its own window is 30, not the 60-day default", async () => {
    // Real bug, found 2026-10-29: this used to apply the flat 60-day default to every
    // company field, including the bank letter - which the vault page and the real
    // compliance checks all treat as "renew soon" at 30 days (3-month validity). The bell
    // would nag about a letter the vault itself still called "Current".
    const supabase = stubSupabase({ company: { ...blankCompany, bank_confirmation_letter_valid_until: daysFromNow(45) } });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).not.toContain("company:bank_confirmation_letter_valid_until");
  });

  it("DOES flag the bank confirmation letter at 25 days out - inside its own 30-day window", async () => {
    const supabase = stubSupabase({ company: { ...blankCompany, bank_confirmation_letter_valid_until: daysFromNow(25) } });
    const notifications = await getNotifications(supabase);
    const n = notifications.find((x) => x.id === "company:bank_confirmation_letter_valid_until");
    expect(n).toBeDefined();
    expect(n!.severity).toBe("warning");
  });

  it("flags an already-expired bank confirmation letter regardless of window", async () => {
    const supabase = stubSupabase({ company: { ...blankCompany, bank_confirmation_letter_valid_until: daysFromNow(-5) } });
    const notifications = await getNotifications(supabase);
    const n = notifications.find((x) => x.id === "company:bank_confirmation_letter_valid_until");
    expect(n).toBeDefined();
    expect(n!.severity).toBe("destructive");
  });
});

// Finding 294 (2026-11-09): the person loop below used to hardcode only
// ecsa_expiry/sacpcmp_expiry - a person holding a SACNASP/SAGC registration
// about to expire got no bell notification at all, even though their own
// People page (lib/personCredentials.ts) and the engine's email reminder
// (watch_deadlines.py's TRACKED_PERSON_EXPIRY_FIELDS) have both covered all
// four bodies since a9a5364 (2026-10-17), 4 days before this file's own
// original commit.
describe("getNotifications - person credential coverage (Finding 294)", () => {
  it("flags ECSA, SACPCMP, SACNASP and SAGC equally for the same person at the same window", async () => {
    const supabase = stubSupabase({
      company: blankCompany,
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          ecsa_expiry: daysFromNow(10),
          sacpcmp_expiry: daysFromNow(10),
          sacnasp_expiry: daysFromNow(10),
          sagc_expiry: daysFromNow(10),
        },
      ],
    });
    const notifications = await getNotifications(supabase);
    const ids = notifications.map((n) => n.id);
    expect(ids).toContain("person:p1:ecsa_expiry");
    expect(ids).toContain("person:p1:sacpcmp_expiry");
    expect(ids).toContain("person:p1:sacnasp_expiry");
    expect(ids).toContain("person:p1:sagc_expiry");
  });
});

// Finding 434: the bell's own "closing soon" deadline loop read `tenders`
// joined to `tender_packs!inner(id)` with no `pipeline_stage` at all, so it
// never applied `deadlineReminders.ts`'s own DEADLINE_REMINDER_EXCLUDED_STAGES
// (submitted/briefing_shortlisted/won/lost) - the exact "a company already
// past this milestone shouldn't still get nagged about it" rule every OTHER
// closing-date-ish reminder in this codebase applies (the email reminder
// script itself, lib/returnablesDigestCandidates.ts, lib/briefingReminders.ts,
// lib/printCutoffReminders.ts's CLOSED_STAGES, lib/opportunityInsights.ts's
// and lib/pastSubmissionReuse.ts's DONE_STAGES). AGENTS.md's own header
// comment for this file claims the email reminder "triggers off the exact
// facts lib/notifications.ts's bell already computes" - true for the
// DEADLINE_WINDOW_DAYS constant, false for this stage exclusion, which only
// ever lived in deadlineReminders.ts's own deadlineReminderCandidates(),
// never imported here. Real effect: the topbar bell (shown on every signed-in
// page) kept showing a "Closes in N days" / "Closes today" warning for a
// tender a company had already submitted, or that was already won/lost -
// noise for a deadline that no longer needs any action.
describe("getNotifications - tender deadlines exclude stages already past the deadline (Finding 434)", () => {
  it("does NOT surface a closing-soon notification for a tender already submitted", async () => {
    const supabase = stubSupabase({
      company: blankCompany,
      tenders: [
        {
          id: "t1",
          contract_no: "C1",
          description: "Tender 1",
          closing_date: daysFromNow(2),
          tender_packs: [{ id: "p1", pipeline_stage: "submitted" }],
        },
      ],
    });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).not.toContain("deadline:t1");
  });

  it("does NOT surface a closing-soon notification for a tender already won", async () => {
    const supabase = stubSupabase({
      company: blankCompany,
      tenders: [
        {
          id: "t2",
          contract_no: "C2",
          description: "Tender 2",
          closing_date: daysFromNow(1),
          tender_packs: [{ id: "p2", pipeline_stage: "won" }],
        },
      ],
    });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).not.toContain("deadline:t2");
  });

  it("still surfaces a closing-soon notification for a tender still genuinely in progress", async () => {
    const supabase = stubSupabase({
      company: blankCompany,
      tenders: [
        {
          id: "t3",
          contract_no: "C3",
          description: "Tender 3",
          closing_date: daysFromNow(2),
          tender_packs: [{ id: "p3", pipeline_stage: "bidding" }],
        },
      ],
    });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).toContain("deadline:t3");
  });
});

// QA finding (2026-11-12, this track's own pass): the bell's "closing soon"
// deadline loop read `tenders.closing_date` with no knowledge at all of a
// whole-tender cancellation notice on file
// (`tender_watched_documents.kind === "cancellation"`) - the exact same
// stale-signal shape Finding 449 fixed for the "closing in 3 days/24 hours"
// deadline-reminder EMAIL (`lib/deadlineReminders.ts`'s own
// `tendersWithCancellationNotice()`), left explicitly open in that
// finding's own write-up as a named, not-yet-investigated lead for this
// exact surface (the bell is shown on every signed-in page - the most
// likely place a stale warning is actually seen). Real effect pre-fix: the
// SAME recipients already told via a "Cancellation notice" card on the
// Tender Workspace page, and via the corrigendum-alert email the moment the
// notice was first seen, would keep seeing "Closes in N days"/"Closes
// today" on the topbar bell right up to the original, now-meaningless
// closing date.
describe("getNotifications - a cancelled tender no longer surfaces a stale closing-soon bell notification", () => {
  it("does NOT surface a closing-soon notification once a cancellation notice is on file", async () => {
    const supabase = stubSupabase({
      company: blankCompany,
      tenders: [
        {
          id: "t4",
          contract_no: "C4",
          description: "Tender 4",
          closing_date: daysFromNow(2),
          tender_packs: [{ id: "p4", pipeline_stage: "bidding" }],
        },
      ],
      watchedDocs: [{ tender_id: "t4", kind: "cancellation" }],
    });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).not.toContain("deadline:t4");
  });

  it("still surfaces a closing-soon notification for a DIFFERENT tender that is still genuinely open", async () => {
    const supabase = stubSupabase({
      company: blankCompany,
      tenders: [
        {
          id: "t5",
          contract_no: "C5",
          description: "Tender 5 (cancelled)",
          closing_date: daysFromNow(1),
          tender_packs: [{ id: "p5", pipeline_stage: "bidding" }],
        },
        {
          id: "t6",
          contract_no: "C6",
          description: "Tender 6 (open)",
          closing_date: daysFromNow(2),
          tender_packs: [{ id: "p6", pipeline_stage: "bidding" }],
        },
      ],
      watchedDocs: [{ tender_id: "t5", kind: "cancellation" }],
    });
    const notifications = await getNotifications(supabase);
    const ids = notifications.map((n) => n.id);
    expect(ids).not.toContain("deadline:t5");
    expect(ids).toContain("deadline:t6");
  });

  it("ignores a non-cancellation document kind (e.g. an addendum) - only 'cancellation' suppresses the deadline", async () => {
    const supabase = stubSupabase({
      company: blankCompany,
      tenders: [
        {
          id: "t7",
          contract_no: "C7",
          description: "Tender 7",
          closing_date: daysFromNow(2),
          tender_packs: [{ id: "p7", pipeline_stage: "bidding" }],
        },
      ],
      watchedDocs: [{ tender_id: "t7", kind: "addendum" }],
    });
    const notifications = await getNotifications(supabase);
    expect(notifications.map((n) => n.id)).toContain("deadline:t7");
  });
});
