/**
 * Regression test for tender-documents-menu.tsx / tender-documents-menu-logic.ts
 * (Finding 433) - the Tender Workspace header's own "Tender documents"
 * popover rendered EVERY private document row as a clickable `<a>`, even
 * when `d.href` was null (its real signed URL failed to be created -
 * page.tsx's own `createSignedUrl()` call). `href={d.href ?? "#"}` meant
 * clicking that row did nothing at all (jumped to the top of the page),
 * with no indication anything was wrong - unlike every sibling that
 * renders this exact same `tender_private_documents` data
 * (private-documents.tsx's own list, cv-compare.tsx), which already falls
 * back to plain, unlinked text in that case.
 *
 * No React renderer is set up in this repo for a `.tsx` component (no
 * jsdom/testing-library dependency - confirmed: `grep -rn
 * "testing-library\|jsdom" app/package.json` has zero hits), so - same
 * precedent cover-page-lines.test.ts/cover-page-preview.tsx already
 * established for an identical "presentational component" fix (Finding
 * 425) - the branching decision was extracted to a plain, importable
 * `tender-documents-menu-logic.ts` and is given a real unit test here, and
 * the component's own `.tsx` source is read directly (not imported - a
 * `.tsx` file can't be imported by plain Node, confirmed:
 * `node --experimental-strip-types` throws ERR_UNKNOWN_FILE_EXTENSION on
 * one) to confirm the dead-link pattern is gone and the fix is actually
 * wired in, not just that a plausible-looking test exists beside unchanged
 * code.
 *
 * Run: node --experimental-strip-types --test "app/app/tenders/[id]/tender-documents-menu.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hasRealHref } from "./tender-documents-menu-logic.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test("hasRealHref: a real signed URL string is a real href", () => {
  assert.equal(hasRealHref({ href: "https://storage.example/signed?x=1" }), true);
});

test("hasRealHref: null (a failed createSignedUrl()) is NOT a real href", () => {
  assert.equal(hasRealHref({ href: null }), false);
});

test('hasRealHref: empty string is NOT a real href either (defensive - never produced today, but `!!""` must stay false)', () => {
  assert.equal(hasRealHref({ href: "" }), false);
});

test('tender-documents-menu.tsx\'s own source no longer renders the dead `href={d.href ?? "#"}` fallback for a private document row', () => {
  const src = readFileSync(join(HERE, "tender-documents-menu.tsx"), "utf8");
  assert.ok(
    !src.includes('href={d.href ?? "#"}'),
    "the pre-fix dead-link pattern (a clickable row that silently does nothing when the signed URL failed) is still present",
  );
});

test("tender-documents-menu.tsx's own source actually branches on hasRealHref(d) for private docs, rendering a non-link row when it's false - not just accepting-and-dropping the check", () => {
  const src = readFileSync(join(HERE, "tender-documents-menu.tsx"), "utf8");
  assert.match(src, /hasRealHref\(d\)\s*\?/, "no ternary branching on hasRealHref(d) found around the private-docs row render");
  assert.match(src, /<a\b[^>]*key=\{d\.id\}/s, "the real-href branch should still render a real <a> link, keyed the same as before");
  assert.match(src, /<div key=\{d\.id\}/, "the no-href branch should render a plain, non-link container, matching private-documents.tsx's own <span> fallback");
  assert.match(src, /from "\.\/tender-documents-menu-logic"/, "hasRealHref should be imported from the extracted, testable logic file, not re-declared inline");
});
