"""
Reads a document that was added to a tender AFTER it was discovered and says
what it is: an addendum, a clarification, a cancellation, a revised form, or
just a late supporting document - and what it changes, quoted from its own
text. Pure functions (no network, no database): watch_tender_updates.py does
the fetching and the storing, this decides.

Sarel, 2026-10-17: "They sometimes change the date or sometimes issue
addendums to a tender ... in some of the addendums and additional documents,
there is sometimes changes in the tender and changes of closing dates ...
we need to inform of changes of dates, because that might also allow someone
to tender for something if they have more time."

Wording patterns are taken from real addenda on the live eTenders feed
(2026-10-17), not invented:
  - EC Department of Transport SCMU10-26/27-0017 "ADDENDUM No.1": "This
    addendum serves to extend the closing date ... CLOSING DATE IS EXTENDED
    TO FRIDAY 06 NOVEMBER 2026 AT 11:00 AM", plus a QUERY / RESPONSE /
    AMENDMENT table (vehicle ownership rule reworded, allocation criteria
    re-ordered, a price-adjustment clause added).
  - Dept of Water and Sanitation WTE1062CE / WTE1063CE / WTE1059CE "ADDENDUM
    NO 01" (scanned - read by OCR): "THE FOLLOWING AMENDMENT IS MADE TO THE
    TENDER DOCUMENT ... Original Site Briefing Date: [22 October 2026]
    Revised Site Briefing Date: [27 October 2026]".
  - MICT SETA "AMENDED RFQ-MICT-75-2026" (an amended re-issue of the whole
    RFQ, named so only in its file name), JTC0014/2026-27 "(Addendum)", and
    late-added plain supporting documents (a functionality-criteria sheet, an
    annexure, a BoQ) as the negative case.

What it deliberately does NOT do:
  - decide a closing date from a date that merely appears in the text. Only
    an explicit change statement ("closing date is extended to ...", "new
    closing date: ...", "Original ... / Revised closing date ...") counts.
  - paraphrase. Every change it reports carries the line it came from.
"""
import datetime
import re

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}
MONTHS.update({m[:3]: i for m, i in list(MONTHS.items())})
MONTHS["sept"] = 9

_WEEKDAY = r"(?:\b(?:mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?\.?,?\s+)?"
_MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
# "06 NOVEMBER 2026", "Friday 6th of November 2026", "6 Nov. 2026",
# "2026-11-06", "06/11/2026", "06.11.2026". [ and ( are allowed in front
# (WTE1062CE prints dates in brackets; OCR turned one bracket into "(").
DATE = (r"[\[(]?\s*" + _WEEKDAY +
        r"(?:(?P<d>\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?P<m>" + _MONTH + r")\.?,?\s+(?P<y>20\d\d)"
        r"|(?P<iy>20\d\d)[-/](?P<im>\d{1,2})[-/](?P<id>\d{1,2})"
        r"|(?P<nd>\d{1,2})[/.](?P<nm>\d{1,2})[/.](?P<ny>20\d\d))")
TIME = r"(?:\s*(?:at|@|,)?\s*(?P<time>\d{1,2}\s*[:hH.]\s*\d{2})\s*(?:am|pm|hrs|h)?)?"

ADDENDUM_RE = re.compile(r"\baddend(?:um|a)\b|\bamendments?\b|\bcorrigendum\b|\berratum\b|\bamended\b|\bnotice\s+to\s+(?:bidders|tenderers)\b"
                         r"|\bextension\s+of\s+(?:the\s+)?closing\s+date\b", re.I)
CLARIFICATION_RE = re.compile(r"\bclarifications?\b|\bquestions?\s+and\s+answers?\b|\bresponses?\s+to\s+(?:bidders['’]?\s+)?(?:queries|questions)\b"
                              r"|\bminutes\s+of\s+(?:the\s+)?(?:compulsory\s+|non-compulsory\s+)?(?:site\s+)?(?:briefing|clarification)", re.I)
CANCELLATION_RE = re.compile(r"\b(?:tender|bid|rfq|rfp|quotation|request\s+for\s+(?:quotation|proposal|bid))s?\s+(?:is|has\s+been|was|are|have\s+been)\s+(?:hereby\s+)?(?:cancell?ed|withdrawn)\b"
                             r"|\bnotice\s+of\s+(?:cancell?ation|withdrawal)\b|\bcancell?ation\s+of\s+(?:the\s+)?(?:tender|bid|rfq|rfp)\b", re.I)
