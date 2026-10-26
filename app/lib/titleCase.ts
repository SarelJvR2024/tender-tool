// Phase 2 Opportunities triage view (2026-10-23, Sarel's own brief): "clean
// title casing, not raw scraped ALL-CAPS". Government procurement portals
// (SANRAL, Rand Water, Eskom, municipal boards, ...) routinely publish
// titles fully in capitals - gov_sources.py reads them verbatim, real typos
// and all, so the raw text is never corrected at the source. This is a
// DISPLAY-ONLY transform: the stored title is never rewritten, and this only
// fires when the whole title has no lowercase letters at all (a strong
// "this was shouted, not deliberately capitalised" signal) - a title that
// already has normal mixed case is left completely alone, acronyms and all.

// Known acronyms/abbreviations this app's own tender titles actually use -
// kept fully capitalised rather than Title-Cased into something worse
// ("Sanral", "Vat"). Not every acronym on earth - just the ones this
// product's own real data has shown up with (gov_sources.py fixtures,
// engine/discovery/*, docs/specs/*).
const KNOWN_ACRONYMS = new Set([
  "SANRAL", "ECSA", "SACPCMP", "SACNASP", "SAGC", "CIDB", "NRA", "VAT",
  "PTY", "CC", "LTD", "BEE", "COID", "SARS", "ISO", "RFQ", "RFP", "SBD",
  "MBD", "DPWI", "PPE", "NEC3", "JBCC", "GCC",
]);

// Words too short to safely Title-Case one way or the other (prepositions,
// conjunctions, articles) stay lowercase mid-title, same convention as a
// style-guide headline case - "Appointment of a Service Provider for the
// Maintenance", not "... Of A Service Provider For The Maintenance".
const LOWERCASE_MID_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "with"]);

function titleCaseWord(word: string, isFirst: boolean): string {
  const bare = word.replace(/[^A-Za-z]/g, "");
  // A common short conjunction/article mid-title is lowercased first - "AND"
  // is 3 letters, same length as a real short acronym, so this has to run
  // BEFORE the short-word preservation below, or "and" would never lowercase.
  if (!isFirst && LOWERCASE_MID_WORDS.has(bare.toLowerCase())) return word.toLowerCase();
  // Leaves anything with a digit, or already in KNOWN_ACRONYMS, exactly
  // as-is. A blanket "any short word stays as-is" rule was tried and
  // reverted - "WAR" (an ordinary word) and "ZK" (a real initialism) are the
  // same length, and nothing short of an actual dictionary tells them apart;
  // an unlisted short acronym title-casing imperfectly ("Zk") is an honest,
  // acceptable limitation of a cosmetic display transform, not a reason to
  // make ordinary short words worse to avoid it.
  if (/\d/.test(word) || KNOWN_ACRONYMS.has(bare)) return word;
  // Title-case only the first letter of the run of letters, lowercase the
  // rest, preserving any leading/trailing punctuation (e.g. "(RFQ10419311)").
  return word.replace(/[A-Za-z]+/, (run) => run.charAt(0).toUpperCase() + run.slice(1).toLowerCase());
}

/** True only when the string has at least one letter and no lowercase ones - the "shouted" signal. */
function isAllCaps(s: string): boolean {
  return /[A-Z]/.test(s) && !/[a-z]/.test(s);
}

/**
 * Renders a tender title for display: Title Case instead of ALL-CAPS when
 * the source was fully shouted, unchanged otherwise. Never touches the
 * underlying stored value - callers still store/compare/search the raw
 * title exactly as read.
 */
export function displayTenderTitle(title: string | null): string | null {
  if (!title) return title;
  if (!isAllCaps(title)) return title;
  return title
    .split(" ")
    .map((word, i) => titleCaseWord(word, i === 0))
    .join(" ");
}
