/**
 * Regression test for tender-readiness.ts - the pure readiness-score /
 * Verify-Provide-Fix flattening behind the tender workspace's unified
 * header. No network, no database, same spirit as pack-review-logic.test.ts.
 *
 * Run: node --experimental-strip-types --test app/app/tenders/[id]/tender-readiness.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeTenderReadiness } from "./tender-readiness.ts";
import type { ReviewSection } from "./pack-review-data";

const HERE = dirname(fileURLToPath(import.meta.url));

function section(overrides: Partial<ReviewSection>): ReviewSection {
  return { key: "s", title: "Section", changeHref: "#s", changeLabel: "Change", items: [], error: null, ...overrides };
}

test("no sections at all is 100% ready, nothing left", () => {
  const r = computeTenderReadiness([]);
  assert.deepEqual(r, { score: 100, totalCount: 0, confirmedCount: 0, thingsLeft: 0, fix: [], provide: [], verify: [] });
});

test("a section that failed to load contributes nothing to the count", () => {
  const r = computeTenderReadiness([section({ error: "Couldn't load this section: boom", items: [{ key: "x", label: "X", value: null, status: "confirmed", note: null }] })]);
  assert.equal(r.totalCount, 0);
  assert.equal(r.score, 100);
});

test("every item confirmed is a 100% score, nothing left", () => {
  const sections = [
    section({ key: "company", title: "Company master data", changeHref: "/company", changeLabel: "Open company profile", items: [
      { key: "legal_name", label: "Legal name", value: "Klipcorp (Pty) Ltd", status: "confirmed", note: null },
    ] }),
  ];
  const r = computeTenderReadiness(sections);
  assert.equal(r.score, 100);
  assert.equal(r.thingsLeft, 0);
  assert.equal(r.verify.length, 1);
  assert.equal(r.verify[0].confirmed, true);
  assert.equal(r.verify[0].sourceLabel, "Company master data");
  assert.equal(r.verify[0].changeHref, "/company");
});

test("a mix of statuses buckets correctly and the score is the confirmed fraction", () => {
  const sections = [
    section({
      key: "documents",
      title: "Supporting & vault documents",
      changeHref: "#tender-templates",
      items: [
        { key: "csd", label: "CSD registration", value: "On file", status: "confirmed", note: null }, // verify, confirmed
        { key: "bbee", label: "B-BBEE certificate", value: null, status: "missing", note: "Expired on file" }, // fix (missing)
        { key: "bank", label: "Bank confirmation letter", value: null, status: "needs_input", note: "Not on file" }, // provide
        { key: "tax", label: "SARS tax compliance", value: "PIN on file", status: "assumed_default", note: "Confirm it's still valid" }, // verify, unconfirmed
      ],
    }),
  ];
  const r = computeTenderReadiness(sections);
  assert.equal(r.totalCount, 4);
  assert.equal(r.confirmedCount, 1);
  assert.equal(r.score, 25); // 1 of 4
  assert.equal(r.thingsLeft, 3);
  assert.equal(r.fix.length, 1);
  assert.equal(r.fix[0].key, "bbee");
  assert.equal(r.provide.length, 1);
  assert.equal(r.provide[0].key, "bank");
  assert.equal(r.verify.length, 2);
  assert.ok(r.verify.some((i) => i.key === "csd" && i.confirmed));
  assert.ok(r.verify.some((i) => i.key === "tax" && !i.confirmed));
});

test("score rounds to the nearest whole number", () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, value: null, status: (i === 0 ? "confirmed" : "missing") as const, note: null }));
  const r = computeTenderReadiness([section({ items })]);
  assert.equal(r.totalCount, 3);
  assert.equal(r.confirmedCount, 1);
  assert.equal(r.score, 33); // 1/3 = 33.33... -> rounds to 33
});

// Finding 350: page.tsx's own PrimaryPackActionLink - the sticky header's
// "Generate submission pack" shortcut, which its own doc comment says exists
// only to jump to the REAL control further down the page (submission-pack.tsx
// / general-workspace.tsx) - used to require `thingsLeft === 0` (introduced
// PR #39, before Fix/Provide/Verify gating existed) to light up as `ready`.
// Both real buttons were switched, PR #40, to gate on `fix.length > 0` ONLY
// (page.tsx was not touched by PR #40 at all - `git show 6949cce --stat`).
// A tender with open Provide/unconfirmed-Verify items but zero Fix items is
// exactly the disagreement this left behind: the real button is already
// enabled, but the header link showed disabled with a false "N readiness
// items still need confirming first" reason. These two expressions replicate
// page.tsx's own pre-fix (`Old`) and post-fix (`New`) `ready` formula byte for
// byte (see the `PrimaryPackActionLink` call site), checked against the exact
// same expression submission-pack.tsx/general-workspace.tsx use for their own
// real button (`fixCount > 0` / `generalFixCount > 0`), never a re-derivation.
test("the header's PrimaryPackActionLink gate must agree with the real Generate-pack button's gate (Finding 350)", () => {
  const sections = [
    section({
      items: [
        { key: "signatory", label: "Who signs this bid", value: null, status: "needs_input", note: "Not chosen" }, // provide
        { key: "tax", label: "SARS tax compliance", value: "PIN on file", status: "assumed_default", note: "Confirm it's still valid" }, // verify, unconfirmed
      ],
    }),
  ];
  const readiness = computeTenderReadiness(sections);
  assert.equal(readiness.fix.length, 0, "no Fix item in this scenario");
  assert.equal(readiness.thingsLeft, 2, "but 2 things are still left overall");

  // The real control (submission-pack.tsx's `fixCount`/general-workspace.tsx's
  // `generalFixCount`): disabled only when a Fix item is open.
  const realButtonReady = readiness.fix.length === 0;
  assert.equal(realButtonReady, true, "the real Generate-pack button is already enabled");

  const headerLinkReadyOld = readiness.thingsLeft === 0; // page.tsx's formula before this fix
  const headerLinkReadyNew = readiness.fix.length === 0; // page.tsx's formula after this fix

  assert.notEqual(headerLinkReadyOld, realButtonReady, "RED: the old header-link gate disagreed with the real button");
  assert.equal(headerLinkReadyNew, realButtonReady, "GREEN: the fixed header-link gate agrees with the real button");
});

// Same finding, checked directly against the real (non-importable - it's an
// async Server Component reading next/headers and Supabase) source of
// page.tsx itself, not just a logical replica of its formula - so this fails
// for real against the pre-fix file (still reads `thingsLeft === 0`) and
// passes against the post-fix one, not only "the arithmetic works out".
test("page.tsx's own PrimaryPackActionLink source now gates on fix.length, not thingsLeft (Finding 350)", () => {
  const src = readFileSync(join(HERE, "page.tsx"), "utf8");
  const call = src.slice(src.indexOf("<PrimaryPackActionLink"), src.indexOf("<PrimaryPackActionLink") + 1800);
  const readyLine = call.slice(call.indexOf("ready={"), call.indexOf("ready={") + 160);
  assert.match(readyLine, /tenderReadiness\.fix\.length === 0/, "the ready= prop must key off fix.length, matching the real Generate-pack button's own gate");
  assert.doesNotMatch(readyLine, /tenderReadiness\.thingsLeft === 0/, "must no longer use the stricter, pre-PR-#40 thingsLeft gate");
});

// Finding 351: the exact same thingsLeft-vs-fix.length disagreement Finding
// 350 fixed for PrimaryPackActionLink, in two sibling sites Finding 350's
// own pass missed/flagged-but-left in this same file: (1) the tender-facts
// header card's own readiness-score pill ("Ready to submit" / "N things left
// before you can submit", right next to PrimaryPackActionLink on the same
// card), and (2) WorkspaceStatusBadge's identical "Ready to submit" label -
// explicitly flagged as NOT fixed by Finding 350's own write-up pending
// "fresh investigation... whether it's deliberately broader". It is not:
// WorkspaceStatusBadge's own header comment (896f3ae-era) promises it
// "can't disagree with the readiness score right below it on the same
// card" - i.e. with site (1) - so both must move together, and PR #40's own
// commit message ("the same cached Pack Review snapshot the workspace
// header's readiness score already reads, so this can't disagree with it")
// says site (1) must agree with the real button too. A third site,
// `blockingSummary` (the Tender Command Center urgent-dispatch line), has
// the identical issue by its own comment's explicit goal ("reusing
// tenderReadiness... already computed above for the facts card and the
// primary-action disabled reason... rather than... a second summary that
// could disagree with the first") - fixed alongside the other two.
test("the facts-card readiness pill and WorkspaceStatusBadge must also agree with the real Generate-pack button's gate (Finding 351)", () => {
  const sections = [
    section({
      items: [
        { key: "signatory", label: "Who signs this bid", value: null, status: "needs_input", note: "Not chosen" }, // provide
        { key: "tax", label: "SARS tax compliance", value: "PIN on file", status: "assumed_default", note: "Confirm it's still valid" }, // verify, unconfirmed
      ],
    }),
  ];
  const readiness = computeTenderReadiness(sections);
  assert.equal(readiness.fix.length, 0, "no Fix item in this scenario");
  assert.equal(readiness.thingsLeft, 2, "but 2 things are still left overall");

  const realButtonReady = readiness.fix.length === 0;

  const factsCardReadyOld = readiness.thingsLeft === 0; // pre-Finding-351 formula
  const factsCardReadyNew = readiness.fix.length === 0; // post-Finding-351 formula
  assert.notEqual(factsCardReadyOld, realButtonReady, "RED: the old facts-card pill disagreed with the real button");
  assert.equal(factsCardReadyNew, realButtonReady, "GREEN: the fixed facts-card pill agrees with the real button");

  const badgeReadyOld = readiness.thingsLeft === 0; // WorkspaceStatusBadge's pre-Finding-351 formula
  const badgeReadyNew = readiness.fix.length === 0; // post-Finding-351 formula
  assert.notEqual(badgeReadyOld, realButtonReady, "RED: the old WorkspaceStatusBadge disagreed with the real button");
  assert.equal(badgeReadyNew, realButtonReady, "GREEN: the fixed WorkspaceStatusBadge agrees with the real button");
});

// Same finding, checked directly against page.tsx's own real source text (not
// just a logical replica), the same way Finding 350's own second test did,
// for all 3 sites this fix touches: the facts-card pill, WorkspaceStatusBadge,
// and blockingSummary.
test("page.tsx's own facts-card pill, WorkspaceStatusBadge and blockingSummary now gate on fix.length, not thingsLeft (Finding 351)", () => {
  const src = readFileSync(join(HERE, "page.tsx"), "utf8");

  // (1) The facts-card readiness pill: the block starting at its wrapping
  // `<div className="mt-2.5 flex items-center gap-2.5...` through the
  // "Ready to submit" label just below it.
  const pillTagStart = src.indexOf("<span", src.indexOf('border-t border-border pt-2.5">'));
  assert.ok(pillTagStart !== -1, "facts-card pill markup must still exist");
  const pillBlock = src.slice(pillTagStart, pillTagStart + 900);
  assert.match(pillBlock, /tenderReadiness\.fix\.length === 0\s*\?\s*"bg-success\/10 text-success"/, "the pill's color must key off fix.length");
  assert.match(pillBlock, /tenderReadiness\.fix\.length === 0\s*\n\s*\?\s*"Ready to submit"/, "the pill's label must key off fix.length");
  assert.doesNotMatch(pillBlock, /tenderReadiness\.thingsLeft/, "the facts-card pill must no longer read thingsLeft at all");

  // (2) WorkspaceStatusBadge's own "Ready to submit" branch.
  const badgeStart = src.indexOf("function WorkspaceStatusBadge(");
  assert.ok(badgeStart !== -1, "WorkspaceStatusBadge must still exist");
  const badgeBlock = src.slice(badgeStart, badgeStart + 2000);
  assert.match(badgeBlock, /tenderReadiness && tenderReadiness\.fix\.length === 0/, "the badge's Ready-to-submit branch must key off fix.length");
  assert.doesNotMatch(badgeBlock, /tenderReadiness\.thingsLeft/, "WorkspaceStatusBadge must no longer read thingsLeft at all");

  // (3) blockingSummary, the Tender Command Center urgent-dispatch line.
  const blockingStart = src.indexOf("const blockingSummary =");
  assert.ok(blockingStart !== -1, "blockingSummary must still exist");
  const blockingBlock = src.slice(blockingStart, blockingStart + 400);
  assert.match(blockingBlock, /tenderReadiness && tenderReadiness\.fix\.length > 0/, "blockingSummary must key off fix.length");
  assert.doesNotMatch(blockingBlock, /tenderReadiness\.thingsLeft/, "blockingSummary must no longer read thingsLeft at all");
});
