import json
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import generate_narrative as gn  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class StubResponse:
    def __init__(self, text, stop_reason="end_turn"):
        self.content = [types.SimpleNamespace(type="text", text=text)]
        self.stop_reason, self.model = stop_reason, "stub-model"


class StubClient:
    """Stands in for anthropic.Anthropic() - records each request, returns
    the next response from a queue (so a test can script a first-draft-
    then-retry sequence), same shape as engine/cv/test_extract_cv_fields.py's
    own StubClient."""
    def __init__(self, responses):
        self.calls = []
        self._responses = list(responses)
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(create=self._create))

    def _create(self, **kw):
        # Snapshot messages at call time - run_review_passes keeps appending
        # to the SAME list object after each call returns (that's the real,
        # correct multi-turn chaining), so storing a bare reference here
        # would let later appends leak backward into an earlier call's
        # recorded state. The real Anthropic SDK serializes the request
        # synchronously before returning, so this mutation-after-the-fact
        # never happens for real - this copy only fixes the stub.
        if "messages" in kw:
            kw = {**kw, "messages": list(kw["messages"])}
        self.calls.append(kw)
        return self._responses.pop(0)


def _sections_json(heading_text, paragraph_text):
    return json.dumps({"sections": [
        {"heading": heading_text, "kind": "prose", "paragraphs": [paragraph_text], "bullets": []},
    ]})


def _review_json(heading_text, paragraph_text, no_issues_found, review_notes="No issues found on this pass."):
    return json.dumps({
        "no_issues_found": no_issues_found,
        "review_notes": review_notes,
        "sections": [{"heading": heading_text, "kind": "prose", "paragraphs": [paragraph_text], "bullets": []}],
    })


CONTEXT = {
    "kind": "methodology",
    "tender": {"contract_no": "N.004-010-2026/1F", "title": "N4 Rehabilitation", "buyer": "SANRAL",
               "closing_date": "2026-11-15"},
    "company": {"legal_name": "Mahlangu Civils", "how_we_work": "We run a single accountable site agent."},
    "key_people": [],
    "experience": [],
    "user_guidance": "",
    "style": {"length": "standard", "detail": "detailed", "visual": "structured"},
}


