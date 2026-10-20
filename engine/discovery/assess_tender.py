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
import queue
import threading

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


MAX_DOCUMENT_BYTES = 100 * 1024 * 1024  # 100MB - real tender documents are
# single-digit MB; neither urlopen() nor this function ever checked a size
# at all before reading a whole response into memory, so a buyer's server
# (misconfigured, or serving something that isn't a document) returning a
# multi-GB body within the timeout window would be read entirely before
# anything noticed - a real OOM risk for this worker. Reject rather than
# silently truncate: a partial file saved as if complete is worse than none.


def _read_bounded(r, max_bytes=MAX_DOCUMENT_BYTES):
    """Reads at most max_bytes+1 bytes from an open response, raising if the
    real body is larger - a Content-Length header is checked first (fails
    fast without reading anything), but the bounded read() is what actually
    enforces the cap, since Content-Length can be absent or simply wrong."""
    declared = r.headers.get("Content-Length")
    if declared:
        try:
            declared_n = int(declared)
        except ValueError:
            declared_n = None  # not parseable - the bounded read below is authoritative anyway
        if declared_n is not None and declared_n > max_bytes:
            raise ValueError(f"declared Content-Length {declared} exceeds the {max_bytes}-byte cap")
    data = r.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(f"response exceeds the {max_bytes}-byte cap (stopped at {len(data)} bytes)")
    return data


