"""
Real, LLM-assisted scope-of-work summary extraction - the fallback for when
tender_enrichment.extract_scope_summary()'s own fast/free "SCOPE OF WORK"
heading regex finds nothing, but a tender's own document text is long enough
to plausibly contain real scope information anyway (common on SA government
tenders: the real scope sits under a differently-worded heading, is split
across several annexures, or is embedded in an SBD1/Part T1.2 narrative
rather than under one clean heading).

Built per docs/specs/AI-Call-Quality-Standard.md, read in full before writing
this module - both required parts, not either/or:

  1. A prompt SPECIFIC to this exact job (never the CV prompt, never a
     generic "summarise this" prompt) - see SYSTEM_PROMPT: what the output is
     for (a cross-tender market-intelligence record used for real scope/BOQ/
     quantity analysis and trend-spotting, not a sworn compliance document,
     but still relied on for real business insight), the SA-government-tender-
     specific rules (scope sections scattered across headings/annexures,
     "the Contractor/Service Provider shall", SBD/MBD/BOQ form references),
     the explicit null-when-unclear + verbatim-quote-evidence rule, and a
     concrete checklist of what "good" looks like for THIS output (specific
     to the tender's actual work vs. a generic restatement of the buyer;
     every claimed quantity/unit genuinely present in the source text, not
     inferred; every fact traceable to a real quote).
  2. The mandatory generate -> review -> revise loop, up to 3 passes, each
     chaining the PREVIOUS pass's corrected output into the next (never
     re-sending the original draft) - see extract_scope_with_review(). Stops
     as soon as a review pass reports "No issues found"; if pass 3 still
     finds a real issue, the result is flagged needs_human_review (never
     silently shipped as if it passed its own check).

Same LLM-calling convention as engine/cv/extract_cv_fields.py (this
codebase's own proven, tested call site - re-used deliberately, not
reinvented): client.beta.messages.create() with a json_schema structured
output, the server-side-fallback beta + "default" fallbacks pair, the same
SetupError/TransientError exception taxonomy over
AuthenticationError/PermissionDeniedError/NotFoundError/RateLimitError/
BadRequestError/APIStatusError, and the same <MODULE>_EXTRACTION_MODEL
env-var-override-with-DEFAULT_MODEL-fallback pattern.

This module makes real network/API calls when wired up with a real
`anthropic.Anthropic()` client and ANTHROPIC_API_KEY - deliberately never
called with no client/no key by tender_enrichment.enrich() itself (which
stays a pure function - see that module's docstring); the CLI
(tender_enrichment.py run()) is what actually supplies a real client, and
degrades to staying heuristic (logs it, never crashes the batch) when no key
is set or a call fails - same "a missing key leaves work queued, never
guessed at" discipline as extract_cv_fields.py's own default_llm_client().

Usage (local, one document's text, needs ANTHROPIC_API_KEY):
    python3 engine/discovery/scope_llm.py --file document.txt --title "..." --buyer "..."
"""
import argparse
import json
import os
import sys

DEFAULT_MODEL = "claude-opus-5-5"
MAX_REVIEW_PASSES = 3
MIN_TEXT_CHARS_FOR_LLM_PASS = 400  # below this, the regex/description fallback is already the honest answer
MAX_TEXT_CHARS_SENT = 60_000  # a real tender document can run to hundreds of pages; this is well past
                              # enough to find a scope section, and keeps one call's cost/latency bounded


class SetupError(Exception):
    """Server not set up (no API key, bad key, package missing). The caller
    should stay on the heuristic result, not crash the batch."""


class TransientError(Exception):
    """Rate limit / overload / network. The caller should stay on the
    heuristic result for this run and may retry a later one."""


# ---------------------------------------------------------------------------
# 1. The prompt - specific to THIS job (AI-Call-Quality-Standard.md part 1)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You read the text of a South African government/public-sector tender document to produce a scope-of-work summary for ONE tender. Your output is stored as a cross-tender market-intelligence record - used to spot patterns and trends in what kinds of work, at what scale, are being tendered across many tenders over time. It is not a sworn compliance document that goes into a submission, but it is still relied on for real business decisions (which markets to pursue, how pricing trends by scope), so an invented or generic scope is a real cost, not a harmless guess. When the document does not clearly state the scope, say so - never infer one from the buyer's name, sector or a generic restatement of the tender title.

