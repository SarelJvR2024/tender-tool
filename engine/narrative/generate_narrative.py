"""
Cover letter / methodology statement generator - the orchestrator tying
build_prompt.py (what to ask), the Anthropic Messages API (one structured-
output call, same convention as engine/cv/extract_cv_fields.py's call_llm),
uniqueness.py (the mechanical anti-collusion safeguard) and build_docx.py
(the real, editable .docx output) together into one generation request.

Usage (local, no Supabase - for manual testing against a context JSON):
    python3 generate_narrative.py <context.json> <out_dir> \
        [--model claude-opus-5-5]

context.json has the shape build_prompt.build_user_message() expects - see
test_build_prompt.py's CONTEXT fixture for a worked example.

Environment:
    ANTHROPIC_API_KEY       needed to actually generate (not needed to run
                            this module's own unit tests - prompt/docx/
                            uniqueness logic is tested without it)
    NARRATIVE_MODEL         optional, default claude-opus-5-5
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from build_docx import build_docx  # noqa: E402
from build_prompt import (  # noqa: E402
    build_distinctness_retry_user_message,
    build_system_prompt,
    build_user_message,
    output_schema,
    sections_to_plain_text,
)
from uniqueness import check_uniqueness  # noqa: E402

DEFAULT_MODEL = "claude-opus-5-5"
VALID_LENGTHS = ("concise", "standard", "thorough")
VALID_DETAILS = ("high_level", "detailed", "highly_technical")
VALID_VISUALS = ("plain", "structured", "visual_rich")
VALID_COLORS = ("navy", "charcoal", "forest", "burgundy", "slate")


class SetupError(Exception):
    """Something about this worker's own configuration is wrong (no API key,
    package missing, key rejected) - never the company's/tender's fault."""


class TransientError(Exception):
    """Worth retrying on the next poll (rate limit, a 5xx) - not a real failure."""


class GenerationFailed(Exception):
    """The model (or a programming error in this module) could not produce
    a usable draft - a real failure for this one request."""


def default_llm_client():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SetupError(
            "ANTHROPIC_API_KEY is not set on this worker, so narrative documents waiting for generation "
            "can't be written yet. They stay queued and will be processed once the key is set."
        )
    try:
        import anthropic
    except ImportError:
        raise SetupError("The 'anthropic' Python package isn't installed on this worker "
                         "(pip install -r engine/worker/requirements.txt).")
    return anthropic.Anthropic(api_key=key)


def call_llm(system_prompt, user_message, client=None, model=None):
    """One structured-output Messages API call. Returns (sections, meta)."""
    import anthropic
    client = client or default_llm_client()
    model = model or os.environ.get("NARRATIVE_MODEL") or DEFAULT_MODEL
    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=16000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": output_schema()}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        raise SetupError("ANTHROPIC_API_KEY was rejected by the Anthropic API (invalid or revoked key). "
                         "Narrative documents stay queued until a working key is set.")
    except anthropic.PermissionDeniedError as e:
        raise SetupError(f"The Anthropic API key lacks permission for this request: {e.message}")
    except anthropic.NotFoundError:
        raise SetupError(f"Model '{model}' was not found - check NARRATIVE_MODEL.")
    except anthropic.RateLimitError:
        raise TransientError("Anthropic API rate limit reached; will retry on the next pass.")
    except anthropic.BadRequestError as e:
        raise GenerationFailed(f"The AI service rejected this request: {e.message}")
    except anthropic.APIStatusError as e:
        if e.status_code >= 500:
            raise TransientError(f"Anthropic API server error {e.status_code}; will retry on the next pass.")
        raise GenerationFailed(f"The AI service returned an error ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise TransientError("Could not reach the Anthropic API; will retry on the next pass.")

    text_block = next((b for b in response.content if b.type == "text"), None)
    if text_block is None:
        raise GenerationFailed("The AI response had no text content block.")
    try:
        parsed = json.loads(text_block.text)
    except json.JSONDecodeError as e:
        raise GenerationFailed(f"The AI response was not valid JSON: {e}")
    sections = parsed.get("sections")
    if not sections:
        raise GenerationFailed("The AI response had no sections - nothing to generate a document from.")
    return sections, {"model": model, "stop_reason": response.stop_reason}


def _validate_style(style):
    if style["length"] not in VALID_LENGTHS:
        raise ValueError(f"style.length must be one of {VALID_LENGTHS}, got {style['length']!r}")
    if style["detail"] not in VALID_DETAILS:
        raise ValueError(f"style.detail must be one of {VALID_DETAILS}, got {style['detail']!r}")
    if style["visual"] not in VALID_VISUALS:
        raise ValueError(f"style.visual must be one of {VALID_VISUALS}, got {style['visual']!r}")


def generate_with_uniqueness_check(context, other_texts, client=None, model=None, threshold=None):
    """The full flow for one request: generate a draft, check it against
    every other company's ready document for the same tender+kind
    (other_texts - fetched by the caller using the service role, see
    process_narrative_jobs.py), and - if it reads too similar to one of
    them - regenerate ONCE with an explicit distinctness instruction before
    accepting the result. Never retries more than once: a draft that is
    still too similar after being told to be more specific is a real
    signal worth a human's attention, not something to keep hammering at
    automatically.

    Returns a dict: sections, plain_text, similarity_score, flagged,
    regenerated_for_distinctness.
    """
    _validate_style(context["style"])
    kwargs = {"threshold": threshold} if threshold is not None else {}

    system_prompt = build_system_prompt(context["kind"], context["style"])
    user_message = build_user_message(context)
    sections, _meta = call_llm(system_prompt, user_message, client=client, model=model)
    plain_text = sections_to_plain_text(sections)
    score, flagged, _idx = check_uniqueness(plain_text, other_texts, **kwargs)

    regenerated = False
    if flagged:
        retry_message = build_distinctness_retry_user_message(context, plain_text)
        sections, _meta = call_llm(system_prompt, retry_message, client=client, model=model)
        plain_text = sections_to_plain_text(sections)
        score, flagged, _idx = check_uniqueness(plain_text, other_texts, **kwargs)
        regenerated = True

    return {
        "sections": sections,
        "plain_text": plain_text,
        "similarity_score": score,
        "similarity_flagged": flagged,
        "regenerated_for_distinctness": regenerated,
    }


def _main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("context_json")
    parser.add_argument("out_dir")
    parser.add_argument("--model", default=None)
    args = parser.parse_args()

    with open(args.context_json) as f:
        context = json.load(f)

    result = generate_with_uniqueness_check(context, other_texts=[], model=args.model)
    os.makedirs(args.out_dir, exist_ok=True)
    kind_label = "cover_letter" if context["kind"] == "cover_letter" else "methodology"
    out_path = os.path.join(args.out_dir, f"{kind_label}.docx")
    title = "Cover Letter" if context["kind"] == "cover_letter" else "Methodology Statement"
    build_docx(
        result["sections"], out_path, title=title,
        subtitle=context["tender"].get("contract_no"),
        color_theme=context["style"].get("color", "navy"),
        visual_style=context["style"]["visual"],
    )
    print(f"Wrote {out_path}")
    print(f"Similarity score: {result['similarity_score']:.2f} (flagged: {result['similarity_flagged']})")


if __name__ == "__main__":
    _main()
