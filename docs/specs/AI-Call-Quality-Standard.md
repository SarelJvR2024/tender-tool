# AI call quality standard: scenario-specific prompts, never the first answer

Sarel, 2026-10-22, verbatim: "we need to define detailed prompts for each step each scenrario,
each tender type, each document so that our engines dont just give the first answer and response
and think it is correct. it must run through a number of promprs and reviews to make sure we alway
devlier a high quality, 100% aurate and correct and proffesional response, documents, submissions.
i see that the more the ai an engines is prompted the ebter the results. neve be stisfied with your
first anser and output, always review it and see where you can improve, run that 3 times to make
sure there are no mistakes and you keep improving."

This is the standing standard for **any** AI call this app makes - today's three real call sites
(`engine/company_documents.py` generating a letter/document from a company's own guideline,
`engine/cv/extract_cv_fields.py` extracting a person's CV fields, `engine/onboarding/classify_documents.py`
classifying an uploaded document) and every one built after this. It is a Gap item on the roadmap
(`Tender-Tool-Competitor-Feature-Deep-Dive.md` #36) because today's three call sites are
single-pass - this document defines the standard; retrofitting them is separate follow-up work,
not done by writing this standard.

It has two parts, both required, not either/or: a specific prompt for the specific job (never one
generic prompt reused across different jobs), and a mandatory self-review loop that never treats
a model's first output as the answer.

## 1. The prompt itself must be specific to the step, scenario, tender type and document

No "summarise this document" or "extract the fields from this" prompt reused across unrelated
jobs. Every call's system prompt states, in the same concrete, no-guessing style this codebase's
real prompts already use (see `extract_cv_fields.py`'s `SYSTEM_PROMPT` and
`classify_documents.py`'s - both already follow this, which is why they're the examples below,
not a new invention):

- **Exactly what the output is for** and who checks it before it's relied on (a review screen, a
  sworn tender form, a real compliance record) - the real cost of a wrong value, stated plainly,
  not left implicit.
- **The specific document/tender-type rules that apply here and nowhere else** - SANRAL's own
  form fields are not the same prompt as a general SBD1/4/6.1 form, a CV is not the same prompt as
  a CIDB certificate, a letter of authority is not the same prompt as a B-BBEE certificate. If two
  jobs would otherwise share one prompt, ask whether they are really the same job first.
- **The one honesty rule every real prompt in this codebase already has, stated explicitly**:
  when the source material doesn't clearly state something, the field is null/flagged, never
  guessed or inferred - "evidence" is a verbatim quote from the real source, checked afterward
  against it, not asserted from memory or pattern-matching. A new prompt that skips this is not
  following the standard, whatever else it gets right.
- **What "good" looks like for this specific output** - a plain checklist of what a human reviewer
  of the same material would check (which fields are compliance-sensitive and must be exactly
  right - B-BBEE level, CIDB grade, registration numbers, dates, rand amounts; what "professional
  tone" means for this specific document type; what a complete answer includes for this specific
  tender type). This checklist is what step 2's review pass actually checks against - vague
  "double-check your work" instructions produce vague re-checks.

## 2. Never the first answer: a mandatory generate -> review -> revise loop, up to 3 passes

A model's first output is a draft, not a result, until it has survived its own review. Chain this
review turn after any generation call whose output will be shown to a user, saved as a record, or
put into a real submission - the same bar `fill_financial.py`'s own docstring and every other
"we stop, we never guess" convention in this codebase already applies to a *computed* value,
applied here to a *generated* one.

Literal, reusable review prompt - fill in the three `{...}` placeholders for the specific job
(the task description names the exact output; the checklist should be the same one used to write
the generation prompt in part 1, not a generic list):

```
You just produced the {task_description} above.

Before this is treated as final, review your own output as if you were a strict, skeptical
colleague checking it before it reaches {who_relies_on_this} - not as its author defending it.
Read the source material and your own output again, side by side, and check specifically for:

{checklist}

For each issue you find:
- Quote exactly what is wrong and where (the specific field, sentence, or value).
- Fix it.
- If you are not sure something is wrong, say so rather than guessing a fix - never "fix"
  something that may already be correct, and never remove a null/flag that honestly reflects
  what the source material doesn't say.

If a genuine, line-by-line check finds nothing wrong, say so explicitly: "No issues found on this
pass." Do not manufacture a change just to have something to report.

Return exactly two things:
1. What you checked and what you changed, or "No issues found."
2. The corrected {task_description} in full - not a diff, not just the changed parts.
```

Run this review pass **up to 3 times**, chaining each pass's corrected output into the next
pass's input:

- Stop as soon as a pass reports "No issues found on this pass" - repeating after that spends
  tokens without improving anything real.
- If a pass changes something, run the next pass against the corrected version, not the original -
  each pass should be checking the best version so far, not re-finding the same issue.
- If pass 3 still finds a real issue, don't silently ship the "best effort" result: flag the
  output for human review the same way a low-confidence extracted field already is (never present
  an output that failed its own quality check as if it passed).

## Where this doesn't apply

A read-only classification/lookup whose output is immediately checked against ground truth by
other code (not relied on as-is) doesn't need the full 3-pass loop - the review is the downstream
check. This standard is for output a person or a real submission relies on directly. If it's
unclear which case a new call falls into, treat it as needing the loop; the cost of one extra
review pass is far smaller than the cost this document itself quotes Sarel naming - a wrong value
"on a sworn tender form."
