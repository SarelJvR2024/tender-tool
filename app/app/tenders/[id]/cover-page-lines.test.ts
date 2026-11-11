/**
 * Regression test for cover-page-lines.ts / cover-page-preview.tsx
 * (Finding 353) - the Outer Envelope cover preview silently never showed a
 * tender's own tender-box delivery address, even though
 * engine/make_envelope_covers.py's real generator has printed it
 * (`_addressee_block()`) since 2026-10-18. No network, no database, same
 * spirit as tender-readiness.test.ts.
 *
 * Run: node --experimental-strip-types --test "app/app/tenders/[id]/cover-page-lines.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildOuterEnvelopeLines, deliveryAddressLines } from "./cover-page-lines.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = {
  hasLogo: false,
  contractNo: "SANRAL R.334-030-2025/1F",
  nraReference: "NRA 2026/0073",
  description: "Routine road maintenance",
  closingText: "22 Oct 2026, 11:00",
  buyer: "SANRAL",
  tendererLine: "TENDERER: Klipcorp (Pty) Ltd",
};

test("deliveryAddressLines: null/undefined/empty all produce no lines, matching the pre-fix behavior exactly", () => {
  assert.deepEqual(deliveryAddressLines(null), []);
  assert.deepEqual(deliveryAddressLines(undefined), []);
  assert.deepEqual(deliveryAddressLines([]), []);
});

test("deliveryAddressLines: filters out blank lines, matching make_envelope_covers.py's own `[l for l in (delivery_address or []) if l]` filter", () => {
  assert.deepEqual(deliveryAddressLines(["20 Shoreward Drive", "", "Bay West", "   ", "Gqeberha"]), [
    "20 Shoreward Drive",
    "Bay West",
    "Gqeberha",
  ]);
});

test("buildOuterEnvelopeLines: with no delivery address and no registered address/CIPC number, output is identical to the pre-Finding-353 hard-coded array (regression safety)", () => {
  const lines = buildOuterEnvelopeLines({ ...BASE, deliveryAddress: null });
  assert.deepEqual(lines, [
    "No logo on file",
    "OUTER ENVELOPE",
    "The South African National Roads Agency SOC Limited",
    "CONTRACT SANRAL R.334-030-2025/1F",
    "NRA 2026/0073",
    "ROUTINE ROAD MAINTENANCE",
    "TENDER CLOSES: 22 Oct 2026, 11:00",
    "Client: SANRAL",
    "TENDERER: Klipcorp (Pty) Ltd",
  ]);
});

test("buildOuterEnvelopeLines (Finding 425): a real registered address and CIPC number both print right after the TENDERER line, matching _bidder_block()'s own order in make_envelope_covers.py", () => {
  const lines = buildOuterEnvelopeLines({
    ...BASE,
    deliveryAddress: null,
    registeredAddress: "12 Bosman Street, Pretoria Central, Pretoria, 0002",
    cipcRegistrationNumber: "2014/123456/07",
  });
  const tendererIdx = lines.indexOf("TENDERER: Klipcorp (Pty) Ltd");
  assert.ok(tendererIdx >= 0);
  assert.deepEqual(lines.slice(tendererIdx + 1), [
    "12 Bosman Street, Pretoria Central, Pretoria, 0002",
    "CIPC Registration No: 2014/123456/07",
  ]);
});

test("buildOuterEnvelopeLines (Finding 425): a null/missing registered address or CIPC number prints neither line, same as _bidder_block()'s own `if comp.get(...)` guards", () => {
  const lines = buildOuterEnvelopeLines({ ...BASE, deliveryAddress: null, registeredAddress: null, cipcRegistrationNumber: null });
  assert.equal(lines.some((l) => l.includes("CIPC Registration No")), false);
  assert.deepEqual(lines[lines.length - 1], "TENDERER: Klipcorp (Pty) Ltd");
});

test("buildOuterEnvelopeLines: a real delivery address prints right after the SANRAL line and before CONTRACT, matching _addressee_block()'s own order in make_envelope_covers.py", () => {
  const lines = buildOuterEnvelopeLines({ ...BASE, deliveryAddress: ["20 Shoreward Drive", "Bay West", "Gqeberha"] });
  const sanralIdx = lines.indexOf("The South African National Roads Agency SOC Limited");
  const contractIdx = lines.indexOf("CONTRACT SANRAL R.334-030-2025/1F");
  assert.ok(sanralIdx >= 0 && contractIdx > sanralIdx);
  assert.deepEqual(lines.slice(sanralIdx + 1, contractIdx), ["20 Shoreward Drive", "Bay West", "Gqeberha"]);
});

test("cover-page-preview.tsx's own source actually wires deliveryAddress through to buildOuterEnvelopeLines() and the on-screen box, not just accepting-and-dropping the prop", () => {
  const src = readFileSync(join(HERE, "cover-page-preview.tsx"), "utf8");
  assert.match(src, /deliveryAddress\?:\s*string\[\]\s*\|\s*null/, "the component must accept a deliveryAddress prop");
  assert.match(src, /buildOuterEnvelopeLines\(\{[\s\S]*?deliveryAddress[\s\S]*?\}\)/, "printLines must be built from buildOuterEnvelopeLines() with deliveryAddress passed through");
  assert.match(src, /addressLines\.map\(/, "the on-screen dashed-border preview box must also render the address lines, not just the Print-preview window");
});

test("cover-page-preview.tsx's own source actually reads and wires registered_address/cipc_registration_number through, not just accepting-and-dropping the extra company fields (Finding 425)", () => {
  const src = readFileSync(join(HERE, "cover-page-preview.tsx"), "utf8");
  assert.match(src, /from\("companies"\)[\s\S]{0,200}registered_address[\s\S]{0,200}cipc_registration_number/, "the companies select must actually request both columns");
  assert.match(src, /buildOuterEnvelopeLines\(\{[\s\S]*?registeredAddress[\s\S]*?cipcRegistrationNumber[\s\S]*?\}\)/, "printLines must be built with registeredAddress/cipcRegistrationNumber passed through");
  assert.match(src, /\{registeredAddress\s*&&/, "the on-screen box must also render the registered address when present");
  assert.match(src, /\{cipcRegistrationNumber\s*&&/, "the on-screen box must also render the CIPC registration number when present");
});

test("page.tsx's own source reads tender_packs.intake / tenders.intake with the same precedence intake-card.tsx already uses, and passes it to CoverPagePreview", () => {
  const src = readFileSync(join(HERE, "page.tsx"), "utf8");
  assert.match(src, /tenderPack\?\.intake\s*\?\?\s*tenderFacts\?\.intake/, "must prefer tender_packs.intake over tenders.intake, matching process_pack_jobs.py's gather()");
  assert.match(src, /deliveryAddress=\{intake\?\.delivery_address\?\.lines/, "must pass the real delivery address through to CoverPagePreview");
  assert.match(src, /from\("tenders"\)[\s\S]{0,400}intake/, "the tenders select must actually request the intake column");
  assert.match(src, /from\("tender_packs"\)[\s\S]{0,400}intake/, "the tender_packs select must actually request the intake column");
});
