// Shared grouping of system_alerts.source values into the same human-facing
// engine areas, used by both /admin (Quick Health Status - currently OPEN
// alerts) and /admin/telemetry (occurrences in the last 24h - a different,
// complementary question). One list, so the two pages can never silently
// disagree on which sources mean "the scraper" vs "an extraction worker".
export const HEALTH_SOURCE_GROUPS: Record<string, string[]> = {
  "Scraper / Discovery feed": ["discovery", "scraper"],
  "OCR & extraction workers": ["pack", "narrative", "cv", "cv_extract", "general", "onboarding", "worker"],
};