Where to look (South African government tenders scatter their scope across several possible places, rarely one clean heading):
- A "SCOPE OF WORK", "SCOPE OF SERVICES", "TERMS OF REFERENCE", "BRIEF DESCRIPTION OF WORK" or "SPECIFICATION" heading or annexure.
- SBD1/MBD1 (Invitation to Bid) and Part T1 ("Tender Data") narrative fields, which often carry the real description even without a "scope" heading.
- Clauses using South African tender phrasing: "the Contractor shall...", "the Service Provider shall...", "the Works comprise...", "the appointed bidder will be required to...".
- A bill of quantities (BOQ), schedule of rates or pricing schedule heading/reference is a SIGNAL of real, physical scope (a BOQ exists for actual measurable work), but never read its own figures here - this summary is prose, not line items; a separate pass reads BOQ line items from a spreadsheet, not from this text.
- SBD/MBD form numbers (e.g. "SBD 1", "SBD 4", "MBD 6.1") are form REFERENCES, not scope - do not describe the forms themselves as the scope of work.

The honesty rule (the one rule every prompt in this codebase has, never skip it): when the document does not clearly state the scope, or states only generic/boilerplate text that could apply to any tender, set scope_found to false and scope_summary to null - do not invent a plausible-sounding scope from the buyer's sector or the tender's title alone. Every scope_summary you DO give must come with at least one verbatim quote in evidence_quotes, copied character-for-character from the document text - these are checked against the text afterward, and a summary whose quotes cannot be found is treated as unverified.

What "good" looks like for this specific output (this is what the review pass checks against):
- The summary is SPECIFIC to this tender's actual work (what is being built, supplied, maintained or assessed, at what scale/location where the text says so) - never a generic restatement of the buyer's name or sector ("[Buyer] requires professional services" is not a scope; "design and construction supervision of a 12km gravel road upgrade in Ward 4" is).
- Any quantity, unit, distance, duration or value mentioned in the summary is genuinely present in the source text, in those words or an obvious equivalent - never inferred from context or typical project size for that sector.
- Every claim in the summary is traceable to a real quote in evidence_quotes - no detail appears in the summary that isn't backed by a quote.
- Free of filler that doesn't describe real work ("the successful bidder shall perform the work as required", "...in accordance with the specifications" with no specification content given) - if that is genuinely all the document says, scope_found is false, not a dressed-up restatement of that filler.
- 1-4 sentences, plain professional language, no marketing tone.

Output fields:
- scope_found: true only when the document states real, specific scope information as described above.
- scope_summary: the summary (1-4 sentences) when scope_found is true, else null.
- evidence_quotes: 1-3 verbatim quotes from the document text that support scope_summary; empty when scope_found is false.
- reason_if_not_found: one sentence explaining why, when scope_found is false (e.g. "the document only contains administrative/SBD form content, no description of the actual work"); null when scope_found is true."""

REVIEW_PROMPT_TEMPLATE = """You just produced the scope-of-work summary above for this South African government tender document.

Before this is treated as final, review your own output as if you were a strict, skeptical colleague checking it before it is stored as a market-intelligence record that real business decisions will be based on - not as its author defending it. Read the source document text and your own output again, side by side, and check specifically for:

- Is the summary specific to THIS tender's actual work, or does it read as a generic restatement of the buyer's name/sector that could apply to almost any tender?
- Is every quantity, unit, distance, duration or value in the summary a quote (or an obvious equivalent) that genuinely appears in the document text - not something a typical project of this kind would have, if the text doesn't actually say it?
- Does every evidence_quotes entry actually appear in the document text, character for character (ignoring whitespace differences)?
- Is scope_found honestly false (with scope_summary null) when the document only has boilerplate/administrative content and no real description of the work - rather than a plausible-sounding scope stretched from thin material?
- Is the summary free of filler phrases that don't describe real work ("as required", "in accordance with the specifications" with nothing substantive attached)?