REVISED_TITLE_RE = re.compile(r"\brevised\b|\bupdated\b|\bamended\b|\breplacement\b|\brev\b\.?\s*\d|\bversion\s*\d", re.I)

CLOSING = r"(?:closing|submission|due)\s+date(?:\s+and\s+time)?"
CLOSING_CHANGE_RES = [
    # "CLOSING DATE IS EXTENDED TO FRIDAY 06 NOVEMBER 2026 AT 11:00 AM"
    re.compile(CLOSING + r"[^.\n]{0,60}?\b(?:is|has\s+been|will\s+be|was|are)?\s*(?:hereby\s+)?(?:now\s+)?"
               r"(?:extended|changed|amended|moved|postponed|revised|shifted|brought\s+forward|rescheduled)\s+(?:to|until|till)\s+(?:the\s+)?" + DATE + TIME, re.I),
    # "New closing date: 6 November 2026", "Revised closing date - ..."
    re.compile(r"(?:new|revised|amended|extended|updated)\s+" + CLOSING + r"\s*(?:is|will\s+be|:|-|–|=)?\s*(?:now\s+)?(?:the\s+)?" + DATE + TIME, re.I),
    # "extension of the closing date ... to 6 November 2026"
    re.compile(r"extension\s+of\s+(?:the\s+)?" + CLOSING + r"[^.\n]{0,80}?\b(?:to|until)\s+(?:the\s+)?" + DATE + TIME, re.I),
    # "the closing date has been extended from 26 October 2026 to 6 November 2026"
    re.compile(CLOSING + r"[^.\n]{0,60}?\bfrom\s+" + DATE.replace("?P<", "?P<p") + r"[^.\n]{0,30}?\bto\s+(?:the\s+)?" + DATE + TIME, re.I),
    # "tender will now close on 6 November 2026"
    re.compile(r"(?:tender|bid|rfq|quotation)s?\s+will\s+now\s+close\s+on\s+(?:the\s+)?" + DATE + TIME, re.I),
]
ORIGINAL_CLOSING_RE = re.compile(r"(?:original|previous|old|initial)\s+" + CLOSING + r"\s*(?:was|:|-|–)?\s*" + DATE, re.I)

BRIEFING = r"(?:compulsory\s+|non-compulsory\s+|clarification\s+)?(?:site\s+)?(?:briefing|clarification\s+meeting|site\s+(?:visit|inspection|meeting))(?:\s+session|\s+meeting)?"
BRIEFING_NEW_RES = [
    re.compile(r"(?:revised|new|amended|rescheduled|changed)\s+" + BRIEFING + r"(?:\s+date)?\s*[:\-–]?\s*" + DATE + TIME, re.I),
    re.compile(BRIEFING + r"[^.\n]{0,60}?\b(?:is|has\s+been|will\s+be)?\s*(?:hereby\s+)?(?:postponed|moved|changed|rescheduled|amended|shifted)\s+(?:to|until)\s+(?:the\s+)?" + DATE + TIME, re.I),
]
BRIEFING_OLD_RE = re.compile(r"(?:original|previous|old|initial)\s+" + BRIEFING + r"(?:\s+date)?\s*[:\-–]?\s*" + DATE, re.I)
BRIEFING_CANCELLED_RE = re.compile(BRIEFING + r"[^.\n]{0,40}?\b(?:is|has\s+been)\s+(?:hereby\s+)?(?:cancell?ed|no\s+longer\s+compulsory|made\s+non-compulsory)", re.I)

