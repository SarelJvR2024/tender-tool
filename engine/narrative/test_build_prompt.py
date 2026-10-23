import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_prompt import (
    build_distinctness_retry_user_message,
    build_review_user_message,
    build_system_prompt,
    build_user_message,
    output_schema,
    review_output_schema,
    sections_to_plain_text,
)

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


STYLE = {"length": "standard", "detail": "detailed", "visual": "structured"}

CONTEXT = {
    "kind": "methodology",
    "tender": {
        "contract_no": "N.004-010-2026/1F", "title": "Rehabilitation of National Route N4",
        "buyer": "SANRAL", "closing_date": "2026-11-15",
        "scope_summary": "Pavement rehabilitation over 40km",
    },
    "company": {
        "legal_name": "Mahlangu Civils (Pty) Ltd", "csd_trading_name": "Mahlangu Civils",
        "cidb_grading": "5CE", "bee_level": 2, "total_employees": 18,
        "ecsa_registered_staff_count": 2,
        "how_we_work": "We run every site with a single accountable site agent and weekly client walkthroughs.",
    },
    "key_people": [
        {"name": "Thabo Mahlangu", "role": "Site Agent", "ecsa_level": "Professional Engineer",
         "highest_description": "BEng Civil Engineering", "years_experience": 18},
    ],
    "experience": [
        {"project_name": "N3 Resurfacing Phase 2", "client_name": "SANRAL", "scope_summary": "25km resurfacing",
         "value_rm": 42.5, "completion_date": "2024-06-01", "performance_rating": "good"},
    ],
    "user_guidance": "Please emphasise our safety record and local labour commitments.",
}


def test_system_prompt_names_the_right_document_kind():
    cover_letter_prompt = build_system_prompt("cover_letter", STYLE)
    methodology_prompt = build_system_prompt("methodology", STYLE)
    check("cover_letter kind produces a cover-letter prompt", "cover letter" in cover_letter_prompt)
    check("methodology kind produces a methodology prompt", "methodology statement" in methodology_prompt)


def test_system_prompt_forbids_inventing_facts():
    prompt = build_system_prompt("methodology", STYLE)
    check("the prompt explicitly forbids inventing projects/people/numbers",
          "Never invent" in prompt)


def test_system_prompt_protects_how_we_work_voice():
    prompt = build_system_prompt("methodology", STYLE)
    check("the prompt tells the model to draw on how_we_work's real content, not substitute it",
          "authentic voice" in prompt or "how we work" in prompt.lower())


def test_system_prompt_forbids_generic_filler():
    prompt = build_system_prompt("methodology", STYLE)
    check("the prompt names and forbids a concrete generic phrase",
          "committed to excellence" in prompt)


def test_system_prompt_reflects_length_detail_visual_style():
    concise_plain = build_system_prompt("methodology", {"length": "concise", "detail": "high_level", "visual": "plain"})
    thorough_tech = build_system_prompt("methodology", {"length": "thorough", "detail": "highly_technical", "visual": "visual_rich"})
    check("concise style asks for a short word count", "300-500" in concise_plain)
    check("thorough style asks for a longer word count", "1200-1800" in thorough_tech)
    check("highly_technical style asks for technical specificity", "highly technical" in thorough_tech.lower())
    check("the two style prompts actually differ", concise_plain != thorough_tech)


def test_user_message_includes_every_fact():
    message = build_user_message(CONTEXT)
    for expected in ["Mahlangu Civils", "5CE", "N.004-010-2026/1F", "SANRAL", "Thabo Mahlangu",
                      "N3 Resurfacing Phase 2", "42.5"]:
        check(f"user message includes '{expected}'", expected in message)


def test_user_message_includes_how_we_work_verbatim():
    message = build_user_message(CONTEXT)
    check("how_we_work's exact text appears in the user message",
          "single accountable site agent" in message)


def test_user_message_includes_user_guidance():
    message = build_user_message(CONTEXT)
    check("the requester's own guidance text is included",
          "safety record and local labour" in message)


