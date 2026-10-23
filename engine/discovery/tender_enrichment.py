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
      THREE possible sources, in this priority order, each honestly labelled
      by scope_source - never silently upgraded or conflated:
        1. 'document_scope_snippet' - a document's own "SCOPE OF WORK" (or
           similar) heading was found by regex (extract_scope_summary()) and
           the paragraph after it is used verbatim. Fast, free, zero-cost -
           tried first and kept whenever it succeeds.
        2. 'document_scope_snippet' (same label - see below) - when the
           regex heading match fails but real document text IS available and
           long enough to plausibly contain scope information, a genuine LLM
           call (engine/discovery/scope_llm.py) reads it, following
           docs/specs/AI-Call-Quality-Standard.md: a prompt specific to SA
           government tender documents, a verbatim-quote-evidence rule, and a
           mandatory 3-pass generate->review->revise loop. A result that
           still has an issue after 3 passes is kept (the best version found)
           but flagged in source_note ("NEEDS HUMAN REVIEW: ...") - never
           silently shipped as if it passed its own check. Deliberately the
           SAME scope_source label as the regex path: both genuinely came
           from reading the tender's own document, just by different means:
           distinguish them, if needed, by whether source_note starts with
           "LLM-extracted".
        3. 'description_text' - neither of the above (no document text was
           available, or ANTHROPIC_API_KEY isn't set, or the LLM pass
           genuinely found no real scope information) - the tender's own
           already-captured title/description text, lightly cleaned and
           length-capped. Not a summary of anything, just the best text this
           pass already had - the honest fallback for most tenders, still
           true today exactly as it always was.
      Only this module's own CLI (run()) does the document fetching/LLM call;
      enrich() itself stays a pure function (see "Put it together" below) -
      it is given document_text and an already-computed LLM result, never
      doing I/O of its own.

  pricing_model
      Keyword match only, against whatever text is available - "lump sum",
      "schedule of rates", "bill of quantities"/"BOQ", "cost reimbursable",
      "re-measurement", "time-based" (professional-service PSP contracts).
      Null when the text doesn't state or imply one - never inferred from
      sector or buyer.

  boq_summary
      {"referenced": bool, "items": [...], "note": str|None}. `items` is real
      line items - {"description", "unit", "quantity", "rate_zar",
      "amount_zar"} - parsed DETERMINISTICALLY (never an LLM guess at a
      number) from a candidate BOQ/pricing-schedule spreadsheet by
      engine/discovery/boq_extraction.py, reusing this repo's own
      sanral_fill.Workbook (.xlsx/.xlsm zip+XML reader - no third-party
      spreadsheet library). `items` stays [] - the original, honest default -
      whenever: no document looks like a priced schedule, the candidate
      document couldn't be downloaded, or boq_extraction.py itself couldn't
      confidently find a real header row/numeric quantity column in it (it
      never fabricates a line item from a sheet it can't read - see that
      module's own docstring). `referenced` records that a BOQ/pricing
      schedule is mentioned at all (title/description/document filename),
      regardless of whether its contents could be parsed.

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
        [--no-documents] [--max-documents N]
        enrich every tender with tags_updated_at null (or every tender,
        with --all, to re-run after a taxonomy/keyword change), upserting
        tenders.industry_tags/discipline_tags and tender_scope_records. Also
        fetches and reads each tender's own document(s) (from
        discovered_opportunities.document_urls - see _tender_context())
        unless --no-documents is passed, running the real BOQ parser and the
        LLM scope fallback where they apply - see "Put it together" below and
        docs/specs/AI-Call-Quality-Standard.md. A missing ANTHROPIC_API_KEY or
        a download failure degrades that ONE tender to heuristic (logged),
        never crashes the batch.

    python3 engine/discovery/tender_enrichment.py counts
        Real backlog-size numbers (no sample, no guess): the true total
        tender count and how many already have a tender_scope_records row
        with confidence='heuristic' vs. 'document_confirmed' vs. none at all
        - what Sarel's own "even on historic tenders"/"even the backlog" ask
        needs before anyone decides to run this over the whole backlog (a
        real Anthropic API cost - see this task's own PR description, not
        spent here).