# Lines in an addendum that state a change to the tender itself. Each kind is
# a real wording seen in a real addendum or in the SANRAL/CIDB standard
# addendum language ("delete ... and replace with", "shall now read").
OTHER_CHANGE_RES = [
    ("scope", re.compile(r"\bscope\s+of\s+(?:work|works|services)\b[^.\n]{0,80}\b(?:amended|changed|revised|reduced|increased|extended|replaced)\b"
                         r"|\b(?:amended|revised|changed)\s+scope\b", re.I)),
    ("requirement_removed", re.compile(r"\b(?:is|are|has\s+been|have\s+been)\s+(?:hereby\s+)?(?:deleted|removed|withdrawn)\b|\bno\s+longer\s+(?:required|applicable|compulsory|a\s+requirement)\b"
                                       r"|\bis\s+not\s+(?:a\s+)?(?:required|compulsory|mandatory)\b|\bomit(?:ted)?\b", re.I)),
    ("wording_replaced", re.compile(r"\b(?:shall|should|will)\s+(?:now\s+)?read\b|\bnow\s+reads?\b|\bamended\s+to\s+read\b|\breplaced?\s+(?:with|by)\b|\bcorrected\s+to\b|\bsubstituted\s+(?:with|by)\b", re.I)),
    ("pricing", re.compile(r"\b(?:bill\s+of\s+quantities|boq|price\s+schedule|pricing\s+schedule|rate\s+card)\b[^.\n]{0,60}\b(?:amended|revised|replaced|attached|updated|corrected)\b"
                           r"|\b(?:revised|amended|updated)\s+(?:bill\s+of\s+quantities|boq|price\s+schedule|pricing\s+schedule)\b|\bprice\s+(?:adjustment|escalation)\b", re.I)),
    ("evaluation", re.compile(r"\b(?:evaluation|functionality|allocation)\s+criteria\b[^.\n]{0,80}\b(?:amended|changed|revised|replaced|corrected|should\s+read|now\s+reads?)\b"
                              r"|\b(?:amended|revised|changed)\s+(?:evaluation|functionality|allocation)\s+criteria\b"
                              r"|\b(?:minimum\s+threshold|specific\s+goals?)\b[^.\n]{0,60}\b(?:amended|changed|revised|replaced|corrected|is\s+now)\b", re.I)),
    ("cidb", re.compile(r"\bcidb\b[^.\n]{0,50}\b(?:grading|designation|class)\b[^.\n]{0,40}\b(?:amended|changed|revised|corrected|should\s+read|is\s+now)\b", re.I)),
    ("validity", re.compile(r"\b(?:bid|tender)\s+validity\b[^.\n]{0,60}\b(?:extended|amended|changed)\b", re.I)),
]

MAX_QUOTES = 6
HEAD_CHARS = 6000  # an addendum states what it is near the top


def _clean(s):
    return re.sub(r"[ \t]+", " ", s or "").strip()


