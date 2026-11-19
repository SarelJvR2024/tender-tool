import { test } from "node:test";
import assert from "node:assert/strict";
import { isActiveSanralScheduleTender } from "./sanral-schedules-logic.ts";

test("isActiveSanralScheduleTender - no tender_packs row at all stays listed (defensive; !inner join never actually produces this)", () => {
  assert.equal(isActiveSanralScheduleTender([]), true);
});

test("isActiveSanralScheduleTender - a null pipeline_stage stays listed", () => {
  assert.equal(isActiveSanralScheduleTender([{ pipeline_stage: null }]), true);
});

test("isActiveSanralScheduleTender - a genuinely in-progress stage stays listed", () => {
  assert.equal(isActiveSanralScheduleTender([{ pipeline_stage: "bidding" }]), true);
});

test("isActiveSanralScheduleTender - submitted is dropped", () => {
  assert.equal(isActiveSanralScheduleTender([{ pipeline_stage: "submitted" }]), false);
});

test("isActiveSanralScheduleTender - briefing_shortlisted is dropped", () => {
  assert.equal(isActiveSanralScheduleTender([{ pipeline_stage: "briefing_shortlisted" }]), false);
});

test("isActiveSanralScheduleTender - won is dropped", () => {
  assert.equal(isActiveSanralScheduleTender([{ pipeline_stage: "won" }]), false);
});

test("isActiveSanralScheduleTender - lost is dropped", () => {
  assert.equal(isActiveSanralScheduleTender([{ pipeline_stage: "lost" }]), false);
});
