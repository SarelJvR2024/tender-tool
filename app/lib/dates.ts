// Trust Blue standard date format (Phase 2, 2026-10-23): always "23 Oct 2026",
// never a raw US MM/DD/YYYY from an unqualified toLocaleDateString() - the
// exact options discovery/page.tsx's own SAST_DATE already used locally;
// shared here so every other caller gets the same, correct rendering
// instead of depending on the server's own default locale (which produced
// MM/DD/YYYY wherever a bare toLocaleDateString()/toLocaleString() call
// slipped through).
const SAST_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: "Africa/Johannesburg",
  day: "numeric",
  month: "short",
  year: "numeric",
};
const SAST_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = { ...SAST_DATE_OPTIONS, hour: "2-digit", minute: "2-digit" };

/** "23 Oct 2026" - South African date-only format. Returns null for an unreadable date, never a guess. */
export function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-ZA", SAST_DATE_OPTIONS);
}

/** "23 Oct 2026, 14:30" - South African date+time format. Returns null for an unreadable date, never a guess. */
export function formatDateTime(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-ZA", SAST_DATETIME_OPTIONS);
}

/**
 * Closing date/time with a real time - "23 Oct 2026 (Time TBC in RFP)" when
 * the stored value's SAST time is exactly midnight. parse_sast()
 * (engine/discovery/source_http.py) defaults a date-only ingest value - no
 * time given at all by the source - to SAST midnight as a generic "unknown"
 * marker; harmless for a published/briefing date, but shown as a tender's
 * own closing TIME it reads as a real (and highly improbable) deadline
 * rather than what it actually is: unspecified (Batch 2B Touch-ups, Sarel's
 * live feedback). Returns null for an unreadable date, same as
 * formatDate()/formatDateTime().
 */
export function formatClosingDateTime(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const sastTime = d.toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
  if (sastTime === "00:00") return `${formatDate(dateStr)} (Time TBC in RFP)`;
  return formatDateTime(dateStr);
}

// Shared "N days until a date" math, used anywhere a closing date or expiry
// date needs a day count: tenders closing (dashboard), documents expiring
// (company vault). A CALENDAR-DAY count - the difference between the target's
// own South African (SAST, UTC+2, no DST) calendar day and today's SAST
// calendar day - never a raw elapsed-time division. This app is SA-only (see
// SAST_DATE_OPTIONS/closingDayOf() above, both already explicit about it),
// but nothing pins the server's own TZ: no TZ env var is set anywhere in
// this repo (checked app/, engine/, every Dockerfile and GitHub Actions
// workflow), and both Vercel's default Node runtime and GitHub Actions'
// ubuntu-24.04 runners default to UTC.
//
// Finding 289 (2026-11-09): a prior version of this function derived
// "today"'s real SAST calendar day correctly (fixing an earlier, narrower
// 00:00-02:00 SAST rollover bug - see git history) but then anchored it at
// UTC midnight of that calendar-day string (`${sastYmd}T00:00:00Z`) and
// compared the TARGET's raw, un-floored timestamp against it with
// `Math.ceil()`. That anchor is 2 hours AFTER true SAST midnight (SAST
// midnight = the PRIOR UTC day's 22:00), so it only ever gave the right
// answer when `target` itself happened to fall exactly on UTC midnight (SAST
// 02:00) - true for a bare "YYYY-MM-DD" date-only string (every existing
// test here used one), but false for any REAL timestamp with a real
// time-of-day, which is exactly what tenders.closing_date/
// discovered_opportunities.closing_date/company_subscriptions.trial_ends_at
// (all `timestamptz`, unlike the company-document expiry columns, which are
// plain `date`) actually carry. For any such value, `ceil()` of a positive
// sub-day fraction always rounds UP - so the result was the correct
// calendar-day count PLUS 1, for every tender/trial on record, confirmed
// live across a full day sweep around a real closing instant: the function
// kept reporting "1 day left" for the tender's own entire remaining closing
// day (not "0"/Due today), then "0 days left"/Due-today for the entire
// FOLLOWING day after it had actually closed (not "-1"/Closed), only
// correctly reading "-1" from the second day after closing onward. This had
// already visibly surfaced once, in dispatchTriage.ts's own 2026-10-28 fix
// comment/test ("its own chip read daysUntil()'s 8 days left" for a tender
// that was genuinely 7 calendar days out) - that pass made dispatchTriage.ts
// agree with this function rather than questioning whether this function's
// own number was right, so the same +1 was carried into classifyDispatchBucket's
// 7-day triage boundary too. It also silently shifted every exact-day
// threshold match a day later than intended: tenderDeadlineReminders()
// (deadlineReminders.ts), briefingReminderCandidates(),
// clarificationWindowCandidates(), complianceDigestCandidates() and
// trialDay7Candidates() (trialLifecycle.ts, the trial_day_7_milestone email)
// all compare this function's real output against an exact day count.
// Fixed by converting BOTH sides to their own SAST calendar day first (reusing
// closingDayOf()'s already-tested timestamp -> "YYYY-MM-DD" conversion for
// the target, and the same en-CA/Africa-Johannesburg formatter already used
// here for "today") and then diffing those two calendar-day strings directly -
// a pure calendar-day count that no longer depends on either side's
// time-of-day at all. Identical output for every existing (date-only) test
// case; only changes the answer for a real timestamp with a non-"02:00 SAST"
// time-of-day, which is every one of them in practice.
export function daysUntil(dateStr: string | null, now: Date = new Date()): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  // An unreadable date gave NaN, and every NaN comparison is false - so
  // expiryStatus() showed a malformed expiry as "Current" (green). Unknown
  // instead, the same as no date: never a confident wrong answer.
  if (Number.isNaN(target.getTime())) return null;
  const targetSastYmd = closingDayOf(dateStr); // target's own SAST calendar day, time-of-day stripped
  const nowSastYmd = now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }); // "YYYY-MM-DD", host-TZ-independent
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(`${targetSastYmd}T00:00:00Z`).getTime() - new Date(`${nowSastYmd}T00:00:00Z`).getTime()) / msPerDay);
}

