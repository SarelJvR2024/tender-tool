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
export const HEALTH_SOURCE_GROUPS: Record<string, string[]> = {
  "Scraper / Discovery feed": ["discovery", "scraper", "tender_changes", "tender_updates"],
  "OCR & extraction workers": ["pack", "narrative", "cv", "cv_extract", "general", "ocr", "onboarding_scan", "worker"],
  "Deadline watch & daily digest": ["deadlines", "digest"],
};