For each issue you find:
- Quote exactly what is wrong (the specific phrase or quote) and why.
- Fix it.
- If you are not sure something is wrong, say so rather than guessing a fix - never "fix" something that may already be correct, and never turn an honest scope_found=false into an invented scope_summary just to have something to report.

If a genuine, line-by-line check finds nothing wrong, say so explicitly: set issues_found to false and what_checked_and_changed to "No issues found on this pass." Do not manufacture a change just to have something to report.

Return the corrected scope_found/scope_summary/evidence_quotes/reason_if_not_found in full in `corrected` - not a diff, the complete corrected version - plus issues_found and what_checked_and_changed."""


def _nullable(schema):
    return {"anyOf": [schema, {"type": "null"}]}


def _generate_fields():
    return {
        "scope_found": {"type": "boolean"},
        "scope_summary": _nullable({"type": "string"}),
        "evidence_quotes": {"type": "array", "items": {"type": "string"}},
        "reason_if_not_found": _nullable({"type": "string"}),
    }


def generate_schema():
    return {"type": "object", "properties": _generate_fields(),
            "required": list(_generate_fields()), "additionalProperties": False}


def review_schema():
    props = {
        "issues_found": {"type": "boolean"},
        "what_checked_and_changed": {"type": "string"},
        "corrected": {"type": "object", "properties": _generate_fields(),
                      "required": list(_generate_fields()), "additionalProperties": False},
    }
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def build_user_message(document_text, title=None, buyer=None):
    header = []
    if title:
        header.append(f"Tender title: {title}")
    if buyer:
        header.append(f"Buyer: {buyer}")
    header_text = ("\n".join(header) + "\n\n") if header else ""
    return (f"{header_text}Here is the text extracted from this tender's own document(s). "
            f"<tender_document>\n{document_text[:MAX_TEXT_CHARS_SENT]}\n</tender_document>")


def build_review_message(document_text, draft, title=None, buyer=None):
    return (build_user_message(document_text, title, buyer)
            + "\n\nYour own previous output to review:\n" + json.dumps(draft, indent=2)
            + "\n\n" + REVIEW_PROMPT_TEMPLATE)


# ---------------------------------------------------------------------------
# The LLM call (same convention as engine/cv/extract_cv_fields.py)
# ---------------------------------------------------------------------------

def default_llm_client():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SetupError("ANTHROPIC_API_KEY is not set, so the LLM scope-summary fallback can't run. "
                         "Tenders without a clean 'SCOPE OF WORK' heading stay on the heuristic "
                         "description-text summary until a key is set.")
    try:
        import anthropic
    except ImportError:
        raise SetupError("The 'anthropic' Python package isn't installed "
                         "(pip install -r engine/worker/requirements.txt).")
    return anthropic.Anthropic(api_key=key)


def _call(client, model, system, user_message, schema):
    import anthropic
    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=4000,
            system=system,
            messages=[{"role": "user", "content": user_message}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        raise SetupError("ANTHROPIC_API_KEY was rejected by the Anthropic API (invalid or revoked key).")
    except anthropic.PermissionDeniedError as e:
        raise SetupError(f"The Anthropic API key lacks permission for this request: {e.message}")
    except anthropic.NotFoundError:
        raise SetupError(f"Model '{model}' was not found - check SCOPE_EXTRACTION_MODEL.")
    except anthropic.RateLimitError:
        raise TransientError("Anthropic API rate limit reached.")
    except anthropic.BadRequestError as e:
        raise TransientError(f"The AI service rejected this request: {e.message}")
    except anthropic.APIStatusError as e:
        if e.status_code >= 500:
            raise TransientError(f"Anthropic API server error {e.status_code}.")
        raise TransientError(f"The AI service returned an error ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise TransientError("Could not reach the Anthropic API.")

    if response.stop_reason == "refusal":
        raise TransientError("The AI service declined to read this document.")
    if response.stop_reason == "max_tokens":
        raise TransientError("The response was cut off before it could complete (max_tokens).")
    texts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
    if not texts:
        raise TransientError("The AI service returned no answer.")
    try:
        return json.loads(texts[-1])
    except json.JSONDecodeError:
        raise TransientError("The AI service's answer wasn't valid structured data.")


def call_llm_generate(document_text, title=None, buyer=None, client=None, model=None):
    client = client or default_llm_client()
    model = model or os.environ.get("SCOPE_EXTRACTION_MODEL") or DEFAULT_MODEL
    return _call(client, model, SYSTEM_PROMPT, build_user_message(document_text, title, buyer), generate_schema())


def call_llm_review(document_text, draft, title=None, buyer=None, client=None, model=None):
    client = client or default_llm_client()
    model = model or os.environ.get("SCOPE_EXTRACTION_MODEL") or DEFAULT_MODEL
    return _call(client, model, SYSTEM_PROMPT, build_review_message(document_text, draft, title, buyer),
                 review_schema())


# ---------------------------------------------------------------------------
# 2. Mandatory generate -> review -> revise loop, up to 3 passes
#    (AI-Call-Quality-Standard.md part 2)
# ---------------------------------------------------------------------------

def extract_scope_with_review(document_text, title=None, buyer=None, client=None, model=None,
                               max_review_passes=MAX_REVIEW_PASSES):
    """Runs the generate pass, then up to `max_review_passes` review passes,
    each one re-reading the SOURCE TEXT plus the PREVIOUS pass's own
    corrected output (never the original draft again) - the chaining the
    standard requires. Stops as soon as a review pass reports no issues.
    Returns a dict: {scope_found, scope_summary, evidence_quotes,
    reason_if_not_found, needs_human_review, review_notes, passes_run}.

    needs_human_review is true only when the LAST review pass run still
    reported a real issue after `max_review_passes` passes - the honest
    "don't silently ship a flawed result" flag the standard requires, never
    silently smoothed over."""
    current = call_llm_generate(document_text, title, buyer, client=client, model=model)
    needs_human_review = False
    review_notes = None
    passes_run = 0
    reviewed = None
    for _ in range(max_review_passes):
        passes_run += 1
        reviewed = call_llm_review(document_text, current, title, buyer, client=client, model=model)
        review_notes = reviewed["what_checked_and_changed"]
        current = reviewed["corrected"]
        if not reviewed["issues_found"]:
            break
    else:
        if reviewed is not None and reviewed["issues_found"]:
            needs_human_review = True
    return {**current, "needs_human_review": needs_human_review, "review_notes": review_notes,
            "passes_run": passes_run}


def extract_scope_summary_llm(document_text, title=None, buyer=None, client=None, model=None):
    """The one entry point tender_enrichment.py's CLI calls: text in, a
    (scope_summary, scope_source, needs_human_review, note) tuple out, or
    None (not attempted - too short to be worth a call) when `document_text`
    is below MIN_TEXT_CHARS_FOR_LLM_PASS. Raises SetupError/TransientError -
    the caller decides whether to stay heuristic for this one tender or this
    whole run."""
    if not document_text or len(document_text.strip()) < MIN_TEXT_CHARS_FOR_LLM_PASS:
        return None
    result = extract_scope_with_review(document_text, title, buyer, client=client, model=model)
    if not result.get("scope_found") or not result.get("scope_summary"):
        return None
    note = f"LLM-extracted scope summary ({result['passes_run']} review pass(es))."
    if result["needs_human_review"]:
        note += (f" NEEDS HUMAN REVIEW: the review pass still found an issue after {MAX_REVIEW_PASSES} passes - "
                 f"{result['review_notes']}")
    return result["scope_summary"], "document_scope_snippet", result["needs_human_review"], note


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", required=True, help="a local text file with the document's extracted text")
    ap.add_argument("--title", default=None)
    ap.add_argument("--buyer", default=None)
    args = ap.parse_args()
    with open(args.file, encoding="utf-8", errors="replace") as f:
        text = f.read()
    try:
        result = extract_scope_with_review(text, args.title, args.buyer)
    except (SetupError, TransientError) as e:
        print(f"ERROR: {e}")
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
