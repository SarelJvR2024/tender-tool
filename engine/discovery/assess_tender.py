"""
Assesses a tender discovered via etenders_national.py: what category/discipline
it is, what eligibility signals its own documents actually state, and whether
it looks like a fit for a given company profile - the "would we even consider
bidding on this" layer (spec item 18, Go/No-Go scoring) applied to the widened
national discovery feed, not just SANRAL's own 6 known tenders.

Two tiers of confidence, confirmed by downloading and inspecting 3 real
documents on 2026-10-16, not assumed:

  - METADATA-ONLY: title/description/buyer/mainProcurementCategory, straight
    from the OCDS release. Always available, always attempted first.
  - DOCUMENT-CONFIRMED: text extracted (pdftotext -layout) from the tender's
    own attached document. This is NOT reliably the full RFP pack - confirmed
    by testing: one real sample was a genuine 44-page tender notice with full
    Tender Data detail; one was a 1-page newspaper classified-ad scan whose
    multi-column layout extracts as 45KB of largely unusable jumbled text;
    one was a scanned image with a 1-character text layer (nothing
    extractable at all). Document depth is judged by real structural
    markers (section headings this kind of tender document actually uses -
    "TENDER DATA", "RETURNABLE SCHEDULE", "CONDITIONS OF TENDER" etc.), not
    by raw character count, because the noisy newspaper-advert sample proves
    length alone is not a reliable signal of real detail.

Absence of a signal (no CIDB mention found) in a THIN document is reported as
"not found in the available text - get the full RFP pack to check", never as
"this tender has no CIDB requirement" - the same confirmed/assumed_default/
missing distinction as engine/provenance.py, applied to data this pipeline
did not create and cannot fully control the quality of.

Suitability vs. score: assess_fit() below answers "is this our kind of work"
(discipline + CIDB + document depth -> a categorical verdict). It does NOT
predict how the company would score. That separate answer is
score_outlook.py's estimate_score_outlook(), attached to every result as
"score_outlook" - see docs/specs/Tender-Evaluation-Engine-Audit.md.

Usage:
    python3 assess_tender.py <national_report.json> [--limit N] [--category-keyword K]
"""
import os
import sys
import re
import json
import subprocess
import tempfile
import argparse
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_outlook import estimate_score_outlook, PROVINCES  # noqa: E402
import taxonomy as _taxonomy  # noqa: E402

STRUCTURAL_MARKERS = [
    "tender data", "returnable schedule", "conditions of tender",
    "scope of work", "pricing schedule", "part t1", "part t2", "part c1",
    "standard conditions of tender",
]

# Discipline categories are no longer a fixed dict here. They are Tender
# Tool's own maintained list (taxonomy.py): the discipline_categories table
# (0038), seeded from config/discipline_taxonomy.json - 19 groups / 93
# disciplines built from 2 211 live eTenders tenders, cross-checked against
# eTenders' and Leads 2 Business's own category lists
# (docs/specs/Discipline-Taxonomy-Findings.md). The 7 keyword buckets that
# used to live here (roads_civil, water, buildings, electrical_mechanical,
# it_telecoms, professional_services, security_facilities) are kept as the
# top-level GROUP slugs of that list, so tags and stored categories written
# before it still match. Before: 66% of live tenders came out
# "uncategorized"; after: 3%.

CIDB_RE = re.compile(r"CIDB\s*(?:CONTRACTOR\s*)?GRADING?\s*(?:OF\s*)?(?:AT\s*LEAST\s*)?([0-9]+\s*[A-Z]{1,3})", re.IGNORECASE)
# Known-weak, kept only for output-shape compatibility: on SANRAL's Book 1 it
# captures "1" from "B-BBEE Level 1", not a points value. Nothing reads it;
# score_outlook.py's specific_goals is the real (and honest) replacement.
BBEE_POINTS_RE = re.compile(r"B-?BBEE[^0-9]{0,60}?([0-9]{1,2})\s*(?:POINTS|PTS)?", re.IGNORECASE)
JV_RE = re.compile(r"joint\s*venture", re.IGNORECASE)
BRIEFING_RE = re.compile(r"compulsory\s*(?:clarification\s*)?brief", re.IGNORECASE)


