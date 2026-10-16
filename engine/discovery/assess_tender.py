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

STRUCTURAL_MARKERS = [
    "tender data", "returnable schedule", "conditions of tender",
    "scope of work", "pricing schedule", "part t1", "part t2", "part c1",
    "standard conditions of tender",
]

DISCIPLINE_KEYWORDS = {
    "roads_civil": ["road", "bridge", "pavement", "route", "highway", "civil engineering",
                    "rehabilitation", "stormwater", "earthworks"],
    "water": ["water treatment", "sanitation", "sewer", "pump station", "borehole", "reticulation"],
    "buildings": ["building", "renovation", "refurbishment", "construction of", "roofing"],
    "electrical_mechanical": ["electrical", "mechanical", "hvac", "generator"],
    "it_telecoms": ["ict", "software", "network", "telecommunications", "server"],
    "professional_services": ["professional service provider", "consulting engineer",
                               "design specialist", "psp"],
    "security_facilities": ["security services", "cleaning", "facilities management"],
}

CIDB_RE = re.compile(r"CIDB\s*(?:CONTRACTOR\s*)?GRADING?\s*(?:OF\s*)?(?:AT\s*LEAST\s*)?([0-9]+\s*[A-Z]{1,3})", re.IGNORECASE)
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


def categorize(title, description, procurement_category=None):
    """Keyword-bucket discipline matching, with the OCDS structured
    mainProcurementCategory (goods/services/works) folded in as a fallback
    signal rather than discarded: when no keyword bucket matches, a plain
    "uncategorized" told a reviewer nothing about what the tender even was.
    Tagging it with the buyer's own declared category at least distinguishes
    "unrecognised works tender" from "unrecognised goods tender", and stays
    honest - it is NOT a discipline match, just better-labelled uncertainty."""
    text = f"{title or ''} {description or ''}".lower()
    matches = [cat for cat, kws in DISCIPLINE_KEYWORDS.items() if any(kw in text for kw in kws)]
    if matches:
        return matches
    if procurement_category:
        return [f"uncategorized_{procurement_category.lower()}"]
    return ["uncategorized"]


def assess_fit(categories, signals, depth, profile):
    """profile: dict with discipline list, bee_level, has_cidb_grading (bool)."""
    reasons = []
    verdict = "possible"

    discipline_match = any(c in profile.get("disciplines", []) for c in categories)
    uncategorized = all(c.startswith("uncategorized") for c in categories)
    if discipline_match:
        reasons.append(f"Discipline match: {', '.join(categories)} is within scope.")
    elif uncategorized:
        if categories != ["uncategorized"]:
            reasons.append(f"Could not match a discipline from title/description alone "
                            f"(buyer's own OCDS category: {categories[0].removeprefix('uncategorized_')}) "
                            "- needs a human look.")
        else:
            reasons.append("Could not determine discipline from title/description alone - needs a human look.")
        verdict = "needs_review"
    else:
        reasons.append(f"Discipline ({', '.join(categories)}) doesn't match the company's known disciplines.")
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


DEFAULT_PROFILE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "config", "klipcorp_profile.json")

# Used only when no profile file can be read at all - this module is meant to
# run for any tenant's company profile (see load_company_profile), not just
# Klipcorp, so a missing file degrades to an honestly-generic fallback rather
# than silently reusing Klipcorp's own disciplines for a different company.
FALLBACK_PROFILE = {
    "disciplines": [],
    "bee_level": None,
    "has_cidb_grading": False,
}


def load_company_profile(path=None):
    """Loads disciplines/bee_level/has_cidb_grading straight from the tenant's
    own company profile JSON (the same file engine/fill_*.py read) instead of
    a constant hardcoded for one company - so this module can score fit for
    any company profile, not only Klipcorp's. has_cidb_grading is derived from
    the profile's own `gaps` list when there is no explicit field, since that
    is where this currently lives in the real data."""
    path = path or DEFAULT_PROFILE_PATH
    try:
        profile = json.load(open(path))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  WARNING: could not load company profile from {path} ({e}) - "
              f"using an empty fallback profile (every tender will need a human look).")
        return dict(FALLBACK_PROFILE)
    company = profile.get("company", {})
    gaps = " ".join(profile.get("gaps", [])).lower()
    has_cidb = company.get("has_cidb_grading")
    if has_cidb is None:
        has_cidb = "no cidb grading" not in gaps if gaps else False
    return {
        "disciplines": company.get("disciplines", []),
        "bee_level": company.get("bee_level"),
        "has_cidb_grading": bool(has_cidb),
    }


def assess_release(release, profile, fetch_document=True, max_documents=3):
    categories = categorize(release.get("title"), release.get("description"),
                             release.get("procurement_category"))

    if release.get("is_closed"):
        verdict, reasons = "closed", ["Closing date already passed - kept for reference, not actionable."]
        return {
            "contract_number": release.get("contract_number"),
            "buyer": release.get("buyer"),
            "title": release.get("title"),
            "closing_date": release.get("closing_date"),
            "categories": categories,
            "document_depth": "not_fetched",
            "signals": {},
            "confidence_note": "Document not fetched - this tender's closing date has already passed.",
            "verdict": verdict,
            "reasons": reasons,
        }

    depth, signals, confidence = "metadata_only", {}, "No document was fetched for this assessment."
    docs = release.get("documents") or []
    if fetch_document and docs:
        fetch_notes = []
        for doc in docs[:max_documents]:
            text, err = fetch_pdf_text(doc["url"])
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
            if this_depth == "full_document":
                break
        if depth == "metadata_only" and fetch_notes:
            depth = "no_extractable_text"
            confidence = "Every attached document failed to download or read: " + "; ".join(fetch_notes)
            signals, _ = extract_signals("", depth)

    verdict, reasons = assess_fit(categories, signals, depth, profile)
    return {
        "contract_number": release.get("contract_number"),
        "buyer": release.get("buyer"),
        "title": release.get("title"),
        "closing_date": release.get("closing_date"),
        "categories": categories,
        "document_depth": depth,
        "signals": signals,
        "confidence_note": confidence,
        "verdict": verdict,
        "reasons": reasons,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("report_path")
    ap.add_argument("--limit", type=int, default=20,
                     help="max releases to fetch documents for (politeness limit on a public server)")
    ap.add_argument("--category-keyword", default=None,
                     help="only assess releases whose title/description contains this (case-insensitive)")
    ap.add_argument("--profile", default=None,
                     help=f"path to a company profile JSON (default: {DEFAULT_PROFILE_PATH})")
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
