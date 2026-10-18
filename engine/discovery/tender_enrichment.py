"""
Tender search tags + scope/pricing/BOQ record + estimated value band
(Sarel, 2026-10-18, verbatim: "Tenders need to be tags by industry sne by
discupline or type of seevice to easy search. We must also extract the scope
and pricing model and BOQ for record, and estimated project value band").

Scope of this module: (1) + (2) + (3) of that request only. Winning-price
feedback into the pricing engine and market-trend analysis (the natural
follow-on, "once we get wining procies we can use to adjust our pricing
engine") is a SEPARATE, later piece of work and is not touched here - see
migration 0060's header comment.

What is REAL vs. HEURISTIC in this pass (read before trusting a field):

  industry_tags / discipline_tags
      Real keyword/rule-based classification against the tender's OWN text
      (title + description, always captured at discovery time by
      gov_sources.py / etenders_national.py), reusing taxonomy.py's existing,
      already cross-industry-tested matcher (discipline_categories, 0040) -
      not a new taxonomy. Two-level reuse: a matched GROUP slug (parent_slug
      null - roads_civil, water, buildings, electrical_mechanical, it_telecoms,
      professional_services, security_facilities, and others added since) is
      an industry_tag; a matched child slug is a discipline_tag; the group of
      every matched discipline is added to industry_tags too, so a tender
      tagged with a specific discipline is always also tagged with its
      industry. No ML - keyword/rule matching, same as the rest of this
      taxonomy - deliberately industry-agnostic (see test_tender_enrichment.py
      for roads/civil, IT, environmental, security and professional-services
      examples; this module adds nothing Klipcorp/engineering-specific).

  scope_summary
      The tender's own description text, lightly cleaned and length-capped -
      NOT a generated/AI summary. No document-summarisation pipeline exists
      anywhere in this repo (checked engine/general/, engine/pack_generator/,
      engine/discovery/ - they parse specific SANRAL/SBD/MBD form FIELDS,
      never a free-text scope paragraph). When document text is supplied
      (the caller already fetched it, e.g. via assess_tender.fetch_pdf_text)
      and it contains a "SCOPE OF WORK" (or similar) heading, the paragraph
      after it is used instead and is honestly labelled
      scope_source='document_scope_snippet'.

  pricing_model
      Keyword match only, against whatever text is available - "lump sum",
      "schedule of rates", "bill of quantities"/"BOQ", "cost reimbursable",
      "re-measurement", "time-based" (professional-service PSP contracts).
      Null when the text doesn't state or imply one - never inferred from
      sector or buyer.

  boq_summary
      {"referenced": bool, "items": [], "note": str|None}. `items` is ALWAYS
      empty - there is no BOQ/.xlsm line-item parser anywhere in this repo
      (checked engine/discovery/ and engine/pack_generator/ for anything
      BOQ-adjacent before writing this; the closest hit, engine/fill_financial.py,
      explicitly treats the priced BOQ as the tenderer's own business decision
      and never reads one from a buyer document; engine/discovery/tender_updates.py
      only detects BoQ AMENDMENT notices, not line items). `referenced` only
      records that the text or a document filename MENTIONS a BOQ/pricing
      schedule - never its contents. Real BOQ line-item extraction needs a
      new spreadsheet/document-reading pipeline; this honestly says so rather
      than fabricating line items.

  value_band
      Set ONLY when the available text states a contract/project/tender value
      or budget next to a recognisable anchor phrase ("estimated value",
      "contract value", "engineer's estimate", "budget", ...). Never derived
      from a BOQ total (none is extracted) and never guessed from sector or
      buyer size. value_band_basis is 'unknown' (band left null) for every
      tender where no such statement is found - which, on real samples
      (tested against the gov_sources fixtures and etenders_national's own
      sample releases), is the large majority: most adverts simply don't
      state a value. An honest blank beats an invented number (System-Status.md
      / confirm_pack.py "we stop, we never guess" principle).

CLI (batch enrichment of the shared `tenders` table, same RestClient/env-var
pattern as taxonomy.py sync / discovery_downgrades.py - service-role only):

    python3 engine/discovery/tender_enrichment.py run [--limit N] [--all]
        enrich every tender with tags_updated_at null (or every tender,
        with --all, to re-run after a taxonomy/keyword change), upserting
        tenders.industry_tags/discipline_tags and tender_scope_records.
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import taxonomy as _taxonomy  # noqa: E402


# ---------------------------------------------------------------------------
# Industry / discipline tags
# ---------------------------------------------------------------------------

def classify_tags(title, description, procurement_category=None, taxonomy=None):
    """(industry_tags, discipline_tags) - sorted, de-duplicated lists of
    discipline_categories slugs matched from the tender's own text. See the
    module docstring for exactly what each list means and why it reuses
    taxonomy.py rather than a new vocabulary."""
    tax = taxonomy or _taxonomy.active()
    matches = tax.match(f"{title or ''} {description or ''}")
    # categorize()'s own "uncategorized"/"uncategorized_<kind>" fallback (not
    # a real discipline_categories slug) is not a tag worth storing here -
    # tags are either real matches, or no tags at all (honest blank).
    matches = [m for m in matches if m in tax.by_slug]
    industries, disciplines = set(), set()
    for slug in matches:
        if tax.parent_of(slug):
            disciplines.add(slug)
            industries.add(tax.parent_of(slug))
        else:
            industries.add(slug)
    return sorted(industries), sorted(disciplines)


# ---------------------------------------------------------------------------
# Pricing model
# ---------------------------------------------------------------------------

# Order matters: a tender that mentions both "bill of quantities" and "lump
# sum" (common - "priced on a lump sum basis using the attached BOQ as a
# guide") is BOQ-based pricing with the BOQ structuring it, so BOQ wins over
# a bare "lump sum" mention; but an explicit "lump sum contract" without any
# BOQ language stays lump_sum.
_PRICING_PATTERNS = (
    (re.compile(r"\bbill\s+of\s+quantit(?:y|ies)\b|\bboq\b", re.I), "boq_based"),
    (re.compile(r"\bschedule\s+of\s+rates\b|\bunit\s+rate\s+contract\b|\brate[\s-]based\s+contract\b", re.I),
     "schedule_of_rates"),
    (re.compile(r"\bcost[\s-]*reimbursable\b|\breimbursable\s+basis\b", re.I), "cost_reimbursable"),
    (re.compile(r"\bre[\s-]?measurement\s+contract\b|\bremeasured\s+contract\b", re.I), "remeasurement"),
    (re.compile(r"\btime[\s-]based\s+(?:fee|contract|basis)\b|\btime\s+and\s+cost\b", re.I), "time_based"),
    (re.compile(r"\blump[\s-]sum\b", re.I), "lump_sum"),
)


def extract_pricing_model(text):
    """The pricing model stated/implied in `text`, or None. Keyword match
    only - see module docstring."""
    t = text or ""
    for pattern, model in _PRICING_PATTERNS:
        if pattern.search(t):
            return model
    return None


# ---------------------------------------------------------------------------
# BOQ (presence only - no line-item parsing, see module docstring)
# ---------------------------------------------------------------------------

_BOQ_MENTION_RE = re.compile(r"\bbill\s+of\s+quantit(?:y|ies)\b|\bboq\b|\bpricing\s+schedule\b", re.I)


def detect_boq_reference(text, documents=None):
    """{"referenced", "items", "note"} - see module docstring. `documents` is
    the same [{"title", "url"}, ...] shape gov_sources.py/etenders_national.py
    already carry on a release; a document whose own title mentions a BOQ
    counts even when the description text doesn't."""
    referenced = bool(_BOQ_MENTION_RE.search(text or ""))
    doc_hit = None
    for d in documents or []:
        name = (d or {}).get("title") or ""
        # filenames use _ . - instead of spaces ("Bill_of_Quantities.xlsx") -
        # normalise so the same word-boundary regex matches either form.
        if _BOQ_MENTION_RE.search(re.sub(r"[_.\-]+", " ", name)):
            referenced = True
            doc_hit = name
            break
    if not referenced:
        note = "No bill-of-quantities/pricing-schedule mention found in the available text or document titles."
    elif doc_hit:
        note = (f"A document titled \"{doc_hit}\" appears to be a BOQ/pricing schedule, but its contents are not "
                "parsed - no BOQ/spreadsheet line-item reader exists in this repo. Open the document for the real figures.")
    else:
        note = ("The tender's own text mentions a bill of quantities / pricing schedule, but no BOQ document "
                "parser exists in this repo - line items are not extracted. This only records that one is referenced.")
    return {"referenced": referenced, "items": [], "note": note}