def fetch_pdf_text(url, timeout=30):
    """Returns (text, fetch_error). A failed download or a non-PDF/corrupt file
    degrades to ("", <reason>) rather than raising - one bad document link on a
    public buyer's own site must not take out the whole assessment run, only
    that release's document-confirmed signals."""
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                tmp.write(r.read())
            path = tmp.name
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        return "", f"could not download document: {e}"
    try:
        out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True,
                              timeout=30, text=True)
        if out.returncode != 0:
            return "", f"pdftotext could not read this file (not a valid PDF?): {out.stderr.strip()[:200]}"
        return out.stdout, None
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return "", f"pdftotext failed: {e}"
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def document_depth(text):
    """Calibrated against 3 real documents (2026-10-16): a genuine 44-page tender
    notice (115KB extracted text, only matched 1 marker - this buyer's own
    heading conventions aren't SANRAL/CIDB-style "TENDER DATA"/"PART T1" at all),
    a 1-page newspaper classified-ad scan (42KB of jumbled multi-column text,
    0 markers), and a scanned image (1 char, 0 markers). Markers alone
    under-classified the first; length alone would have wrongly promoted the
    second. The combined rule - either 2+ markers, or meaningful length AND at
    least 1 marker - correctly separates all three."""
    lower = text.lower()
    markers_found = sum(1 for m in STRUCTURAL_MARKERS if m in lower)
    if len(text.strip()) < 50:
        return "no_extractable_text"
    if markers_found >= 2 or (len(text) > 20000 and markers_found >= 1):
        return "full_document"
    return "advert_or_partial"


def extract_signals(text, depth):
    """Returns (signals_dict, confidence_note). Every signal is either a found
    value or explicitly 'not_found_in_available_text' - never silently absent,
    matching provenance.py's assumed_default/missing distinction."""
    def found_or_unclear(pattern, group=1):
        m = pattern.search(text)
        if m:
            return m.group(group).strip()
        return None

    signals = {
        "cidb_grading": found_or_unclear(CIDB_RE),
        "bbee_points_mentioned": found_or_unclear(BBEE_POINTS_RE),
        "joint_venture_mentioned": bool(JV_RE.search(text)),
        "compulsory_briefing_mentioned": bool(BRIEFING_RE.search(text)),
    }
    if depth == "no_extractable_text":
        confidence = ("No text could be extracted from the attached document (likely a scanned "
                      "image) - none of these signals could be checked at all.")
    elif depth == "advert_or_partial":
        confidence = ("Only a short advert or partial notice was attached, not the full tender "
                      "document - absence of a signal here means 'not stated in this advert', "
                      "not 'this tender has no such requirement'. Get the full RFP pack before "
                      "relying on this.")
    else:
        confidence = "Extracted from what looks like the full tender document (matched known section headings)."
    return signals, confidence


def categorize(title, description, procurement_category=None, taxonomy=None):
    """Sorts a tender into Tender Tool's discipline categories (taxonomy.py:
    the live discipline_categories list when the run loaded it, else the
    seed file), from its title + description. A specific discipline wins
    over its group; several can apply (a WWTW upgrade is water treatment AND
    electrical AND mechanical). The OCDS structured mainProcurementCategory
    (goods/services/works) is folded in as a fallback signal rather than
    discarded: when nothing matches, a plain "uncategorized" told a reviewer
    nothing about what the tender even was. Tagging it with the buyer's own
    declared category at least distinguishes "unrecognised works tender"
    from "unrecognised goods tender", and stays honest - it is NOT a
    discipline match, just better-labelled uncertainty (and a candidate for
    a new category: taxonomy.py coverage lists them)."""
    tax = taxonomy or _taxonomy.active()
    matches = tax.match(f"{title or ''} {description or ''}")
    if matches:
        return matches
    if procurement_category:
        return [f"uncategorized_{procurement_category.lower()}"]
    return ["uncategorized"]