def test_call_llm_sends_structured_output_request_matching_convention():
    client = StubClient([StubResponse(_sections_json("Introduction", "We are Mahlangu Civils."))])
    parsed, meta = gn.call_llm("system prompt", "user message", client=client)
    kw = client.calls[0]
    check("model/fallback/beta match the CV extraction convention",
          kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"])
    check("structured json_schema output requested", kw["output_config"]["format"]["type"] == "json_schema")
    check("the system prompt is sent as system, not folded into the user message", kw["system"] == "system prompt")
    check("a bare string user message is wrapped into a single-turn messages list",
          kw["messages"] == [{"role": "user", "content": "user message"}])
    check("sections are parsed back out correctly", parsed["sections"][0]["heading"] == "Introduction")


def test_call_llm_accepts_a_real_multi_turn_messages_list():
    client = StubClient([StubResponse(_sections_json("Introduction", "Revised."))])
    messages = [
        {"role": "user", "content": "first turn"},
        {"role": "assistant", "content": "{}"},
        {"role": "user", "content": "review turn"},
    ]
    parsed, _meta = gn.call_llm("sp", messages, client=client)
    check("the exact multi-turn messages list is sent through unchanged", client.calls[0]["messages"] == messages)
    check("sections still parse correctly from a multi-turn call", parsed["sections"][0]["paragraphs"] == ["Revised."])


def test_call_llm_raises_generation_failed_on_missing_sections():
    client = StubClient([StubResponse(json.dumps({"sections": []}))])
    try:
        gn.call_llm("sp", "um", client=client)
        check("empty sections should have raised GenerationFailed", False)
    except gn.GenerationFailed:
        check("empty sections raises GenerationFailed", True)


def test_call_llm_raises_generation_failed_on_invalid_json():
    client = StubClient([StubResponse("not valid json at all")])
    try:
        gn.call_llm("sp", "um", client=client)
        check("invalid JSON should have raised GenerationFailed", False)
    except gn.GenerationFailed:
        check("invalid JSON raises GenerationFailed", True)


def test_uniqueness_check_does_not_retry_when_no_similar_documents_exist():
    client = StubClient([
        StubResponse(_sections_json("Introduction", "We are Mahlangu Civils, a distinct firm.")),
        StubResponse(_review_json("Introduction", "We are Mahlangu Civils, a distinct firm.", no_issues_found=True)),
    ])
    result = gn.generate_with_uniqueness_check(CONTEXT, other_texts=[], client=client)
    check("one generation call plus one clean review pass", len(client.calls) == 2, len(client.calls))
    check("not flagged", result["similarity_flagged"] is False)
    check("not regenerated", result["regenerated_for_distinctness"] is False)
    check("quality review ran once and found nothing wrong",
          result["quality_review_passes"] == 1 and result["quality_flagged"] is False)


def test_uniqueness_check_retries_once_when_the_first_draft_is_too_similar():
    near_duplicate_first_draft = _sections_json(
        "Introduction", "We propose a phased construction methodology with weekly site meetings.")
    distinct_retry_draft = _sections_json(
        "Introduction", "Mahlangu Civils will deploy its own grader fleet and dedicated supervision team.")
    other_company_text = "We propose a phased construction methodology, with weekly site meetings!"

    client = StubClient([
        StubResponse(near_duplicate_first_draft),
        StubResponse(distinct_retry_draft),
        StubResponse(_review_json("Introduction", "Mahlangu Civils will deploy its own grader fleet and dedicated supervision team.", no_issues_found=True)),
    ])
    result = gn.generate_with_uniqueness_check(CONTEXT, other_texts=[other_company_text], client=client,
                                                threshold=0.6)
    check("first draft + one distinctness retry + one clean review pass", len(client.calls) == 3, len(client.calls))
    check("regenerated_for_distinctness is recorded as true", result["regenerated_for_distinctness"] is True)
    check("the final result reflects the regenerated (distinct) draft",
          "grader fleet" in result["plain_text"])
    check("the final similarity score is the retry's score, not the first draft's", result["similarity_flagged"] is False)


def test_uniqueness_check_never_retries_more_than_once_even_if_still_similar():
    near_duplicate_both_times = _sections_json(
        "Introduction", "We propose a phased construction methodology with weekly site meetings.")
    other_company_text = "We propose a phased construction methodology, with weekly site meetings!"

    client = StubClient([
        StubResponse(near_duplicate_both_times),
        StubResponse(near_duplicate_both_times),
        StubResponse(_review_json("Introduction", "We propose a phased construction methodology with weekly site meetings.", no_issues_found=True)),
    ])
    result = gn.generate_with_uniqueness_check(CONTEXT, other_texts=[other_company_text], client=client,
                                                threshold=0.6)
    check("two generation calls plus one clean review pass, never a third generation call",
          len(client.calls) == 3, len(client.calls))
    check("still flagged after the one retry - honestly reported, not silently accepted",
          result["similarity_flagged"] is True)
    check("regenerated_for_distinctness is still recorded as true", result["regenerated_for_distinctness"] is True)


def test_invalid_style_values_are_rejected_before_any_llm_call():
    bad_context = {**CONTEXT, "style": {"length": "extremely-long", "detail": "detailed", "visual": "structured"}}
    client = StubClient([])
    try:
        gn.generate_with_uniqueness_check(bad_context, other_texts=[], client=client)
        check("an invalid style value should have raised ValueError", False)
    except ValueError:
        check("an invalid style value raises ValueError before calling the LLM", True)
    check("no LLM call was made for an invalid request", len(client.calls) == 0)


def test_review_passes_stop_as_soon_as_a_pass_finds_nothing_wrong():
    client = StubClient([_review_response_only(no_issues_found=True)])
    sections, meta = gn.run_review_passes(CONTEXT, _plain_sections(), client=client)
    check("exactly one review call made", len(client.calls) == 1)
    check("passes_run is 1", meta["passes_run"] == 1)
    check("not flagged for human review - a clean pass is a clean result", meta["quality_flagged"] is False)


def test_review_passes_chain_corrections_into_the_next_pass():
    client = StubClient([
        StubResponse(_review_json("Introduction", "First correction.", no_issues_found=False, review_notes="Fixed an invented number.")),
        StubResponse(_review_json("Introduction", "First correction.", no_issues_found=True)),
    ])
    sections, meta = gn.run_review_passes(CONTEXT, _plain_sections(), client=client)
    check("two review calls made - one found an issue, the next confirmed it clean", len(client.calls) == 2)
    check("the corrected text from pass 1 is what pass 2 actually reviewed",
          "First correction" in json.dumps(client.calls[1]["messages"]))
    check("final sections reflect the last pass's output", sections[0]["paragraphs"] == ["First correction."])
    check("not flagged - the issue was found AND fixed before passes ran out", meta["quality_flagged"] is False)
    check("both passes' notes are kept", len(meta["notes"]) == 2)


def test_review_passes_cap_at_three_and_flag_if_still_finding_issues():
    still_wrong = _review_json("Introduction", "Still not quite right.", no_issues_found=False, review_notes="Found another issue.")
    client = StubClient([StubResponse(still_wrong), StubResponse(still_wrong), StubResponse(still_wrong)])
    sections, meta = gn.run_review_passes(CONTEXT, _plain_sections(), client=client)
    check("exactly three review calls made, never a fourth", len(client.calls) == 3, len(client.calls))
    check("flagged for human review - still finding issues on the last allowed pass",
          meta["quality_flagged"] is True)
    check("passes_run is 3", meta["passes_run"] == 3)


def test_review_turns_are_sent_as_a_real_multi_turn_conversation():
    """The review prompt must be a follow-up turn in the SAME conversation
    the draft was generated in - not a fresh, context-free prompt that
    reconstructs the draft as text. Confirms the messages array actually
    carries the original user turn and the model's own prior assistant
    turn, in order."""
    client = StubClient([_review_response_only(no_issues_found=True)])
    gn.run_review_passes(CONTEXT, _plain_sections(), client=client)
    messages = client.calls[0]["messages"]
    check("conversation starts with the original generation user turn", messages[0]["role"] == "user")
    check("the model's own prior draft is present as a real assistant turn", messages[1]["role"] == "assistant")
    check("the review instruction is the final turn, sent as a new user message", messages[-1]["role"] == "user")
    check("the review turn actually asks the model to review, not regenerate from scratch",
          "review your own output" in messages[-1]["content"])


def _plain_sections():
    return [{"heading": "Introduction", "kind": "prose", "paragraphs": ["Draft text."], "bullets": []}]


def _review_response_only(no_issues_found):
    return StubResponse(_review_json("Introduction", "Draft text.", no_issues_found=no_issues_found))


def main():
    test_call_llm_sends_structured_output_request_matching_convention()
    test_call_llm_accepts_a_real_multi_turn_messages_list()
    test_call_llm_raises_generation_failed_on_missing_sections()
    test_call_llm_raises_generation_failed_on_invalid_json()
    test_uniqueness_check_does_not_retry_when_no_similar_documents_exist()
    test_uniqueness_check_retries_once_when_the_first_draft_is_too_similar()
    test_uniqueness_check_never_retries_more_than_once_even_if_still_similar()
    test_invalid_style_values_are_rejected_before_any_llm_call()
    test_review_passes_stop_as_soon_as_a_pass_finds_nothing_wrong()
    test_review_passes_chain_corrections_into_the_next_pass()
    test_review_passes_cap_at_three_and_flag_if_still_finding_issues()
    test_review_turns_are_sent_as_a_real_multi_turn_conversation()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
