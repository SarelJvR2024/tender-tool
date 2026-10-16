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
import sys
import re
import json
import subprocess
import tempfile
import argparse
import urllib.request

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
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            tmp.write(r.read())
        path = tmp.name
    try:
        out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True,
                              timeout=30, text=True)
        return out.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


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


def categorize(title, description):
    text = f"{title or ''} {description or ''}".lower()
    matches = [cat for cat, kws in DISCIPLINE_KEYWORDS.items() if any(kw in text for kw in kws)]
    return matches or ["uncategorized"]


def assess_fit(categories, signals, depth, profile):
    """profile: dict with discipline list, bee_level, has_cidb_grading (bool)."""
    reasons = []
    verdict = "possible"

    discipline_match = any(c in profile.get("disciplines", []) for c in categories)
    if discipline_match:
        reasons.append(f"Discipline match: {', '.join(categories)} is within scope.")
    elif categories == ["uncategorized"]:
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


# A real, minimal profile - not invented. BEE level 1, known discipline (civil/roads
# consulting engineering, per klipcorp_profile.json), and the already-documented gap:
# "No CIDB grading document found anywhere" (klipcorp_profile.json's own gaps list).
KLIPCORP_PROFILE = {
    "disciplines": ["roads_civil", "professional_services"],
    "bee_level": 1,
    "has_cidb_grading": False,
}


def assess_release(release, fetch_document=True):
    categories = categorize(release.get("title"), release.get("description"))
    depth, signals, confidence = "metadata_only", {}, "No document was fetched for this assessment."
    if fetch_document and release.get("documents"):
        text = fetch_pdf_text(release["documents"][0]["url"])
        depth = document_depth(text)
        signals, confidence = extract_signals(text, depth)
    verdict, reasons = assess_fit(categories, signals, depth, KLIPCORP_PROFILE)
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
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    report = json.load(open(args.report_path))
    releases = report["releases"]
    if args.category_keyword:
        needle = args.category_keyword.lower()
        releases = [r for r in releases
                    if needle in (r.get("title") or "").lower() or needle in (r.get("description") or "").lower()]
    releases = releases[:args.limit]

    print(f"Assessing {len(releases)} release(s) (document fetch, {args.limit} max)...")
    results = []
    for r in releases:
        try:
            result = assess_release(r)
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
