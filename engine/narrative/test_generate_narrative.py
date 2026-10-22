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
        self.calls.append(kw)
        return self._responses.pop(0)


def _sections_json(heading_text, paragraph_text):
    return json.dumps({"sections": [
        {"heading": heading_text, "kind": "prose", "paragraphs": [paragraph_text], "bullets": []},
    ]})


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
    sections, meta = gn.call_llm("system prompt", "user message", client=client)
    kw = client.calls[0]
    check("model/fallback/beta match the CV extraction convention",
          kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"])
    check("structured json_schema output requested", kw["output_config"]["format"]["type"] == "json_schema")
    check("the system prompt is sent as system, not folded into the user message", kw["system"] == "system prompt")
    check("sections are parsed back out correctly", sections[0]["heading"] == "Introduction")


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
    client = StubClient([StubResponse(_sections_json("Introduction", "We are Mahlangu Civils, a distinct firm."))])
    result = gn.generate_with_uniqueness_check(CONTEXT, other_texts=[], client=client)
    check("only one LLM call made when nothing else to compare against", len(client.calls) == 1)
    check("not flagged", result["similarity_flagged"] is False)
    check("not regenerated", result["regenerated_for_distinctness"] is False)


def test_uniqueness_check_retries_once_when_the_first_draft_is_too_similar():
    near_duplicate_first_draft = _sections_json(
        "Introduction", "We propose a phased construction methodology with weekly site meetings.")
    distinct_retry_draft = _sections_json(
        "Introduction", "Mahlangu Civils will deploy its own grader fleet and dedicated supervision team.")
    other_company_text = "We propose a phased construction methodology, with weekly site meetings!"

    client = StubClient([StubResponse(near_duplicate_first_draft), StubResponse(distinct_retry_draft)])
    result = gn.generate_with_uniqueness_check(CONTEXT, other_texts=[other_company_text], client=client,
                                                threshold=0.6)
    check("exactly two LLM calls made (first draft + one retry)", len(client.calls) == 2, len(client.calls))
    check("regenerated_for_distinctness is recorded as true", result["regenerated_for_distinctness"] is True)
    check("the final result reflects the regenerated (distinct) draft",
          "grader fleet" in result["plain_text"])
    check("the final similarity score is the retry's score, not the first draft's", result["similarity_flagged"] is False)


def test_uniqueness_check_never_retries_more_than_once_even_if_still_similar():
    near_duplicate_both_times = _sections_json(
        "Introduction", "We propose a phased construction methodology with weekly site meetings.")
    other_company_text = "We propose a phased construction methodology, with weekly site meetings!"

    client = StubClient([StubResponse(near_duplicate_both_times), StubResponse(near_duplicate_both_times)])
    result = gn.generate_with_uniqueness_check(CONTEXT, other_texts=[other_company_text], client=client,
                                                threshold=0.6)
    check("exactly two LLM calls made, never a third", len(client.calls) == 2, len(client.calls))
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


def main():
    test_call_llm_sends_structured_output_request_matching_convention()
    test_call_llm_raises_generation_failed_on_missing_sections()
    test_call_llm_raises_generation_failed_on_invalid_json()
    test_uniqueness_check_does_not_retry_when_no_similar_documents_exist()
    test_uniqueness_check_retries_once_when_the_first_draft_is_too_similar()
    test_uniqueness_check_never_retries_more_than_once_even_if_still_similar()
    test_invalid_style_values_are_rejected_before_any_llm_call()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
