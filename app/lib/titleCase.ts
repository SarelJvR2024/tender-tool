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
  // Leaves anything with a digit, or already in KNOWN_ACRONYMS, exactly
  // as-is - checked BEFORE the mid-title lowercase rule below. QA pass,
  // 2026-11-11: this used to run AFTER that rule, so a letter+digit code
  // whose letters-only portion happens to match a stop word - a route/
  // section code like "A1"/"A2" ("UPGRADE OF SECTION A1 TO A2"), or
  // "AT2"/"ON3"/"OR5" - was wrongly lowercased to "a1"/"a2"/"at2", directly
  // contradicting this function's own already-tested "a reference code
  // with digits is left exactly as-is" guarantee (that existing test only
  // ever used a digit-only/punctuated code, e.g. "R.396-010-2025/1F", never
  // one whose bare letters collide with a stop word, so the gap went
  // uncaught). A blanket "any short word stays as-is" rule was tried and
  // reverted - "WAR" (an ordinary word) and "ZK" (a real initialism) are the
  // same length, and nothing short of an actual dictionary tells them apart;
  // an unlisted short acronym title-casing imperfectly ("Zk") is an honest,
  // acceptable limitation of a cosmetic display transform, not a reason to
  // make ordinary short words worse to avoid it. Reordering does NOT fix
  // the identical, pre-existing ambiguity for a bare word with no digit at
  // all (e.g. "OR" in "OR TAMBO", the real district municipality/airport
  // name, still reads as the conjunction "or") - that is the same accepted
  // limitation as "WAR"/"ZK" above, not something this fix changes either
  // way; this fix is narrowly the digit-preservation guarantee only.
  if (/\d/.test(word) || KNOWN_ACRONYMS.has(bare)) return word;
  // A common short conjunction/article mid-title is lowercased next - "AND"
  // is 3 letters, same length as a real short acronym, so this still has to
  // run before the general title-casing below, or "and" would never
  // lowercase.
  if (!isFirst && LOWERCASE_MID_WORDS.has(bare.toLowerCase())) return word.toLowerCase();
  // Title-case the first letter of EVERY run of letters in the word, not
  // just the first one, lowercasing the rest of each run - preserving any
  // leading/trailing/interior punctuation (e.g. "(RFQ10419311)"). The /g
  // flag matters: a hyphenated word (gov-source titles routinely carry
  // "RE-ADVERTISED"/"CO-ORDINATION" - state/seen_tenders.json has a real,
  // live "RE-ADVERTISED" title) has TWO letter runs separated by the
  // hyphen; without /g only the first run ("RE") was transformed and the
  // second ("ADVERTISED") was left exactly as scraped - still shouting,
  // defeating the whole point of this display-only transform for any
  // multi-run word (found + fixed, standing review).
  return word.replace(/[A-Za-z]+/g, (run) => run.charAt(0).toUpperCase() + run.slice(1).toLowerCase());
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
