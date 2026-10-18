import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CIDB_GRADING_TABLE,
  requiredGradeForValue,
  bandForGrade,
  gradeSufficientForValue,
} from "./cidbGrading.ts";

test("the table has 9 grades, contiguous with no gaps or overlaps, Grade 9 uncapped", () => {
  assert.equal(CIDB_GRADING_TABLE.length, 9);
  assert.equal(CIDB_GRADING_TABLE[0].grade, 1);
  assert.equal(CIDB_GRADING_TABLE[0].minValue, 0);
  assert.equal(CIDB_GRADING_TABLE.at(-1)!.grade, 9);
  assert.equal(CIDB_GRADING_TABLE.at(-1)!.maxValue, null);
  for (let i = 1; i < CIDB_GRADING_TABLE.length; i++) {
    assert.equal(
      CIDB_GRADING_TABLE[i].minValue,
      CIDB_GRADING_TABLE[i - 1].maxValue! + 1,
      `grade ${CIDB_GRADING_TABLE[i].grade} must start immediately after grade ${CIDB_GRADING_TABLE[i - 1].grade} ends`
    );
  }
});

test("requiredGradeForValue: known reference values from the published table", () => {
  assert.equal(requiredGradeForValue(0), 1);
  assert.equal(requiredGradeForValue(200_000), 1); // exact boundary -> lower grade
  assert.equal(requiredGradeForValue(200_001), 2); // just over -> next grade
  assert.equal(requiredGradeForValue(650_000), 2);
  assert.equal(requiredGradeForValue(2_000_000), 3);
  assert.equal(requiredGradeForValue(6_500_000), 5);
  assert.equal(requiredGradeForValue(13_000_000), 6);
  assert.equal(requiredGradeForValue(40_000_000), 7);
  assert.equal(requiredGradeForValue(130_000_000), 8);
  assert.equal(requiredGradeForValue(130_000_001), 9);
  assert.equal(requiredGradeForValue(500_000_000), 9); // uncapped
});

test("requiredGradeForValue rejects invalid input", () => {
  assert.equal(requiredGradeForValue(-1), null);
  assert.equal(requiredGradeForValue(NaN), null);
});

test("bandForGrade round-trips with the table, and rejects out-of-range grades", () => {
  assert.deepEqual(bandForGrade(1), { grade: 1, minValue: 0, maxValue: 200_000 });
  assert.equal(bandForGrade(0), null);
  assert.equal(bandForGrade(10), null);
});

test("gradeSufficientForValue: holding exactly the required grade is sufficient, one below is not", () => {
  // R9m requires Grade 6 (6.5m-13m band).
  assert.equal(gradeSufficientForValue(6, 9_000_000), true);
  assert.equal(gradeSufficientForValue(5, 9_000_000), false);
  assert.equal(gradeSufficientForValue(9, 9_000_000), true); // higher grade always sufficient
});
