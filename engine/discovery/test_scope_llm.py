"""
Tests for engine/discovery/scope_llm.py. No live Supabase and no Anthropic API
key needed - like test_extract_cv_fields.py, this does NOT test how well
Claude reads a tender document; it tests, against a stub client:

  1. The prompt is genuinely specific to THIS job - not a copy of the CV
     extraction prompt, and it names the SA-government-tender-specific things
     the task asked for (scattered scope headings, "the Contractor shall",
     SBD/MBD/BOQ form references).
  2. The review loop actually chains each pass's CORRECTED output into the
     next pass's input (not re-sending the original draft every time).
  3. It stops as soon as a review pass reports no issues.
  4. It caps at 3 review passes and flags needs_human_review, honestly,
     when pass 3 still finds something wrong - it never silently ships a
     "best effort" result as if it passed its own check.
  5. The too-short-to-bother and scope-not-found paths return None without
     fabricating a summary.
  6. call_llm_generate()'s request shape (model, schema, fallbacks) and a
     missing ANTHROPIC_API_KEY, against a stub client - same pattern as
     extract_cv_fields.py's own call_llm() test.

Usage: python3 engine/discovery/test_scope_llm.py
"""
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "cv"))
import scope_llm as sl  # noqa: E402
import extract_cv_fields as cv  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def expect_error(fn, error_type, needle, label):
    try:
        fn()
        check(False, f"{label}: should have raised {error_type.__name__}")
    except error_type as e:
        check(needle.lower() in str(e).lower(), f"{label}: expected {needle!r} in error, got {e!r}")


DOC_TEXT = ("TENDER DATA\n\nPart T1.2\n\nThe scope of this contract comprises the upgrade and resurfacing of "
            "12km of the R61 gravel road between Ward 4 and Ward 9, including the construction of 6 new "
            "stormwater culverts. The Contractor shall also be responsible for traffic accommodation for the "
            "duration of the works.\n\nSBD 4 and SBD 8 declarations must be completed by all bidders.\n") * 3


class StubResponse:
    def __init__(self, data, stop_reason="end_turn"):
        self.content = [types.SimpleNamespace(type="text", text=json.dumps(data))]
        self.stop_reason, self.model = stop_reason, "stub-model"
        self.usage = types.SimpleNamespace(input_tokens=1000, output_tokens=200)


class SequentialStubClient:
    """Stands in for anthropic.Anthropic(): returns each of `responses`, in
    order, one per call, and records every request's kwargs so the test can
    check what was actually sent on each pass."""
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        return StubResponse(self.responses[len(self.calls) - 1])


def draft(summary, quotes=("The Contractor shall also be responsible for traffic accommodation",)):
    return {"scope_found": True, "scope_summary": summary, "evidence_quotes": list(quotes),
            "reason_if_not_found": None}


def review(issues_found, corrected, note="No issues found on this pass."):
    return {"issues_found": issues_found, "what_checked_and_changed": note, "corrected": corrected}


# ---------------------------------------------------------------------------
# 1. Prompt specificity
# ---------------------------------------------------------------------------

def test_prompt_is_scenario_specific_not_a_copy_of_the_cv_prompt():
    check(sl.SYSTEM_PROMPT != cv.SYSTEM_PROMPT, "scope_llm's prompt must not be the CV extraction prompt verbatim")
    for needle in ("the Contractor shall", "SBD", "MBD", "Tender Data", "bill of quantities", "scope_found"):
        check(needle in sl.SYSTEM_PROMPT, f"prompt should mention {needle!r} (SA-tender-specific, not generic)")
    check("evidence_quotes" in sl.SYSTEM_PROMPT and "null" in sl.SYSTEM_PROMPT,
          "prompt must state the null-when-unclear + verbatim-evidence rule")
    check("specific to this tender" in sl.SYSTEM_PROMPT or "SPECIFIC to this tender" in sl.SYSTEM_PROMPT,
          "prompt must give a concrete checklist of what 'good' looks like for this output")


# ---------------------------------------------------------------------------
# 2 + 3. Review loop chains corrected output forward, stops early
# ---------------------------------------------------------------------------

def test_review_loop_chains_forward_and_stops_on_clean_pass():
    draft1 = draft("Resurfacing works on a road.")
    draft2 = draft("Upgrade and resurfacing of 12km of the R61 gravel road between Ward 4 and Ward 9, including "
                   "6 new stormwater culverts.")
    client = SequentialStubClient([
        draft1,                                   # generate
        review(True, draft2, "Vague first draft - too generic, missing the stated distance/quantities."),
        review(False, draft2),                     # second pass: clean - must stop here
    ])
    result = sl.extract_scope_with_review(DOC_TEXT, "Upgrade of the R61", "Provincial Dept of Transport", client=client)
    check(len(client.calls) == 3, f"should make exactly 1 generate + 2 review calls, made {len(client.calls)}")
    check(result["passes_run"] == 2, f"passes_run should be 2, got {result['passes_run']}")
    check(result["needs_human_review"] is False, "a clean final pass must not be flagged for human review")
    check(result["scope_summary"] == draft2["scope_summary"], "final result should be the corrected (2nd draft) summary")
    # The chaining check: the SECOND review call's own message must contain the
    # FIRST review's corrected output (draft2), not the original draft1 again.
    second_review_message = client.calls[2]["messages"][0]["content"]
    check(draft2["scope_summary"] in second_review_message,
          "2nd review pass must review the 1st review's CORRECTED output")
    check(draft1["scope_summary"] not in second_review_message,
          "2nd review pass must NOT re-send the original draft - that would mean it isn't chaining forward")