def assess_fit(categories, signals, depth, profile):
    """profile: dict with discipline list, bee_level, has_cidb_grading (bool)."""
    reasons = []
    verdict = "possible"

    known_disciplines = profile.get("disciplines") or []
    tax = _taxonomy.active()
    # exact: same category, or the company's tag is the group it sits in;
    # broad: the tender is only known at group level and the company works in
    # one of that group's disciplines - same field, scope still to check.
    exact, broad = tax.overlap(categories, known_disciplines)
    discipline_match = bool(exact)
    uncategorized = all(c.startswith("uncategorized") for c in categories)
    labels = lambda cs: ", ".join(f"{tax.label(c)} ({c})" if c in tax.by_slug else c for c in cs)  # noqa: E731
    if discipline_match:
        reasons.append(f"Discipline match: {labels(exact)} is within scope.")
    elif broad:
        reasons.append(f"Same discipline group: the tender reads only as {labels(broad)}, and the company works in "
                       "that group - check the tender's scope against what the company actually does.")
    elif uncategorized:
        if categories != ["uncategorized"]:
            reasons.append(f"Could not match a discipline from title/description alone "
                            f"(buyer's own OCDS category: {categories[0].removeprefix('uncategorized_')}) "
                            "- needs a human look.")
        else:
            reasons.append("Could not determine discipline from title/description alone - needs a human look.")
        verdict = "needs_review"
    elif not known_disciplines:
        # An empty disciplines list is "we don't know yet" (the field has
        # never been populated for this company), not "we checked and this
        # is out of scope" - confirmed by running this on a profile shaped
        # like every committed test-company fixture against a plain roads
        # tender title: it silently came back "not_a_fit" on exactly the
        # kind of work Klipcorp's own real SANRAL history is built around.
        # classify_tender.assess_fit_from_text() already worked around this
        # at its own call site; this is the same fix at the root, so every
        # caller (including the live OCDS discovery feed, which had no
        # workaround) gets it.
        reasons.append(f"Discipline ({labels(categories)}) matched, but the company has no disciplines "
                        "recorded yet to compare against - needs a human look, not an automatic rejection.")
        verdict = "needs_review"
    else:
        reasons.append(f"Discipline ({labels(categories)}) doesn't match the company's known disciplines "
                        f"({', '.join(known_disciplines)}).")
        verdict = "not_a_fit"

    if signals.get("cidb_grading"):
        if not profile.get("has_cidb_grading"):
            reasons.append(f"Requires CIDB grading {signals['cidb_grading']} - the company has no "
                            "CIDB grading document on file (a known gap, not a 'no').")
            verdict = "not_a_fit" if verdict != "not_a_fit" else verdict
        else:
            reasons.append(f"Requires CIDB grading {signals['cidb_grading']} - company has a grading on file.")

    if depth != "full_document":
        reasons.append("Document depth is limited (see confidence note) - treat any verdict here as provisional.")
        if verdict == "possible":
            verdict = "needs_review"

    if discipline_match and verdict == "possible":
        verdict = "strong_fit"

    return verdict, reasons


# No default company profile (Sarel, 2026-10-17: "Nothing must be klipcorp
# specific, they are just a company, not a benchmark"). Every caller names the
# company it is scoring for: the Discovery fan-out builds each company's
# profile from its own rows (company_profiles.py), the bridge from the job's
# company, and a CLI run takes --profile. This used to default to
# config/klipcorp_profile.json.
DEFAULT_PROFILE_PATH = None

# Used only when no profile file can be read at all - this module is meant to
# run for any tenant's company profile (see load_company_profile), not just
# Klipcorp, so a missing file degrades to an honestly-generic fallback rather
# than silently reusing Klipcorp's own disciplines for a different company.
FALLBACK_PROFILE = {
    "disciplines": [],
    "bee_level": None,
    "black_ownership_pct": None,
    "has_cidb_grading": False,
    "offices": [],
}