# ---------------------------------------------------------------------------
# Scope summary
# ---------------------------------------------------------------------------

_SCOPE_HEADING_RE = re.compile(
    r"(?:SCOPE\s+OF\s+(?:WORK|SERVICES)|PROJECT\s+SCOPE|BRIEF\s+DESCRIPTION\s+OF\s+WORK)[:\s.\-]*\n?",
    re.I,
)
SCOPE_SUMMARY_MAX_LEN = 600


def _clean(text):
    return re.sub(r"\s+", " ", (text or "")).strip()


def extract_scope_summary(title, description, document_text=None):
    """(scope_summary, scope_source). Honest about what this is - see module
    docstring: never an AI/document summary, just the best already-captured
    text, optionally narrowed to the document's own "SCOPE OF WORK" section
    when a document was already fetched and read elsewhere."""
    if document_text:
        m = _SCOPE_HEADING_RE.search(document_text)
        if m:
            snippet = _clean(document_text[m.end():m.end() + SCOPE_SUMMARY_MAX_LEN * 2])
            if snippet:
                return snippet[:SCOPE_SUMMARY_MAX_LEN], "document_scope_snippet"
    base = _clean(description) or _clean(title)
    if not base:
        return None, None
    return base[:SCOPE_SUMMARY_MAX_LEN], "description_text"


