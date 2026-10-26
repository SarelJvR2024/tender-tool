"""
The mechanical anti-collusion safeguard this feature exists for (Sarel,
2026-10-22): "it may NEVER generate the same or similar versions for two
companies - then they might both get disqualified." Grounding every draft
in a company's own real data (its people, its projects, its own
how_we_work text) makes a generic/duplicate draft unlikely, but "unlikely"
is not a guarantee a real tender officer would accept - this module is the
actual check, run against every OTHER company's ready document of the same
kind for the SAME tender before a draft is ever shown to anyone.

Deliberately stdlib-only (difflib), no embeddings/ML service: two
companies' cover letters/methodology statements being near-duplicates of
each other is exactly the kind of thing character-level sequence matching
catches well (copy-paste, light find-and-replace, the same generic
boilerplate), and it needs no API key, no network call and no extra
dependency to run on every single generation.
"""
import difflib
import re

# Above this, two documents read similarly enough that a tender evaluator
# comparing them side by side could reasonably suspect collusion or a
# shared template - the exact disqualification risk this feature exists to
# avoid. Chosen conservatively (lower than "these are basically identical")
# so a real near-duplicate is caught well before it would be obvious to a
# human reader, not just once it's blatant.
SIMILARITY_FLAG_THRESHOLD = 0.6


def normalize_for_comparison(text):
    """Strips whitespace/case/punctuation noise that would otherwise hide
    - or exaggerate - a real similarity. Company names, contract numbers and
    the like are NOT redacted here on purpose: if two drafts are similar
    even with their own company's real facts still in them, that's a
    stronger signal of genuine convergence, not a weaker one."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def similarity_ratio(text_a, text_b):
    """0.0 (nothing alike) to 1.0 (identical) after normalization."""
    a = normalize_for_comparison(text_a)
    b = normalize_for_comparison(text_b)
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(a=a, b=b, autojunk=False).ratio()


def check_uniqueness(new_text, other_texts, threshold=SIMILARITY_FLAG_THRESHOLD):
    """Compares new_text against every one of other_texts (every OTHER
    company's ready document of the same kind for the same tender).
    Returns (max_score, flagged, most_similar_index) - most_similar_index
    is into other_texts, for logging only; the actual competing company's
    text is never surfaced anywhere beyond this one internal comparison -
    see process_narrative_jobs.py, which calls this with texts it fetched
    using the service role, never exposed to any client."""
    if not other_texts:
        return 0.0, False, None
    scores = [similarity_ratio(new_text, other) for other in other_texts]
    max_score = max(scores)
    most_similar_index = scores.index(max_score)
    return max_score, max_score >= threshold, most_similar_index