def test_review_loop_caps_at_3_passes_and_flags_needs_human_review():
    drafts = [draft(f"Draft version {i}") for i in range(5)]
    client = SequentialStubClient([
        drafts[0],                                            # generate
        review(True, drafts[1], "Issue 1"),
        review(True, drafts[2], "Issue 2"),
        review(True, drafts[3], "Issue 3 - still wrong after 3 passes"),
    ])
    result = sl.extract_scope_with_review(DOC_TEXT, client=client)
    check(len(client.calls) == 4, f"should make exactly 1 generate + 3 review calls (the cap), made {len(client.calls)}")
    check(result["passes_run"] == 3, f"passes_run should cap at 3, got {result['passes_run']}")
    check(result["needs_human_review"] is True,
          "a result that still has an issue after 3 passes must be flagged, never silently shipped")
    check(result["scope_summary"] == drafts[3]["scope_summary"],
          "the best available (3rd pass's corrected) version should still be returned, not discarded")
    check("Issue 3" in result["review_notes"], "the flagged review note should be the last pass's own finding")


# ---------------------------------------------------------------------------
# 5. Honest null paths
# ---------------------------------------------------------------------------

def test_too_short_text_returns_none_without_any_call():
    calls = []
    client = types.SimpleNamespace(beta=types.SimpleNamespace(
        messages=types.SimpleNamespace(create=lambda **kw: calls.append(kw) or StubResponse(draft("x")))))
    result = sl.extract_scope_summary_llm("too short", client=client)
    check(result is None, "text far below the minimum length should never trigger an LLM call")
    check(calls == [], "no API call should be made for text this short")


def test_scope_not_found_returns_none_not_a_fabricated_summary():
    not_found = {"scope_found": False, "scope_summary": None, "evidence_quotes": [],
                "reason_if_not_found": "Only administrative SBD content, no description of the actual work."}
    client = SequentialStubClient([not_found, review(False, not_found)])
    result = sl.extract_scope_summary_llm(DOC_TEXT, client=client)
    check(result is None, "scope_found=false must return None, never a fabricated scope_summary")


def test_extract_scope_summary_llm_flags_needs_human_review_in_the_note():
    d1, d2, d3, d4 = draft("v1"), draft("v2"), draft("v3"), draft("final, still imperfect")
    client = SequentialStubClient([d1, review(True, d2, "a"), review(True, d3, "b"), review(True, d4, "c - final issue")])
    result = sl.extract_scope_summary_llm(DOC_TEXT, client=client)
    check(result is not None, "a found scope should still be returned even when flagged")
    summary, source, needs_review, note = result
    check(summary == "final, still imperfect", f"should return the best (final) version, got {summary!r}")
    check(source == "document_scope_snippet", f"scope_source should say this came from the document, got {source!r}")
    check(needs_review is True, "needs_human_review should be surfaced to the caller")
    check("NEEDS HUMAN REVIEW" in note, f"the note should say this plainly, got {note!r}")


# ---------------------------------------------------------------------------
# 6. Call shape + missing key (same pattern as extract_cv_fields.py)
# ---------------------------------------------------------------------------

def test_call_llm_generate_request_shape():
    client = SequentialStubClient([draft("x")])
    sl.call_llm_generate(DOC_TEXT, "Upgrade of the R61", "SANRAL", client=client)
    kw = client.calls[0]
    check(kw["model"] == "claude-opus-5-5" and kw["fallbacks"] == "default"
          and kw["betas"] == ["server-side-fallback-2026-07-01"], "model, server-side fallback and beta header")
    check(kw["output_config"]["format"]["type"] == "json_schema" and kw["output_config"]["effort"] == "medium",
          "structured output with the generate schema")
    check("Upgrade of the R61" in kw["messages"][0]["content"] and "SANRAL" in kw["messages"][0]["content"],
          "title/buyer context should be included in the user message")
    check("<tender_document>" in kw["messages"][0]["content"], "document text sent inside <tender_document> tags")


def test_missing_api_key_raises_setup_error():
    saved = os.environ.pop("ANTHROPIC_API_KEY", None)
    try:
        expect_error(sl.default_llm_client, sl.SetupError, "ANTHROPIC_API_KEY is not set", "missing API key")
    finally:
        if saved:
            os.environ["ANTHROPIC_API_KEY"] = saved


def main():
    test_prompt_is_scenario_specific_not_a_copy_of_the_cv_prompt()
    test_review_loop_chains_forward_and_stops_on_clean_pass()
    test_review_loop_caps_at_3_passes_and_flags_needs_human_review()
    test_too_short_text_returns_none_without_any_call()
    test_scope_not_found_returns_none_not_a_fabricated_summary()
    test_extract_scope_summary_llm_flags_needs_human_review_in_the_note()
    test_call_llm_generate_request_shape()
    test_missing_api_key_raises_setup_error()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