Per-release heuristic hook (title/description/documents only - no document
I/O, no LLM call): enrich_release() is called from
gov_sources.fetch_all() on every merged release, going forward, alongside
(not replacing) the existing per-company scoring fan-out in
watch_new_tenders.py - see enrich_release()'s own docstring for why this
can only be the heuristic path at that point (no tenders.id exists yet for
most releases) and where the real, document-based extraction happens instead.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import taxonomy as _taxonomy  # noqa: E402
import award_outcomes as _award_outcomes  # noqa: E402  (parse_rand: the SA comma/period decimal-vs-thousands heuristic, see _parse_amount)
import boq_extraction as _boq_extraction  # noqa: E402  (real BOQ line-item parsing - step 3's CLI wiring)
import scope_llm as _scope_llm  # noqa: E402  (LLM scope-summary fallback - step 3's CLI wiring; importing this
                                 # module itself never touches `anthropic` - see its own docstring)


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


def detect_boq_reference(text, documents=None, items=None):
    """{"referenced", "items", "note"} - see module docstring. `documents` is
    the same [{"title", "url"}, ...] shape gov_sources.py/etenders_national.py
    already carry on a release; a document whose own title mentions a BOQ
    counts even when the description text doesn't.

    `items`: real line items already parsed by
    engine/discovery/boq_extraction.parse_boq_workbook() - the caller (this
    module's own CLI, run()) downloads and parses the candidate BOQ document
    and passes its own `items` result in here. This function does no
    document reading itself (kept a pure function, no I/O - see module
    docstring); None (the default) keeps the honest "always empty" behaviour
    for any caller that hasn't wired up real parsing (e.g. enrich_release(),
    the per-release discovery hook, which runs before any document has been
    fetched)."""
    referenced = bool(_BOQ_MENTION_RE.search(text or "")) or bool(items)
    doc_hit = None
    for d in documents or []:
        name = (d or {}).get("title") or ""
        # filenames use _ . - instead of spaces ("Bill_of_Quantities.xlsx") -
        # normalise so the same word-boundary regex matches either form.
        if _BOQ_MENTION_RE.search(re.sub(r"[_.\-]+", " ", name)):
            referenced = True
            doc_hit = name
            break
    if items:
        return {"referenced": True, "items": items,
                "note": f"Parsed {len(items)} real line item(s) from the tender's own BOQ/pricing-schedule "
                        "document (engine/discovery/boq_extraction.py)."}
    if not referenced:
        note = "No bill-of-quantities/pricing-schedule mention found in the available text or document titles."
    elif doc_hit:
        note = (f"A document titled \"{doc_hit}\" appears to be a BOQ/pricing schedule, but its contents could not "
                "be confidently parsed as one (boq_extraction.py never fabricates a line item from a sheet it can't "
                "read) - open the document for the real figures.")
    else:
        note = ("The tender's own text mentions a bill of quantities / pricing schedule, but no matching document "
                "was read for line items. This only records that one is referenced.")
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
    # award_outcomes.parse_rand(), not a second hand-rolled parser: stripping
    # every comma as a thousands separator (the original code here) silently
    # inflates a real SA amount 100x whenever the comma is actually the
    # DECIMAL separator - confirmed on a real, common SA format
    # (award_outcomes.py's own docstring: "R551 189,00" is R551,189.00, not
    # R55,118,900) - "the estimated contract value is R1 500 000,00" came
    # back as a band of R50m+ instead of R0-5m before this fix. parse_rand()
    # already resolves this correctly (last separator followed by 1-2 digits
    # is the decimal one, everything else is thousands) and is already
    # tested against every format seen on two real sites.
    value = _award_outcomes.parse_rand(raw_number)
    if value is None:
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