def test_user_message_with_no_people_or_experience_does_not_invent_placeholders():
    bare_context = {**CONTEXT, "key_people": [], "experience": []}
    message = build_user_message(bare_context)
    check("no key people -> explicit instruction not to invent any", "do not invent any names" in message)
    check("no experience -> explicit instruction not to invent any", "do not invent or imply any past projects" in message)


def test_output_schema_matches_sections_to_plain_text_shape():
    schema = output_schema()
    section_props = schema["properties"]["sections"]["items"]["properties"]
    check("schema sections have heading/kind/paragraphs/bullets",
          set(section_props) == {"heading", "kind", "paragraphs", "bullets"})


def test_sections_to_plain_text_flattens_prose_and_bullets():
    sections = [
        {"heading": "Introduction", "kind": "prose", "paragraphs": ["First para.", "Second para."], "bullets": []},
        {"heading": "Our Team", "kind": "bullet_list", "paragraphs": [], "bullets": ["Thabo Mahlangu", "Jane Doe"]},
    ]
    text = sections_to_plain_text(sections)
    check("prose heading is present", "Introduction" in text)
    check("prose paragraphs are present", "First para." in text and "Second para." in text)
    check("bullet heading is present", "Our Team" in text)
    check("bullets are rendered with a dash prefix", "- Thabo Mahlangu" in text)


def test_distinctness_retry_message_includes_original_context_and_warning():
    retry_message = build_distinctness_retry_user_message(CONTEXT, "a previous generic draft")
    check("retry message still contains the real company facts", "Mahlangu Civils" in retry_message)
    check("retry message explicitly flags the genericness problem", "too generically" in retry_message)
    check("retry message carries the previous draft for reference", "a previous generic draft" in retry_message)


def test_review_output_schema_adds_quality_fields_without_losing_sections():
    schema = review_output_schema()
    check("sections are still required, same shape as the generation schema",
          schema["properties"]["sections"] == output_schema()["properties"]["sections"])
    check("no_issues_found is a required boolean", schema["properties"]["no_issues_found"]["type"] == "boolean")
    check("review_notes is a required string", schema["properties"]["review_notes"]["type"] == "string")
    check("all three fields are required, nothing optional",
          set(schema["required"]) == {"sections", "no_issues_found", "review_notes"})


def test_review_user_message_names_the_right_document_kind():
    cover_letter_review = build_review_user_message({**CONTEXT, "kind": "cover_letter"}, [])
    methodology_review = build_review_user_message({**CONTEXT, "kind": "methodology"}, [])
    check("cover_letter kind produces a cover-letter review prompt", "cover letter" in cover_letter_review)
    check("methodology kind produces a methodology review prompt", "technical methodology statement" in methodology_review)


def test_review_user_message_asks_for_self_review_not_regeneration():
    message = build_review_user_message(CONTEXT, [])
    check("explicitly frames this as reviewing prior output", "review your own output" in message)
    check("explicitly allows and expects 'no issues found' as a real outcome", "No issues found" in message)
    check("tells the model to quote and fix, not just flag", "Quote exactly what is wrong" in message)


def test_review_user_message_includes_the_real_checklist():
    message = build_review_user_message(CONTEXT, [])
    for expected in ["traces to a fact explicitly given", "generic, interchangeable filler",
                      "requester's own stated guidance", "different company, tender, or buyer"]:
        check(f"review checklist includes '{expected}'", expected in message)


def main():
    test_system_prompt_names_the_right_document_kind()
    test_system_prompt_forbids_inventing_facts()
    test_system_prompt_protects_how_we_work_voice()
    test_system_prompt_forbids_generic_filler()
    test_system_prompt_reflects_length_detail_visual_style()
    test_user_message_includes_every_fact()
    test_user_message_includes_how_we_work_verbatim()
    test_user_message_includes_user_guidance()
    test_user_message_with_no_people_or_experience_does_not_invent_placeholders()
    test_output_schema_matches_sections_to_plain_text_shape()
    test_sections_to_plain_text_flattens_prose_and_bullets()
    test_distinctness_retry_message_includes_original_context_and_warning()
    test_review_output_schema_adds_quality_fields_without_losing_sections()
    test_review_user_message_names_the_right_document_kind()
    test_review_user_message_asks_for_self_review_not_regeneration()
    test_review_user_message_includes_the_real_checklist()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
