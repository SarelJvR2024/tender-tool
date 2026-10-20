// A single shared filename sanitizer for every upload path in this app.
// Previously duplicated byte-for-byte in app/lib/onboardingScan.ts and
// app/lib/manualTender.ts (both re-export this for their own existing
// importers, unchanged), while ~8 other action files hand-rolled their own
// narrower inline version (`replace(/[^a-zA-Z0-9._-]/g, "_")`, no length
// cap, no space/parenthesis allowance) instead of importing either one -
// not exploitable today (both forms already strip "/"), but one future
// edit to any of those inline copies being slightly less careful would
// reopen path traversal in just that file, with no shared place to fix it.
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ ()-]/g, "_").slice(0, 120) || "document";
}