// The calendar day (South African time, UTC+2, no DST) a tender closes on,
// as "YYYY-MM-DD" - for comparing against a document's expiry DATE, and
// reused by daysUntil() itself (below - defined after this one, but a
// function declaration, so already available there) to strip a closing
// timestamp's time-of-day before diffing calendar days. Without this, a
// closing timestamp (e.g. 12:00 SAST = 10:00 UTC) used to count as a later
// day than a date-only expiry on that same day, so a document valid until
// the closing day was reported as "expires before this tender closes"
// (2026-10-17 scenario pass) - still called explicitly in
// tenderCompliance.ts (validityAtClosing(), sanralConventionalDocumentChecks())
// for exactly that reason, ahead of its own daysUntil() call; harmless now
// that daysUntil() applies the identical conversion internally too (Finding
// 289) - idempotent on an already-date-only string, so calling both is a
// no-op, not a double-correction.
export function closingDayOf(closingDate: string | null): string | null {
  if (!closingDate) return null;
  const t = new Date(closingDate);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Tone carries the status directly - no literal hex anywhere in this app
// (design-system color migration, spec §2). Previously this type held a
// literal {bg, color} hex pair and every renderer matched against those
// exact strings to recover a tone - fragile (silently fell through to
// "muted" if a hex value ever drifted) and exactly the hard-coded-colour
// pattern §2 forbids. "accent" is for a plain informational tag (e.g. a
// person's role tags), not a pass/fail judgement like the other four.
export type ChipTone = "success" | "warning" | "destructive" | "muted" | "accent";
export type StatusChip = { label: string; tone: ChipTone };

// Shared rule, driven directly by the real incident this exists to prevent:
// the CLI engine flagging a COID Letter of Good Standing as "expired" on
// every generated tender because nobody had a clear view of the expiry date
// on file. >60 days out = current, <=60 days = renew soon, past = expired,
// no date on file = grey/unknown (never treated as expired).
export function expiryStatus(dateStr: string | null, renewSoonWithinDays = 60): StatusChip {
  const left = daysUntil(dateStr);
  if (left === null) return { label: "Not on file", tone: "muted" };
  if (left < 0) return { label: "Expired", tone: "destructive" };
  if (left <= renewSoonWithinDays) return { label: "Renew soon", tone: "warning" };
  return { label: "Current", tone: "success" };
}

/**
 * Like expiryStatus(), but file-aware - for the Document Vault specifically,
 * where a document that's genuinely been uploaded must never read "Not on
 * file" just because its expiry date hasn't been captured/extracted yet.
 * Real bug, 2026-10-29 (Sarel: uploaded a COID Letter of Good Standing, the
 * row's own file link rendered correctly, but the status badge still said
 * "Not on file"): every caller passed expiryStatus() the expiry date alone,
 * with no check for whether a file/path was actually attached - "no date
 * on file yet" and "no document at all" are different, real states, and
 * conflating them is the exact bug this app's own expiryStatus() comment
 * already warns against for a different case (never a confident wrong
 * answer). hasFile is the document's own *_document_path column being
 * non-null - the one fact the real upload action (uploadVaultDocument(),
 * app/app/company/actions.ts) actually sets.
 */
export function documentStatus(hasFile: boolean, dateStr: string | null, renewSoonWithinDays = 60): StatusChip {
  if (!hasFile) return { label: "Not on file", tone: "muted" };
  if (dateStr === null) return { label: "Needs date verification", tone: "warning" };
  return expiryStatus(dateStr, renewSoonWithinDays);
}

/**
 * "Closes in X days / Y hours" - the exact wording Sarel asked for on the
 * Opportunities cards (2026-10-22 live feedback). The one shared deadline-
 * countdown calculation for any tender closing time - time-aware on purpose
 * (unlike the date-only daysUntil()): a tender closes at a stated hour, and
 * Math.ceil(ms / day) turned "closed 2 hours ago" into -0, which rendered as
 * "0 days left" instead of "closed" (2026-10-17 scenario pass). Used by
 * discovery/page.tsx's Opportunities cards and the Tender Workspace header
 * (app/app/tenders/[id]/page.tsx) - the latter used to keep its own,
 * independently-drifted copy of this exact function (missing the remaining-
 * hours breakdown below, QA finding 2026-10-26) rather than importing this
 * one; don't reintroduce a second copy.
 */
export function closingCountdown(closingDate: string | null): { text: string; urgent: boolean } | null {
  if (!closingDate) return null;
  const ms = new Date(closingDate).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { text: "closed", urgent: true };
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) return { text: hours < 1 ? "closes within the hour" : `closes in ${hours} hour${hours === 1 ? "" : "s"}`, urgent: true };
  const days = Math.floor(hours / 24);
  const remHours = hours - days * 24;
  return {
    text: remHours > 0 ? `closes in ${days} day${days === 1 ? "" : "s"} ${remHours} hour${remHours === 1 ? "" : "s"}` : `closes in ${days} day${days === 1 ? "" : "s"}`,
    urgent: days <= 7,
  };
}
