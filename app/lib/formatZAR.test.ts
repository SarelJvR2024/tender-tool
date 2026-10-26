import { test } from "node:test";
import assert from "node:assert/strict";
import { formatZAR } from "./formatZAR.ts";

test("formatZAR: whole number gets fixed 2 decimals and comma grouping", () => {
  assert.equal(formatZAR(1250000), "R 1,250,000.00");
});

test("formatZAR: fractional value keeps 2 decimals, never more", () => {
  assert.equal(formatZAR(1234.5), "R 1,234.50");
  assert.equal(formatZAR(1234.567), "R 1,234.57");
});

test("formatZAR: null/undefined/NaN render an em-dash, never 'R 0' or a crash", () => {
  assert.equal(formatZAR(null), "—");
  assert.equal(formatZAR(undefined), "—");
  assert.equal(formatZAR(Number.NaN), "—");
  assert.equal(formatZAR("not a number"), "—");
});

test("formatZAR: accepts a numeric string the same as a number (Supabase numeric columns arrive as strings)", () => {
  assert.equal(formatZAR("1250000"), "R 1,250,000.00");
});

test("formatZAR: negative values keep the sign before the R, not inside it", () => {
  assert.equal(formatZAR(-500), "-R 500.00");
});

test("formatZAR: vat 'incl' appends the real South African rate, never a vague 'incl. VAT'", () => {
  assert.equal(formatZAR(1150, { vat: "incl" }), "R 1,150.00 (incl. 15% VAT)");
});

test("formatZAR: vat 'excl' appends the plain exclusive label", () => {
  assert.equal(formatZAR(1000, { vat: "excl" }), "R 1,000.00 (excl. VAT)");
});

test("formatZAR: vat 'raw' and omitted vat both render no suffix at all", () => {
  assert.equal(formatZAR(1000, { vat: "raw" }), "R 1,000.00");
  assert.equal(formatZAR(1000), "R 1,000.00");
});

test("formatZAR: compact renders millions with one decimal, dropped when whole", () => {
  assert.equal(formatZAR(1_500_000, { compact: true }), "R 1.5M");
  assert.equal(formatZAR(2_000_000, { compact: true }), "R 2M");
});

test("formatZAR: compact renders thousands as 'k', dropped decimal when whole", () => {
  assert.equal(formatZAR(250_000, { compact: true }), "R 250k");
  assert.equal(formatZAR(1_500, { compact: true }), "R 1.5k");
});

test("formatZAR: compact below 1,000 falls back to the full 2-decimal form", () => {
  assert.equal(formatZAR(500, { compact: true }), "R 500.00");
});

test("formatZAR: compact and vat combine (compact magnitude, vat suffix still appended)", () => {
  assert.equal(formatZAR(1_500_000, { compact: true, vat: "excl" }), "R 1.5M (excl. VAT)");
});

test("formatZAR: zero is a real value, not treated as missing", () => {
  assert.equal(formatZAR(0), "R 0.00");
});