def enrich(title, description, procurement_category=None, documents=None, document_text=None, taxonomy=None,
           boq_items=None, llm_scope_result=None):
    """Everything this module computes for one tender, as a plain dict ready
    to split across tenders.industry_tags/discipline_tags and a
    tender_scope_records row. Still a pure function - no I/O, no Supabase, no
    LLM call of its own - so it is trivially unit-testable (see
    test_tender_enrichment.py) and reusable from any caller (a batch run
    here, or the per-release hook in gov_sources.py - see enrich_release()).

    `boq_items`: real line items from
    engine/discovery/boq_extraction.parse_boq_workbook(), when the caller has
    already downloaded and parsed a candidate BOQ document. None (the
    default) keeps boq_summary.items honestly empty.

    `llm_scope_result`: a (summary, source, needs_human_review, note) tuple
    from scope_llm.extract_scope_summary_llm(), when the caller has already
    run the LLM fallback (only tried when the fast/free regex heading match
    in extract_scope_summary() didn't find anything). None (the default)
    keeps scope_summary on the regex/description-text path exactly as
    before - the LLM call never happens inside this function."""
    industry_tags, discipline_tags = classify_tags(title, description, procurement_category, taxonomy)
    combined_text = f"{title or ''} {description or ''} {document_text or ''}"
    scope_summary, scope_source = extract_scope_summary(title, description, document_text)
    needs_human_review, scope_note = False, None
    if scope_source != "document_scope_snippet" and llm_scope_result is not None:
        llm_summary, llm_source, llm_needs_review, llm_note = llm_scope_result
        scope_summary, scope_source = llm_summary, llm_source
        needs_human_review, scope_note = llm_needs_review, llm_note
    pricing_model = extract_pricing_model(combined_text)
    boq_summary = detect_boq_reference(combined_text, documents, items=boq_items)
    value_band, value_band_basis, value_band_raw_amount, value_note = estimate_value_band(combined_text)
    # source_note is one free-text column (no new migration this task - see
    # its own comment on tender_scope_records) carrying BOTH the value-band
    # provenance and, when the LLM scope pass ran, its own note - including
    # the "NEEDS HUMAN REVIEW" flag the AI-Call-Quality-Standard review loop
    # requires when pass 3 still finds an issue. needs_human_review is also
    # returned as its own key here for the CLI's own console reporting -
    # there is no dedicated boolean column for it (deliberately, per this
    # task's "no schema change" constraint; it is always findable in
    # source_note by searching for "NEEDS HUMAN REVIEW").
    source_note = " | ".join(n for n in (value_note, scope_note) if n) or None
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
        "confidence": "document_confirmed" if (document_text or boq_items) else "heuristic",
        "source_note": source_note,
        "needs_human_review": needs_human_review,
    }


def enrich_release(release, taxonomy=None):
    """Heuristic-only convenience wrapper for a RELEASE dict, as
    gov_sources.py/etenders_national.py produce it (title, description,
    documents, procurement_category) - called from gov_sources.fetch_all()
    on every merged release, going forward, alongside (never replacing) the
    existing per-company scoring fan-out in watch_new_tenders.py.

    Deliberately heuristic only (no document_text, no boq_items, no
    llm_scope_result): at this point in the pipeline there is usually no
    `tenders.id` yet for a release at all (most eTenders releases only
    become a shared `tenders` row once pursued - migration 0018's
    pursue_discovered_opportunity() - and tender_scope_records.tender_id is a
    foreign key to it), so there is nowhere to attach a real document-based
    tender_scope_records row yet, and no document has been downloaded this
    early either. This only attaches the same cheap, free, zero-cost tagging
    enrich() already does from title/description/documents alone - exactly
    the module docstring's own "future per-release hook in
    gov_sources.py/etenders_national.py" for industry/discipline tags,
    pricing-model keywords, BOQ-mention detection and value-band, now also
    covering a tender BEFORE it has its own row.

    Real, document-based extraction (BOQ line items, LLM-assisted scope,
    confidence='document_confirmed') happens later, once a tender has a real
    `tenders` row - see this module's own CLI (run()), which fetches and
    reads each tender's real documents."""
    return enrich(release.get("title"), release.get("description"), release.get("procurement_category"),
                 release.get("documents"), taxonomy=taxonomy)