def load_company_profile(path=None):
    """Loads disciplines/bee_level/has_cidb_grading straight from the tenant's
    own company profile JSON (the same file engine/fill_*.py read) instead of
    a constant hardcoded for one company - so this module can score fit for
    any company profile, not only Klipcorp's. has_cidb_grading is derived from
    the profile's own `gaps` list when there is no explicit field, since that
    is where this currently lives in the real data."""
    path = path or DEFAULT_PROFILE_PATH
    if not path:
        raise ValueError("No company profile given - pass the profile of the company you are scoring for "
                         "(--profile config/test_companies/<company>.json, or that company's own exported "
                         "profile). There is deliberately no default company.")
    try:
        profile = json.load(open(path))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  WARNING: could not load company profile from {path} ({e}) - "
              f"using an empty fallback profile (every tender will need a human look).")
        return dict(FALLBACK_PROFILE)
    company = profile.get("company", {})
    gaps = " ".join(profile.get("gaps", [])).lower()
    has_cidb = company.get("has_cidb_grading")
    if has_cidb is None and "cidb_grading" in company:
        # The structured field (companies.cidb_grading, 0018; the profile
        # JSON's company.cidb_grading) wins over reading free-text gaps.
        has_cidb = bool(company.get("cidb_grading"))
    if has_cidb is None:
        # Last resort: Klipcorp's profile states this only as a gaps line
        # ("No CIDB grading document found anywhere"). Any other company's
        # profile records it in cidb_grading above.
        has_cidb = "no cidb grading" not in gaps if gaps else False
    return {
        "disciplines": company.get("disciplines", []),
        "bee_level": company.get("bee_level"),
        "black_ownership_pct": company.get("black_ownership_pct"),
        "has_cidb_grading": bool(has_cidb),
        "offices": offices_from_company(company),
    }


def offices_from_company(company):
    """Structured office locations for locality scoring (score_outlook.py
    match_locality): company.offices[] if the profile has them - same shape
    as the app's company_offices table (province, district_municipality,
    local_municipality, town). Otherwise, if the registered address names a
    province, ONE office is derived from it and flagged derived=True, so the
    outlook says it's an inference from the address, not a confirmed office
    record. The district/municipality is never guessed from a street address."""
    offices = company.get("offices")
    if isinstance(offices, list) and offices:
        return offices
    addr = company.get("registered_address") or ""
    for prov in PROVINCES:
        if re.search(re.escape(prov).replace(r"\-", "[- ]?"), addr, re.IGNORECASE):
            return [{"province": prov, "district_municipality": None, "local_municipality": None,
                     "town": None, "office_kind": "registered_office", "derived": True}]
    return []


def read_release(release, fetch_document=True, max_documents=3, fetch_text=None):
    """The company-independent half of an assessment: categories, document
    depth and signals read from the tender's own documents. Done ONCE per
    tender, however many companies it is then scored for (score_release) -
    the Discovery fan-out (watch_new_tenders.py) scores the same reading for
    every company, so a buyer's server is asked for each document once, not
    once per company. `fetch_text(url) -> (text, error)` defaults to
    fetch_pdf_text; a test passes its own."""
    fetch_text = fetch_text or fetch_pdf_text
    categories = categorize(release.get("title"), release.get("description"),
                             release.get("procurement_category"))
    if release.get("is_closed"):
        return {"categories": categories, "closed": True, "depth": "not_fetched", "signals": {},
                "confidence": "Document not fetched - this tender's closing date has already passed.",
                "text": ""}

    depth, signals, confidence = "metadata_only", {}, "No document was fetched for this assessment."
    best_text = ""
    docs = release.get("documents") or []
    if fetch_document and docs:
        fetch_notes = []
        for doc in docs[:max_documents]:
            text, err = fetch_text(doc["url"])
            if err:
                fetch_notes.append(f"{doc.get('title') or doc['url']}: {err}")
                continue
            this_depth = document_depth(text)
            this_signals, this_confidence = extract_signals(text, this_depth)
            # Keep the deepest result seen across this tender's documents (a
            # buyer sometimes attaches a thin advert alongside the real RFP,
            # or several volumes - stop as soon as one gives the full picture).
            if this_depth == "full_document" or depth == "metadata_only":
                depth, signals, confidence = this_depth, this_signals, this_confidence
                best_text = text
            if this_depth == "full_document":
                break
        if depth == "metadata_only" and fetch_notes:
            depth = "no_extractable_text"
            confidence = "Every attached document failed to download or read: " + "; ".join(fetch_notes)
            signals, _ = extract_signals("", depth)
    return {"categories": categories, "closed": False, "depth": depth, "signals": signals,
            "confidence": confidence, "text": best_text}


