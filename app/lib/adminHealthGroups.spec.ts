import { describe, expect, it } from "vitest";
import { HEALTH_SOURCE_GROUPS } from "./adminHealthGroups";

// Every distinct system_alerts.source literal a real engine/ caller actually
// passes to system_alerts.record() today - confirmed by grepping every real
// call site (not a docstring/comment mention), 2026-11-06:
//   engine/cv/process_cv_jobs.py                        -> "cv"
//   engine/cv/extract_cv_fields.py                       -> "cv_extract", "ocr"
//   engine/compliance/watch_deadlines.py                 -> "deadlines"
//   engine/notify/daily_digest.py                        -> "digest"
//   engine/discovery/watch_new_tenders.py,
//   engine/discovery/opportunity_requirements.py,
//   engine/discovery/download_discovered_documents.py    -> "discovery"
//   engine/general/process_general_jobs.py,
//   engine/notify/send_pack_ready_email.py                -> "general"
//   engine/narrative/process_narrative_jobs.py            -> "narrative"
//   engine/general/requirements.py, engine/ocr/scan_ocr.py -> "ocr"
//   engine/onboarding/process_onboarding_jobs.py,
//   engine/onboarding/classify_documents.py               -> "onboarding_scan"
//   engine/pack/process_pack_jobs.py                      -> "pack"
//   engine/discovery/tender_changes.py                    -> "tender_changes"
//   engine/discovery/watch_tender_updates.py              -> "tender_updates"
//   engine/worker/run_bridges.py                          -> "worker", and (its
//     BRIDGES dict keys, used directly as system_alerts.record()'s source for
//     a bridge-process-level failure - distinct from each bridge's own job-
//     level source) "onboarding" specifically (the other BRIDGES keys - cv,
//     cv_extract, pack, general, narrative - already match their own job-
//     level literal, so only "onboarding" needs a second, separate entry)
const REAL_SYSTEM_ALERT_SOURCES = [
  "cv",
  "cv_extract",
  "deadlines",
  "digest",
  "discovery",
  "general",
  "narrative",
  "ocr",
  "onboarding",
  "onboarding_scan",
  "pack",
  "tender_changes",
  "tender_updates",
  "worker",
];

describe("HEALTH_SOURCE_GROUPS", () => {
  it(
    "covers every real system_alerts.source literal exactly once - the structural invariant that keeps a real open alert from going " +
      "silently uncounted (green/0) on both /admin's Quick Health Status and /admin/telemetry's error-group breakdown, both of which " +
      "only ever look at a source if it's listed in one of these groups (2026-11-06: 'onboarding' here never matched the real " +
      "'onboarding_scan' source, and 'ocr'/'deadlines'/'digest'/'tender_changes'/'tender_updates' weren't listed anywhere at all)",
    () => {
      const allListed = Object.values(HEALTH_SOURCE_GROUPS).flat();
      for (const source of REAL_SYSTEM_ALERT_SOURCES) {
        const groupsContainingIt = Object.values(HEALTH_SOURCE_GROUPS).filter((sources) => sources.includes(source));
        expect(groupsContainingIt.length, `"${source}" should be in exactly one group, found in ${groupsContainingIt.length}`).toBe(1);
      }
      // Not the reverse assertion (every listed entry must be a real source) -
      // "scraper" is deliberately kept as a harmless, currently-unused entry
      // (see adminHealthGroups.ts's own comment), so this only checks that no
      // REAL source is missing, not that the list contains nothing else.
      expect(allListed).toEqual(expect.arrayContaining(REAL_SYSTEM_ALERT_SOURCES));
    },
  );
});