# ---------------------------------------------------------------------------
# CLI: batch-enrich the shared `tenders` table
# ---------------------------------------------------------------------------

def _client():
    import company_profiles
    c = company_profiles.RestClient.from_env()
    if c is None:
        raise SystemExit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    return c


MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024  # a real tender document is single-digit MB; generous but bounded -
                                        # same "reject rather than silently truncate" reasoning as
                                        # assess_tender.MAX_DOCUMENT_BYTES, just a smaller cap for this CLI's
                                        # own handful of formats (pdf/docx/doc/txt/xlsx/xlsm).
TEXT_DOC_EXTS = {"pdf", "docx", "doc", "txt"}
SPREADSHEET_EXTS = {"xlsx", "xlsm"}


def _ext_of(url_or_name):
    return os.path.splitext((url_or_name or "").split("?")[0])[1].lower().lstrip(".")


def _download_bytes(url, timeout=30):
    """(bytes, error). Honest degrade-not-crash, same contract as
    assess_tender.fetch_pdf_text: a dead link, a timeout or an oversized
    response never takes out the whole batch run, only this one document.

    Simpler than assess_tender.fetch_pdf_text()'s own download (no background
    thread with a hard wall-clock deadline past urlopen's own per-read
    timeout) - that extra machinery exists there because a live, unattended
    daily pipeline hanging on one bad host is a real incident; this is a
    bounded, operator-run batch CLI (--limit), where urlopen's own timeout is
    an honest, simpler trade-off, stated plainly rather than silently copied
    in without the same justification."""
    import urllib.error
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read(MAX_DOWNLOAD_BYTES + 1)
            if len(data) > MAX_DOWNLOAD_BYTES:
                return None, f"response exceeds the {MAX_DOWNLOAD_BYTES}-byte cap"
            return data, None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError) as e:
        return None, f"could not download document: {e}"


def _read_document_text(url, timeout=30):
    """(text, error) for one document URL, whichever text format it is. PDFs
    reuse assess_tender.fetch_pdf_text() (read-only reuse of this repo's own
    hardened PDF downloader - never modified here); everything else is
    downloaded here and read with engine/general/requirements.read_document()
    (the richer, already-existing document reader this task's brief named -
    confirmed not wired into the live discovery feed, reused rather than a
    third PDF/docx-reading path)."""
    ext = _ext_of(url)
    if ext == "pdf":
        import assess_tender
        return assess_tender.fetch_pdf_text(url, timeout=timeout)
    if ext not in TEXT_DOC_EXTS:
        return "", f"'{ext or 'unknown'}' is not a text document format this reader handles"
    data, err = _download_bytes(url, timeout=timeout)
    if err:
        return "", err
    import shutil
    import tempfile
    general_dir = os.path.join(os.path.dirname(HERE), "general")
    if general_dir not in sys.path:
        sys.path.insert(0, general_dir)
    import requirements as _requirements
    work_dir = tempfile.mkdtemp(prefix="tender_enrich_")
    try:
        path = os.path.join(work_dir, f"doc.{ext}")
        with open(path, "wb") as f:
            f.write(data)
        doc = {"name": os.path.basename(url), "path": path, "format": ext}
        _requirements.read_document(doc, work_dir)
        if doc.get("unreadable"):
            return "", doc["unreadable"]
        return doc.get("text") or "", None
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _tender_context(client, tender):
    """{"documents": [{"title","url"}, ...], "buyer": str|None} for one
    tenders row - from discovered_opportunities (tender_id FK), the direct
    buyer-site document links AND the buyer name captured at discovery time
    for an eTenders/general tender (seed_supabase_opportunities.to_row()).
    `tenders` itself has no `buyer` column (migration 0001) - this is the
    only place that name is recorded for a tender that went through
    Discovery, so it has to be read from here, not guessed from the title.
    A tender can have more than one discovered_opportunities row (one per
    company) with the same document_urls/buyer; documents are de-duplicated
    by URL.

    SANRAL tenders' own tender_documents rows are BLANK TEMPLATE workbooks
    uploaded by hand (migration 0001: "the blank SANRAL template files...
    downloaded manually... uploaded once per tender"), not the tender's real
    scope/BOQ content, so they are deliberately not read here - a SANRAL
    tender's scope already comes from its own title/description (the
    heuristic path, untouched), and its real financial/technical workbooks
    are a company's own business decision (fill_financial.py), not a buyer
    document to mine for scope text."""
    try:
        opps = client.select("discovered_opportunities", {"tender_id": tender["id"]})
    except Exception:
        return {"documents": [], "buyer": None}
    seen, docs, buyer = set(), [], None
    for o in opps:
        buyer = buyer or o.get("buyer")
        for d in o.get("document_urls") or []:
            url = d.get("url")
            if url and url not in seen:
                seen.add(url)
                docs.append(d)
    return {"documents": docs, "buyer": buyer}


