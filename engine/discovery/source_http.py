"""
Shared plumbing for the direct government-buyer readers (etenders_portal.py,
eskom_bulletin.py, transnet_etenders.py, capetown_procurement.py, and the
SANRAL adapter in gov_sources.py): polite HTTP with retries, SAST date
parsing, tender-reference normalisation, and the one release shape every
reader returns.

The release shape is etenders_national.normalize()'s (ocid, contract_number,
title, description, buyer, procurement_category, closing_date, is_closed,
documents[{title, url}], awards, contracts, has_award_data) - so
assess_tender.read_release()/score_release(), watch_new_tenders.fan_out() and
seed_supabase_opportunities.to_row() take a release from any source unchanged -
plus listing fields only a buyer's own listing carries:

  source, source_id, source_url     where it was read, and its id there
  status                            'advertised' | 'cancelled' | 'closed' | 'awarded' | None
  province, tender_type             as the listing states them
  briefing                          {date, compulsory, venue} or None
  published_date, modified_date     the listing's own timestamps
  listing_sources                   [{source, source_id, url}] - every source that
                                    lists this tender (gov_sources.merge() fills it)

`ocid` is the OCDS ocid for a tender published through National Treasury's
eTenders portal (ocds-9t57fa-<portal id>, the join rule confirmed in
Award-Outcomes-Findings.md section 2). A tender only a buyer's own site lists
has no OCDS ocid, so `ocid` carries a source-namespaced stable key instead
(e.g. "eskom-bulletin:73478"). It is the listing's identity everywhere the
pipeline keys on ocid (the watch's seen store, discovered_opportunities'
(company_id, ocid) upsert, tenders.ocid on pursue), so a direct-site tender
is never inserted twice. gov_sources.merge() swaps it for the portal's real
ocid when the same tender is on both.
"""
import datetime
import json
import re
import time
import urllib.error
import urllib.request

USER_AGENT = "Mozilla/5.0 (tender-tool discovery; public tender listings)"
SAST = datetime.timezone(datetime.timedelta(hours=2))


def http_get(url, timeout=90, retries=3, backoff=2.0, headers=None):
    """Bytes of a GET. Retries on network errors and 5xx (government sites
    drop connections under load - seen on etenders.gov.za and nra.co.za);
    a 4xx is raised at once (it won't fix itself)."""
    h = {"User-Agent": USER_AGENT}
    h.update(headers or {})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = e
        time.sleep(backoff * (attempt + 1))
    raise RuntimeError(f"GET {url.split('?')[0]} failed after {retries} attempts: {last}")


def http_json(url, **kw):
    return json.loads(http_get(url, **kw).decode("utf-8", errors="replace"))


_US_DT = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$", re.I)


def parse_sast(value):
    """A listing's date/time -> aware datetime in SAST, or None. Accepts ISO
    ('2026-11-16T12:00:00', with or without fraction/offset), US-style
    ('11/30/2026 3:00:00 PM', Transnet) and '2026/10/28' (Cape Town). A naive
    value is SAST (every SA government listing states local time). Year 1
    (the portal's '0001-01-01' placeholder) is None."""
    if not value:
        return None
    s = str(value).strip()
    dt = None
    m = _US_DT.match(s)
    if m:
        mo, d, y, hh, mm, ss, ap = m.groups()
        hh = int(hh or 0)
        if ap:
            hh = hh % 12 + (12 if ap.upper() == "PM" else 0)
        # The regex only checks digit counts, so "13/45/2026" or "11/30/2026
        # 25:00" reached datetime() and raised - out of every merge/change loop
        # over the whole feed (gov_sources, tender_changes), so one buyer's
        # typo dropped every other listing too. Unreadable = None, the same as
        # an unreadable ISO value just below.
        try:
            dt = datetime.datetime(int(y), int(mo), int(d), hh, int(mm or 0), int(ss or 0))
        except ValueError:
            return None
    else:
        s2 = s.replace("/", "-").replace("Z", "+00:00")
        s2 = re.sub(r"(\.\d{6})\d+", r"\1", s2)  # .9495246 -> .949524 (7-digit .NET fractions)
        try:
            dt = datetime.datetime.fromisoformat(s2)
        except ValueError:
            return None
    if dt.year < 1900:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SAST)
    return dt.astimezone(SAST)


def parse_utc(value):
    """A system timestamp (a document's or a cancellation's dateModified) ->
    aware datetime, or None. The eTenders portal gives these naive; its own
    OCDS export publishes the identical values with a 'Z', so a naive value
    here is UTC. (Closing, briefing and publish dates are local SAST -
    parse_sast - because OCDS's 'Z' on '...T12:00:00Z' closing times is
    plainly wrong: tenders close at local noon.)"""
    if not value:
        return None
    s = re.sub(r"(\.\d{6})\d+", r"\1", str(value).strip().replace("Z", "+00:00"))
    try:
        dt = datetime.datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.year < 1900:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)).astimezone(SAST)


def iso_utc(value):
    dt = parse_utc(value)
    return dt.isoformat() if dt else None


def iso_sast(value):
    dt = parse_sast(value) if not isinstance(value, datetime.datetime) else value
    return dt.isoformat() if dt else None


def is_past(value, now=None):
    dt = parse_sast(value)
    if dt is None:
        return False  # unknown is not expired - same rule as etenders_national.normalize()
    return dt <= (now or datetime.datetime.now(SAST))


_REF_PREFIX = re.compile(r"^\s*(?:CONTRACT\s+)?(?:SANRAL\s*)?(?:CONTRACT\s*)?[:\-]?\s*", re.I)


def norm_ref(ref):
    """Tender number -> a comparison key. Buyers type the same number several
    ways across their own site and the eTenders portal ("CONTRACT SANRAL:
    C.003-092-2024/1F" vs "C-003-092-2024/1F", "N.011-010-2027/1F" vs
    "N011-010-2027/1F ", trailing " - Bidders list"), so: drop a leading
    "CONTRACT [SANRAL]:" and keep only letters and digits, upper-cased."""
    if not ref:
        return ""
    s = _REF_PREFIX.sub("", str(ref))
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def clean(text):
    if text is None:
        return None
    t = re.sub(r"\s+", " ", str(text)).strip()
    return t or None


def release(**kw):
    """The common release dict, with every key present (None/[] defaults)."""
    base = {
        "ocid": None, "contract_number": None, "title": None, "description": None, "buyer": None,
        "procurement_category": None, "closing_date": None, "opening_date": None, "is_closed": False,
        "documents": [], "awards": [], "contracts": [], "has_award_data": False,
        "source": None, "source_id": None, "source_url": None, "status": None,
        "province": None, "tender_type": None, "briefing": None,
        "published_date": None, "modified_date": None, "listing_sources": [],
    }
    base.update(kw)
    if not base["listing_sources"] and base["source"]:
        base["listing_sources"] = [{"source": base["source"], "source_id": base["source_id"],
                                    "url": base["source_url"]}]
    base["is_closed"] = is_past(base["closing_date"])
    return base