def score_release(release, reading, profile):
    """The per-company half: one company's fit verdict and scoring outlook,
    from read_release()'s reading and THAT company's own profile."""
    categories, depth, signals = reading["categories"], reading["depth"], reading["signals"]
    if reading["closed"]:
        verdict, reasons = "closed", ["Closing date already passed - kept for reference, not actionable."]
        outlook = estimate_score_outlook("", "not_fetched", profile)
    else:
        verdict, reasons = assess_fit(categories, signals, depth, profile)
        # Suitability (verdict/reasons above) and scoring outlook are deliberately
        # separate answers: a strong-fit tender can still be one the company would
        # score poorly on, and vice versa. See score_outlook.py's docstring.
        outlook = estimate_score_outlook(reading["text"], depth, profile, signals.get("cidb_grading"))
    return {
        "contract_number": release.get("contract_number"),
        "buyer": release.get("buyer"),
        "title": release.get("title"),
        # the OCDS tender.description - kept so a pursued tender (migration
        # 0018 pursue_discovered_opportunity) has a real description
        "description": release.get("description"),
        "closing_date": release.get("closing_date"),
        "categories": categories,
        "document_depth": depth,
        "signals": signals,
        "confidence_note": reading["confidence"],
        "verdict": verdict,
        "reasons": reasons,
        "score_outlook": outlook,
    }


def assess_release(release, profile, fetch_document=True, max_documents=3, fetch_text=None):
    """One release for one profile (read + score). Unchanged result shape."""
    return score_release(release, read_release(release, fetch_document, max_documents, fetch_text), profile)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("report_path")
    ap.add_argument("--limit", type=int, default=20,
                     help="max releases to fetch documents for (politeness limit on a public server)")
    ap.add_argument("--category-keyword", default=None,
                     help="only assess releases whose title/description contains this (case-insensitive)")
    ap.add_argument("--profile", default=None,
                     required=True, help="path to the company profile JSON to score for (no default company)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    profile = load_company_profile(args.profile)
    print(f"Company profile: disciplines={profile['disciplines']}, "
          f"bee_level={profile['bee_level']}, has_cidb_grading={profile['has_cidb_grading']}")

    report = json.load(open(args.report_path))
    releases = report["releases"]
    if args.category_keyword:
        needle = args.category_keyword.lower()
        releases = [r for r in releases
                    if needle in (r.get("title") or "").lower() or needle in (r.get("description") or "").lower()]
    # Assess every closed release (cheap - metadata only, no document fetch)
    # but only spend the document-fetch budget (--limit) on ones still open,
    # so a wide date window doesn't burn the whole budget on expired tenders.
    closed = [r for r in releases if r.get("is_closed")]
    open_releases = [r for r in releases if not r.get("is_closed")][:args.limit]
    releases = closed + open_releases

    print(f"Assessing {len(releases)} release(s) ({len(open_releases)} open, document fetch "
          f"up to {args.limit}; {len(closed)} already closed, metadata only)...")
    results = []
    for r in releases:
        try:
            result = assess_release(r, profile)
        except Exception as e:
            result = {"contract_number": r.get("contract_number"), "error": str(e)}
        results.append(result)
        print(f"  {result.get('contract_number'):>10}  {result.get('verdict', 'ERROR'):<14}  "
              f"{result.get('document_depth', '-'):<20}  {(r.get('title') or '')[:50]}")

    if args.out:
        json.dump(results, open(args.out, "w"), indent=2)
        print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