def _boq_candidate_document(documents):
    """The first document whose own title looks like a BOQ/pricing schedule
    AND is a spreadsheet format - detect_boq_reference()'s own title-matching
    regex, reused rather than duplicated. None when nothing qualifies (never
    a guess at which attachment to download)."""
    for d in documents or []:
        url = (d or {}).get("url")
        name = (d or {}).get("title") or ""
        if url and _BOQ_MENTION_RE.search(re.sub(r"[_.\-]+", " ", name)) and _ext_of(url) in SPREADSHEET_EXTS:
            return d
    return None


def _fetch_boq_items(documents, log=print):
    """Downloads and parses the tender's own candidate BOQ document, if one
    exists and is reachable. None when there is nothing to try, or the
    download/parse didn't yield any confident items - detect_boq_reference()
    already honestly reports why in that case; this never raises, same
    "one bad document never fails the batch" discipline as everything else
    in this CLI."""
    doc = _boq_candidate_document(documents)
    if doc is None:
        return None
    data, err = _download_bytes(doc["url"])
    if err:
        log(f"    BOQ document '{doc.get('title')}' could not be downloaded: {err}")
        return None
    import io
    result = _boq_extraction.parse_boq_workbook(io.BytesIO(data))
    if not result["items"]:
        log(f"    BOQ document '{doc.get('title')}': {result['note']}")
        return None
    log(f"    {result['note']}")
    return result["items"]


def _llm_scope_result(document_text, title, buyer, log=print):
    """The LLM scope fallback's own result tuple, or None - never raises:
    a missing ANTHROPIC_API_KEY or any transient API problem degrades this
    ONE tender to the heuristic result (logged), not the whole batch."""
    try:
        return _scope_llm.extract_scope_summary_llm(document_text, title, buyer)
    except _scope_llm.SetupError as e:
        log(f"    LLM scope pass not available: {e}")
        return None
    except _scope_llm.TransientError as e:
        log(f"    LLM scope pass skipped (transient problem): {e}")
        return None


