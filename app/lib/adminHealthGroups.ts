// Shared grouping of system_alerts.source values into the same human-facing
// engine areas, used by both /admin (Quick Health Status - currently OPEN
// alerts) and /admin/telemetry (occurrences in the last 24h - a different,
// complementary question). One list, so the two pages can never silently
// disagree on which sources mean "the scraper" vs "an extraction worker".
//
// Real bug, 2026-11-06: this list had drifted from the actual source
// literals every engine/ caller passes to system_alerts.record() (confirmed
// by grepping every real call site - 13 distinct values exist today: cv,
// cv_extract, deadlines, digest, discovery, general, narrative, ocr,
// onboarding_scan, pack, tender_changes, tender_updates, worker). Both
// healthFromAlerts() (app/admin/page.tsx) and the telemetry error-group sum
// (app/admin/telemetry/page.tsx) only ever look at alerts whose source is
// listed in ONE of these groups - a source missing from every group is
// silently invisible on both pages (counted nowhere, so its group(s) read
// "no open alerts"/0, green, even while that source is actually raising
// critical alerts). Two concrete gaps this fixes: "onboarding" here never
// matched anything (the real source is "onboarding_scan",
// engine/onboarding/process_onboarding_jobs.py's own alert_source) - every
// onboarding-classification failure was invisible, not just "building"'s;
// "ocr" (engine/ocr/scan_ocr.py, engine/general/requirements.py,
// engine/cv/extract_cv_fields.py's own OCR failures) wasn't listed anywhere
// at all, despite this group's own name promising to cover it.
// "tender_changes"/"tender_updates" (engine/discovery/tender_changes.py,
// watch_tender_updates.py) are discovery-area, same as "discovery" already
// in the first group. "deadlines" (engine/compliance/watch_deadlines.py)
// and "digest" (engine/notify/daily_digest.py) didn't fit either existing
// group, so they get their own - not merged into one of the others just to
// avoid a third entry.
//
// Standing review pass, 2026-11-06 (follow-up to the fix above, same day):
// the 2026-11-06 fix's own "every real source" accounting missed one -
// "onboarding" (not "onboarding_scan") is ALSO a real, distinct source:
// engine/worker/run_bridges.py's BRIDGES dict key "onboarding" is passed
// directly as system_alerts.record()'s source for a bridge-PROCESS-level
// failure (the bridge couldn't even start, timed out, or exited non-zero -
// all "critical" severity), separate from "onboarding_scan"'s job-level OCR/
// classification failures raised from inside that same bridge once it's
// running. The pre-2026-11-06 list DID correctly cover "onboarding" (it was
// listed, just alongside the wrong job-level literal); replacing it with
// "onboarding_scan" instead of adding both re-opened that coverage gap for
// the bridge-level alerts specifically. Confirmed by reading
// run_bridges.py's BRIDGES dict (cv/cv_extract/pack/general/narrative all
// use the SAME literal for both their bridge- and job-level alerts, which is
// why only "onboarding" needs its own second entry here).
//
// Standing review pass, 2026-11-09: both 2026-11-06 fixes' own "every real
// source" accounting still missed one - "digest_send"
// (engine/notify/send_digest_emails.py, 5 real call sites: a missing
// RESEND_API_KEY, a failed-to-send summary, and 2 "could not mark as
// digested" warnings) is a real, actively-used, error/warning-severity
// source distinct from "digest" (engine/notify/daily_digest.py, the
// digest-BUILDING step; send_digest_emails.py is the separate SENDING step
// that actually calls Resend). Confirmed missing from every group here, and
// from REAL_SYSTEM_ALERT_SOURCES in this file's own exhaustiveness test
// (adminHealthGroups.spec.ts) - which is why that test's prior passing
// result never caught it: its own "ground truth" list was itself
// incomplete, not just this export. Same invisible-on-both-dashboards
// consequence as the 2026-11-06 gaps this list's own comment above already
// describes.
export const HEALTH_SOURCE_GROUPS: Record<string, string[]> = {
  "Scraper / Discovery feed": ["discovery", "scraper", "tender_changes", "tender_updates"],
  "OCR & extraction workers": ["pack", "narrative", "cv", "cv_extract", "general", "ocr", "onboarding", "onboarding_scan", "worker"],
  "Deadline watch & daily digest": ["deadlines", "digest", "digest_send"],
};