def _quote(text, start, end, width=170):
    """The line(s) a match sits on, trimmed - the evidence shown to the user."""
    a = text.rfind("\n", 0, start) + 1
    b = text.find("\n", end)
    b = len(text) if b < 0 else b
    q = _clean(text[a:b].replace("\n", " "))
    if len(q) > width:
        mid = max(0, (start - a) - width // 3)
        q = ("…" if mid else "") + q[mid:mid + width].strip() + "…"
    return q


def _date_from(m, prefix=""):
    g = m.groupdict()
    try:
        if g.get(prefix + "d"):
            name = g[prefix + "m"].lower().rstrip(".")
            return datetime.date(int(g[prefix + "y"]), MONTHS.get(name) or MONTHS[name[:3]], int(g[prefix + "d"]))
        if g.get(prefix + "iy"):
            return datetime.date(int(g[prefix + "iy"]), int(g[prefix + "im"]), int(g[prefix + "id"]))
        if g.get(prefix + "nd"):
            # South African documents write day/month/year.
            return datetime.date(int(g[prefix + "ny"]), int(g[prefix + "nm"]), int(g[prefix + "nd"]))
    except (ValueError, KeyError):
        return None
    return None


def _time_from(m):
    t = (m.groupdict().get("time") or "").strip()
    if not t:
        return None
    hh, mm = re.split(r"\s*[:hH.]\s*", t)[:2]
    try:
        h, mi = int(hh), int(mm)
    except ValueError:
        return None
    return f"{h:02d}:{mi:02d}" if h < 24 and mi < 60 else None


def to_date(value):
    """A tenders.closing_date / OCDS endDate / SANRAL '2026/11/19 12:00' as a
    date, in SAST (UTC+2) like app/lib/dates.ts closingDayOf()."""
    if not value:
        return None
    if isinstance(value, datetime.date) and not isinstance(value, datetime.datetime):
        return value
    s = str(value).strip().replace("/", "-")
    try:
        ts = datetime.datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        try:
            return datetime.date.fromisoformat(s[:10])
        except ValueError:
            return None
    if ts.tzinfo:
        ts = ts.astimezone(datetime.timezone(datetime.timedelta(hours=2)))
    return ts.date()


def find_closing_change(text):
    """(new_date, time, quote, previous_in_document) or None. Only explicit
    change statements, first one wins (an addendum states it once, then
    repeats the old date in its "reads / should read" table)."""
    best = None
    for rx in CLOSING_CHANGE_RES:
        for m in rx.finditer(text):
            d = _date_from(m)
            if not d:
                continue
            prev = _date_from(m, "p") if m.groupdict().get("pd") or m.groupdict().get("piy") or m.groupdict().get("pnd") else None
            cand = (m.start(), d, _time_from(m), _quote(text, m.start(), m.end()), prev)
            if best is None or cand[0] < best[0]:
                best = cand
            break
    if not best:
        return None
    _, d, t, q, prev = best
    if prev is None:
        om = ORIGINAL_CLOSING_RE.search(text)
        prev = _date_from(om) if om else None
    return d, t, q, prev


def find_briefing_change(text):
    for rx in BRIEFING_NEW_RES:
        m = rx.search(text)
        if m and _date_from(m):
            om = BRIEFING_OLD_RE.search(text)
            prev = _date_from(om) if om else None
            quote = _quote(text, m.start(), m.end())
            if om:
                quote = _quote(text, om.start(), om.end()) + " / " + quote
            return {"date": _date_from(m).isoformat(), "time": _time_from(m),
                    "previous_date": prev.isoformat() if prev else None, "quote": quote}
    m = BRIEFING_CANCELLED_RE.search(text)
    if m:
        return {"date": None, "time": None, "previous_date": None, "cancelled": True,
                "quote": _quote(text, m.start(), m.end())}
    return None


def find_other_changes(text, skip_quotes=()):
    out, seen = [], set(skip_quotes)
    for kind, rx in OTHER_CHANGE_RES:
        for m in rx.finditer(text):
            q = _quote(text, m.start(), m.end())
            if q in seen or len(q) < 12:
                continue
            seen.add(q)
            out.append({"kind": kind, "quote": q})
            break  # one line per kind is enough to tell the user to read it
        if len(out) >= MAX_QUOTES:
            break
    return out


def _fmt(d):
    return d.strftime("%a %d %b %Y") if d else "?"


def classify_document(title, text, read_basis, closing_on_file=None, listing_closing=None, briefing_on_file=None):
    """What a newly-added tender document is, and what it changes.

    title           the file name / OCDS title
    text            its extracted text ('' when it couldn't be read)
    read_basis      'text' | 'ocr' | 'title_only'
    closing_on_file tenders.closing_date before this check
    listing_closing the source listing's closing date now (OCDS
                    tenderPeriod.endDate / SANRAL page), or None
    briefing_on_file tenders.briefing_date before this check (0048), or None

    Returns {kind, urgency, summary, changes}. kind is one of addendum,
    clarification, cancellation, revised_document, supporting_document."""
    title = title or ""
    text = text or ""
    head = text[:HEAD_CHARS]
    caveats = []
    changes = {}

    closing = find_closing_change(text) if text else None
    briefing = find_briefing_change(text) if text else None
    on_file = to_date(closing_on_file)
    listing = to_date(listing_closing)

    if closing:
        new, t, quote, prev_doc = closing
        base = on_file
        if base == new and prev_doc and prev_doc != new:
            base = prev_doc  # the date on file was already updated; the document says what it was
        direction = "unknown" if not base else "later" if new > base else "earlier" if new < base else "same"
        changes["closing_date"] = {
            "date": new.isoformat(), "time": t, "quote": quote,
            "previous_on_file": on_file.isoformat() if on_file else None,
            "previous_in_document": prev_doc.isoformat() if prev_doc else None,
            "direction": direction,
            "listing_date": listing.isoformat() if listing else None,
            "listing_agrees": bool(listing and listing == new),
            "applied": False,
        }
        if read_basis == "ocr":
            caveats.append("The new closing date was read by OCR from a scanned addendum - check it against the scan.")
        if listing and listing != new:
            caveats.append(f"The listing still shows {_fmt(listing)}, not the {_fmt(new)} in the document - confirm with the buyer.")
    if briefing:
        # Whether the briefing date may be written to tenders.briefing_date and
        # the briefing milestones (watch_tender_updates.apply_briefing_date).
        # There is no listing field to corroborate a briefing date against
        # (eTenders' OCDS release has none), so the check is the document
        # against itself: its "original" date must be the one on file, or
        # nothing may be on file. A contradiction is recorded, not applied -
        # a person can accept it from the Tender Workspace.
        b_on_file = to_date(briefing_on_file)
        if not briefing.get("cancelled"):
            prev = briefing.get("previous_date")
            agrees = b_on_file is None or b_on_file.isoformat() in (prev, briefing["date"])
            briefing.update({"previous_on_file": b_on_file.isoformat() if b_on_file else None,
                             "on_file_agrees": bool(agrees), "applied": False})
            if read_basis == "ocr":
                caveats.append("The new briefing date was read by OCR from a scanned addendum - check it against the scan.")
            if not agrees:
                caveats.append(f"The briefing date on file is {_fmt(b_on_file)}, but this document says the original was "
                               f"{_fmt(datetime.date.fromisoformat(prev)) if prev else 'not stated'} - check which is right.")
        changes["briefing"] = briefing
    skip = [c["quote"] for c in changes.values() if isinstance(c, dict) and c.get("quote")]
    others = find_other_changes(text, skip) if text else []

    cancelled = bool(CANCELLATION_RE.search(head) or CANCELLATION_RE.search(title))
    text_says_addendum = bool(ADDENDUM_RE.search(head))
    title_says_addendum = bool(ADDENDUM_RE.search(title))
    text_says_clar = bool(CLARIFICATION_RE.search(head))
    title_says_clar = bool(CLARIFICATION_RE.search(title))

    if cancelled:
        kind = "cancellation"
    elif closing or briefing or text_says_addendum or title_says_addendum:
        kind = "addendum"
    elif text_says_clar or title_says_clar:
        kind = "clarification"
    elif REVISED_TITLE_RE.search(title):
        kind = "revised_document"
    else:
        kind = "supporting_document"
    if kind != "addendum":
        others = others if kind in ("clarification", "revised_document") else []
    if title_says_addendum and not (text_says_addendum or closing or briefing) and read_basis != "title_only" and len(text.strip()) > 200:
        caveats.append("The file name says this is an addendum or amended version, but its text doesn't state what changed - "
                       "compare it with the earlier documents (it may also be a form the buyer labelled that way).")
    if read_basis == "title_only":
        caveats.append("The document's text couldn't be read, so this is based on its file name only - open it.")
    if others:
        changes["other_changes"] = others
    if caveats:
        changes["caveats"] = caveats

    cd = changes.get("closing_date")
    if kind == "cancellation" or (cd and cd["direction"] == "earlier"):
        urgency = "critical"
    elif kind in ("addendum", "revised_document") or cd or briefing or (kind == "clarification" and others):
        urgency = "high"
    else:
        urgency = "info"

    label = {"addendum": "Addendum", "clarification": "Clarification", "cancellation": "Cancellation notice",
             "revised_document": "Revised document", "supporting_document": "New document"}[kind]
    bits = []
    if kind == "cancellation":
        bits.append("the buyer says this tender is cancelled or withdrawn")
    if cd:
        when = _fmt(datetime.date.fromisoformat(cd["date"])) + (f" {cd['time']}" if cd["time"] else "")
        was = cd["previous_in_document"] if cd["direction"] != "unknown" and cd["previous_on_file"] == cd["date"] else cd["previous_on_file"]
        was = f" (was {_fmt(datetime.date.fromisoformat(was))})" if was else ""
        if cd["direction"] == "later":
            bits.append(f"closing date moved LATER to {when}{was} - more time to prepare a bid")
        elif cd["direction"] == "earlier":
            bits.append(f"closing date brought FORWARD to {when}{was} - less time than planned")
        elif cd["direction"] == "same":
            bits.append(f"closing date stated as {when}, same as on file")
        else:
            bits.append(f"closing date stated as {when}")
    if briefing:
        if briefing.get("cancelled"):
            bits.append("briefing session cancelled or made non-compulsory")
        else:
            prev = f" from {_fmt(datetime.date.fromisoformat(briefing['previous_date']))}" if briefing.get("previous_date") else ""
            bits.append(f"briefing moved{prev} to {_fmt(datetime.date.fromisoformat(briefing['date']))}" + (f" {briefing['time']}" if briefing.get("time") else ""))
    if others:
        bits.append(f"{len(others)} other change{'s' if len(others) != 1 else ''} to the tender ({', '.join(sorted({o['kind'].replace('_', ' ') for o in others}))})")
    summary = f"{label}: " + ("; ".join(bits) if bits else (title or "untitled document"))
    if not bits and kind in ("addendum", "clarification", "revised_document"):
        summary += " - read it for what changed"
    return {"kind": kind, "urgency": urgency, "summary": summary, "changes": changes}