def run(limit=None, all_tenders=False, fetch_documents=True, max_documents=3, log=print):
    client = _client()
    tax = _taxonomy.active()
    # RestClient.select() already pages past PostgREST's hard 1000-row-per-
    # request cap (see its own PAGE=1000 + offset loop) - the exact bug class
    # previously found and fixed in app/lib/marketPricing.ts (PR #111:
    # "silently reading a 2.5% sample of the real table, not the whole
    # thing"). Confirmed by READING select()'s own implementation before
    # writing this CLI, not assumed - and confirmed again by
    # test_company_profiles.py, a new test proving it pages a server capped
    # at 1000 rows past that boundary, the Python-equivalent of
    # marketPricing.spec.ts's own test for this. No fix was needed here.
    rows = client.select("tenders", order="created_at.asc")
    if not all_tenders:
        rows = [r for r in rows if not r.get("tags_updated_at")]
    if limit:
        rows = rows[:limit]
    log(f"Enriching {len(rows)} tender(s) ({'all' if all_tenders else 'unenriched only'})"
        f"{' with document fetch' if fetch_documents else ' (heuristic only, --no-documents)'}...")
    tender_updates, scope_rows = [], []
    for t in rows:
        label = t.get("slug") or t.get("contract_no") or t["id"]
        documents, buyer, document_text, boq_items, llm_result = [], None, None, None, None
        if fetch_documents:
            ctx = _tender_context(client, t)
            documents, buyer = ctx["documents"], ctx["buyer"]
            for d in documents[:max_documents]:
                url = d.get("url")
                if not url:
                    continue
                text, err = _read_document_text(url)
                if err:
                    log(f"  [{label}] document '{d.get('title')}' not read: {err}")
                    continue
                if text and len(text.strip()) > len(document_text or ""):
                    document_text = text
            boq_items = _fetch_boq_items(documents, log=lambda m: log(f"  [{label}] {m}"))
            if document_text:
                regex_summary, regex_source = extract_scope_summary(t.get("title"), t.get("description"), document_text)
                if regex_source != "document_scope_snippet":
                    llm_result = _llm_scope_result(document_text, t.get("title"), buyer,
                                                   log=lambda m: log(f"  [{label}] {m}"))
        result = enrich(t.get("title"), t.get("description"), documents=documents, document_text=document_text,
                        taxonomy=tax, boq_items=boq_items, llm_scope_result=llm_result)
        if result["needs_human_review"]:
            log(f"  [{label}] NEEDS HUMAN REVIEW: {result['source_note']}")
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
    confirmed = sum(1 for r in scope_rows if r["confidence"] == "document_confirmed")
    log(f"Updated tags on {len(tender_updates)} tender(s); wrote {len(scope_rows)} tender_scope_records row(s) "
        f"({confirmed} document_confirmed, {len(scope_rows) - confirmed} heuristic).")


def counts(log=print):
    """Real backlog-size numbers - no sample, no guess (per this task's own
    "propose, don't spend" discipline for the full-backfill decision): the
    true total tender count (paginated - see run()'s own comment) and how
    many already have a tender_scope_records row, split by confidence, vs.
    none at all."""
    client = _client()
    tenders = client.select("tenders")
    scope_rows = client.select("tender_scope_records")
    confidence_by_tender = {r["tender_id"]: r.get("confidence") for r in scope_rows}
    total = len(tenders)
    heuristic = sum(1 for t in tenders if confidence_by_tender.get(t["id"]) == "heuristic")
    confirmed = sum(1 for t in tenders if confidence_by_tender.get(t["id"]) == "document_confirmed")
    none_yet = total - heuristic - confirmed
    report = {
        "total_tenders": total,
        "tender_scope_records_heuristic": heuristic,
        "tender_scope_records_document_confirmed": confirmed,
        "no_tender_scope_record_yet": none_yet,
    }
    log(json.dumps(report, indent=2))
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--limit", type=int, default=None)
    r.add_argument("--all", action="store_true", help="re-enrich every tender, not just unenriched ones")
    r.add_argument("--no-documents", dest="fetch_documents", action="store_false",
                   help="heuristic only - skip fetching/reading each tender's own documents (no BOQ parse, no LLM call)")
    r.add_argument("--max-documents", type=int, default=3,
                   help="documents read per tender for the scope/BOQ pass (default 3)")
    sub.add_parser("counts")
    args = ap.parse_args()
    if args.cmd == "run":
        run(limit=args.limit, all_tenders=args.all, fetch_documents=args.fetch_documents,
            max_documents=args.max_documents)
    elif args.cmd == "counts":
        counts()


if __name__ == "__main__":
    main()
