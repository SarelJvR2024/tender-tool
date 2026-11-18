// Pure person-matching logic for the bulk CV upload screen, extracted from
// bulk-cv-upload.tsx the same reason bulkCvChunking.ts was (that file's own
// header comment) - so it can be tested directly by plain Node
// (node --experimental-strip-types, no bundler), which a .tsx file with real
// JSX can't be.

export type MatchablePerson = { id: string; name: string };

/**
 * Finding 492 (standing review, 2026-11-18): used to check each significant
 * name part (>2 chars) against the filename with a raw `.includes()` -
 * substring matching, not word matching. A short name that happens to be a
 * PREFIX of a different, longer person's name false-positive matched: e.g.
 * "Pieter Nel"'s own "nel" part is a literal substring of "nelson", so a CV
 * filename meant for "Pieter Nelson" ("Pieter_Nelson_CV.pdf") auto-matched
 * to "Pieter Nel" instead, whenever "Pieter Nel" happened to sort earlier in
 * the company's own people list. This is a pre-fill guess only (the UI lets
 * a reviewer re-pick the person before anything is ever uploaded, and
 * guessNameFromFilename()'s own header already says a guess here is "never
 * trusted as a match") - but a bulk upload's whole point is reviewing many
 * rows quickly, and a plausible-looking wrong name pre-selected in a
 * dropdown is exactly the kind of thing a reviewer skims past, attaching
 * the wrong professional's CV to the wrong person's roster record for a
 * real tender submission.
 *
 * Now tokenizes the filename on any run of non-alphanumeric characters
 * (underscore/hyphen/dot/space - the same separator set
 * guessNameFromFilename() already assumes in this same screen) and requires
 * each name part to be a WHOLE token, not merely a substring anywhere in
 * the raw string.
 */
export function bestPersonMatch(filename: string, people: MatchablePerson[]): MatchablePerson | null {
  const tokens = new Set(filename.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean));
  for (const p of people) {
    const parts = p.name.toLowerCase().split(/\s+/).filter((s) => s.length > 2);
    if (parts.length > 0 && parts.every((part) => tokens.has(part))) return p;
  }
  return null;
}