def _download_to_tempfile(url, timeout, result_q, abandoned):
    """abandoned: set by fetch_pdf_text once it has given up waiting (past the
    wall-clock deadline) - this thread keeps running regardless (it is not
    cancellable), so it must clean up its own temp file itself in that case
    rather than queueing a path nobody will ever read and ask to delete."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp_path = tmp.name
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                tmp.write(_read_bounded(r))
        if abandoned.is_set():
            os.unlink(tmp_path)
            return
        result_q.put(("ok", tmp_path))
    except Exception as e:
        # A failed download (dead link, 404, connection refused, a genuine
        # per-read socket timeout) still created the temp file on disk before
        # urlopen ever ran - confirmed live: every such failure leaked one
        # empty/partial file into /tmp forever, never cleaned up. Across a
        # discovery pipeline that treats dead links as routine (0071's own
        # header: "dead link, timeout, corrupt file, 404 ... never silently
        # dropped and never retried"), that is a slow, unbounded disk leak.
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        if not abandoned.is_set():
            result_q.put(("error", e))


def fetch_pdf_text(url, timeout=30):
    """Returns (text, fetch_error). A failed download or a non-PDF/corrupt file
    degrades to ("", <reason>) rather than raising - one bad document link on a
    public buyer's own site must not take out the whole assessment run, only
    that release's document-confirmed signals.

    Confirmed live 2026-10-19: urlopen's own `timeout` only bounds each
    individual socket read, not the download as a whole - a server that
    trickles data in just under that interval per read (or hangs after
    headers without ever closing the connection) can make r.read() block
    indefinitely with no exception ever raised, hanging this single-threaded
    pipeline forever on one bad host (confirmed: a live run sat on one open
    socket for over 90 minutes with zero progress). The download itself runs
    in a worker thread with a hard wall-clock deadline (timeout + 15s grace)
    enforced by .result(timeout=...), which is the only way to bound total
    time regardless of how the far side behaves."""
    # A plain daemon thread, not ThreadPoolExecutor/concurrent.futures: a
    # Future's worker thread is NOT daemonic, so an abandoned one (still
    # stuck reading from the same bad host) would keep the whole
    # watch_new_tenders.py process alive at exit, waiting to join it -
    # trading "hangs mid-run" for "hangs at the very end" instead of fixing
    # it. daemon=True means the interpreter can exit with this thread still
    # running; its one leaked socket is reclaimed by the OS when the
    # process actually exits.
    deadline = timeout + 15
    result_q = queue.Queue(maxsize=1)
    abandoned = threading.Event()
    t = threading.Thread(target=_download_to_tempfile, args=(url, timeout, result_q, abandoned), daemon=True)
    t.start()
    try:
        status, value = result_q.get(timeout=deadline)
    except queue.Empty:
        abandoned.set()
        return "", f"could not download document: stalled past {deadline}s (no response, or a trickling/hung connection)"
    if status == "error":
        if isinstance(value, (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError)):
            # ValueError here is _read_bounded()'s own MAX_DOCUMENT_BYTES
            # rejection - an oversized/lying response degrades the same way
            # as any other failed download, never crashes the caller.
            return "", f"could not download document: {value}"
        raise value
    path = value
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
    # taxonomy.fit_overlap(): exact / group / broad / peripheral / outside -
    # see its docstring. Precision over recall (2026-10-18 regression,
    # docs/specs/System-Status.md): this verdict decides what lands in the
    # daily e-mail, and a wrong strong_fit costs more than a missed one.
    fit = tax.fit_overlap(categories, known_disciplines)
    exact = fit["exact"]
    # a peripheral discipline (in a group the company is tagged with, but not
    # one its group tag covers) is outside what the company has claimed too
    outside = fit["outside"] + fit["peripheral"]
    field_only = fit["group"] + fit["broad"]
    # Another discipline of the same group as one the company matched is the
    # same field, not a competing trade: "routine road maintenance" also
    # reads as road construction ("road"), and that shouldn't knock a road
    # maintenance company's match down to partial.
    group_of = lambda c: tax.parent_of(c) or c  # noqa: E731
    matched_groups = {group_of(c) for c in exact}
    outside = [c for c in outside if group_of(c) not in matched_groups]
    # A professional service on a construction project names the works it is
    # FOR: "architectural services (PSP) for the renovation of an office",
    # "structural engineer to assess the roof". When the company's match is a
    # built-environment professional discipline, the construction-works
    # categories (the ones with CIDB classes on the list) are the project,
    # not another trade competing for the scope.
    served = []
    if any(tax.parent_of(c) == "professional_services" for c in exact):
        served = [c for c in outside if (tax.by_slug.get(c) or {}).get("cidb")]
        outside = [c for c in outside if c not in served]
    discipline_match = False
    uncategorized = all(c.startswith("uncategorized") for c in categories)
    labels = lambda cs: ", ".join(f"{tax.label(c)} ({c})" if c in tax.by_slug else c for c in cs)  # noqa: E731
    if exact and not outside:
        discipline_match = True
        reasons.append(f"Discipline match: {labels(exact)} is within scope"
                       + (f" (for the works it names: {labels(served)})." if served else "."))
    elif exact and len(exact) >= len(outside):
        # Part of the work is the company's, part is another trade (road
        # works plus the supply of building materials): worth a look, but
        # not a strong fit on a keyword overlap alone.
        reasons.append(f"Partial discipline match: {labels(exact)} is within scope, but the tender also reads as "
                       f"{labels(outside)}, outside the company's disciplines - check how much of the scope is its work.")
    elif exact:
        # Mostly another trade, with one of the company's disciplines named
        # in passing - "herbicides on roads, pest control and fumigation"
        # is pest control, not road work.
        reasons.append(f"Mostly outside the company's disciplines: the tender reads as {labels(outside)}; "
                       f"{labels(exact)} is only part of it (possibly just where the work is) - needs a human look.")
        verdict = "needs_review"
    elif field_only and not outside:
        reasons.append(f"Same discipline group: the tender reads only as {labels(field_only)}, and the company works in "
                       "that group - check the tender's scope against what the company actually does.")
    elif field_only:
        reasons.append(f"Same discipline group only in general terms ({labels(field_only)}), and the tender's specific "
                       f"work reads as {labels(outside)}, outside the company's disciplines - needs a human look.")
        verdict = "needs_review"
    elif fit["peripheral"]:
        # The company is tagged with the GROUP these sit in, but a group tag
        # doesn't cover them (taxonomy group_tag_match off): tagged
        # professional_services is not a claim to be a property valuer.
        reasons.append(f"{labels(fit['peripheral'])} sits in a discipline group the company is tagged with, but the "
                       "group tag alone doesn't cover it - needs a human look. If the company does this work, tick the "
                       "discipline itself on an Experience Library item.")
        verdict = "needs_review"
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
    # The buyer's own eTenders category, as a cross-check only (audit O1):
    # it never changes `categories` or the fit verdict.
    site_cat = release.get("etenders_category")
    xref = {"etenders_category": site_cat,
            "etenders_category_check": _taxonomy.active().etenders_crosscheck(categories, site_cat) if site_cat else None}
    if release.get("is_closed"):
        return {"categories": categories, "closed": True, "depth": "not_fetched", "signals": {},
                "confidence": "Document not fetched - this tender's closing date has already passed.",
                "text": "", **xref}

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
            "confidence": confidence, "text": best_text, **xref}


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
        # cross-reference only (audit O1) - not used by assess_fit()
        "etenders_category": reading.get("etenders_category"),
        "etenders_category_check": reading.get("etenders_category_check"),
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