# ---------------------------------------------------------------------------
# Estimated project value band
# ---------------------------------------------------------------------------

VALUE_BANDS = ("R0-5m", "R5-20m", "R20-50m", "R50m+")

# Only a rand amount found near one of these anchor phrases counts as a
# stated value - an unanchored "R" amount elsewhere in the text is far more
# likely a document fee, a deposit or an unrelated figure (confirmed against
# real tender text while building this - see test_tender_enrichment.py).
_VALUE_ANCHOR_RE = re.compile(
    r"(?:estimated\s+(?:contract\s+|project\s+|tender\s+)?value|contract\s+value|project\s+value|"
    r"tender\s+value|engineer'?s?\s+estimate|budget(?:ed)?\s*(?:amount|value)?|total\s+estimated\s+cost)"
    r"[^R0-9]{0,40}R\s?([0-9][0-9,.\s]{0,18}[0-9])\s*(million|billion|bn|m|k)?",
    re.I,
)

_MULTIPLIERS = {"million": 1_000_000, "m": 1_000_000, "billion": 1_000_000_000, "bn": 1_000_000_000, "k": 1_000}


def _parse_amount(raw_number, suffix):
    cleaned = re.sub(r"[,\s]", "", raw_number or "")
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if suffix:
        value *= _MULTIPLIERS.get(suffix.lower(), 1)
    return value


def _band_for(amount):
    if amount is None:
        return None
    if amount < 5_000_000:
        return "R0-5m"
    if amount < 20_000_000:
        return "R5-20m"
    if amount < 50_000_000:
        return "R20-50m"
    return "R50m+"


def estimate_value_band(text):
    """(value_band, basis, raw_amount, note). basis is 'stated_in_text' only
    when an anchored rand amount was found; otherwise ('unknown' band=None) -
    the honest default for most tenders, which state no value at all."""
    m = _VALUE_ANCHOR_RE.search(text or "")
    if not m:
        return None, "unknown", None, "No stated contract/project value or budget found in the available text."
    amount = _parse_amount(m.group(1), m.group(2))
    band = _band_for(amount)
    if band is None:
        return None, "unknown", None, "A value-like phrase was found but the amount could not be parsed reliably."
    quote = _clean(m.group(0))[:160]
    return band, "stated_in_text", round(amount, 2), f"Stated in the tender's own text: \"{quote}\""


# ---------------------------------------------------------------------------
# Put it together for one tender/release
# ---------------------------------------------------------------------------

def enrich(title, description, procurement_category=None, documents=None, document_text=None, taxonomy=None):
    """Everything this module computes for one tender, as a plain dict ready
    to split across tenders.industry_tags/discipline_tags and a
    tender_scope_records row. Pure function - no I/O, no Supabase - so it is
    trivially unit-testable (see test_tender_enrichment.py) and reusable from
    any caller (a batch run here, or a future per-release hook in
    gov_sources.py/etenders_national.py)."""
    industry_tags, discipline_tags = classify_tags(title, description, procurement_category, taxonomy)
    combined_text = f"{title or ''} {description or ''} {document_text or ''}"
    scope_summary, scope_source = extract_scope_summary(title, description, document_text)
    pricing_model = extract_pricing_model(combined_text)
    boq_summary = detect_boq_reference(combined_text, documents)
    value_band, value_band_basis, value_band_raw_amount, value_note = estimate_value_band(combined_text)
    return {
        "industry_tags": industry_tags,
        "discipline_tags": discipline_tags,
        "scope_summary": scope_summary,
        "scope_source": scope_source,
        "pricing_model": pricing_model,
        "boq_summary": boq_summary,
        "value_band": value_band,
        "value_band_basis": value_band_basis,
        "value_band_raw_amount": value_band_raw_amount,
        "confidence": "document_confirmed" if document_text else "heuristic",
        "source_note": value_note,
    }


# ---------------------------------------------------------------------------
# CLI: batch-enrich the shared `tenders` table
# ---------------------------------------------------------------------------

def _client():
    import company_profiles
    c = company_profiles.RestClient.from_env()
    if c is None:
        raise SystemExit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    return c


def run(limit=None, all_tenders=False):
    client = _client()
    tax = _taxonomy.active()
    rows = client.select("tenders", order="created_at.asc")
    if not all_tenders:
        rows = [r for r in rows if not r.get("tags_updated_at")]
    if limit:
        rows = rows[:limit]
    print(f"Enriching {len(rows)} tender(s) ({'all' if all_tenders else 'unenriched only'})...")
    tender_updates, scope_rows = [], []
    for t in rows:
        result = enrich(t.get("title"), t.get("description"), taxonomy=tax)
        tender_updates.append({
            "id": t["id"],
            "industry_tags": result["industry_tags"],
            "discipline_tags": result["discipline_tags"],
            "tags_updated_at": "now()",
        })
        scope_rows.append({
            "tender_id": t["id"],
            "scope_summary": result["scope_summary"],
            "scope_source": result["scope_source"],
            "pricing_model": result["pricing_model"],
            "boq_summary": result["boq_summary"],
            "value_band": result["value_band"],
            "value_band_basis": result["value_band_basis"],
            "value_band_raw_amount": result["value_band_raw_amount"],
            "confidence": result["confidence"],
            "source_note": result["source_note"],
        })
    for upd in tender_updates:
        tid = upd.pop("id")
        upd["tags_updated_at"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        client._req("PATCH", f"tenders?id=eq.{tid}", upd)
    if scope_rows:
        client.upsert("tender_scope_records", scope_rows, "tender_id")
    print(f"Updated tags on {len(tender_updates)} tender(s); wrote {len(scope_rows)} tender_scope_records row(s).")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--limit", type=int, default=None)
    r.add_argument("--all", action="store_true", help="re-enrich every tender, not just unenriched ones")
    args = ap.parse_args()
    if args.cmd == "run":
        run(limit=args.limit, all_tenders=args.all)


if __name__ == "__main__":
    main()
