"""
Discovery, direct buyer reader: Eskom's own Tender Bulletin
(tenderbulletin.eskom.co.za).

Eskom is the biggest single buyer on the eTenders portal (223 open ESKOM rows
plus 10 for its National Transmission Company on 17 Oct 2026), but it
publishes to its own bulletin first and not everything reaches the portal.
Checked live 2026-10-17:

  - the bulletin lists 325 entries, all with a closing date in the future;
  - 171 of them are on the portal under the same reference number;
  - of the other 154, about 130 are notices rather than tenders - bidders
    lists ("Publication of bidders' names"), regret letters, cancellations,
    tender-validity extensions, "updated" notices - and 23 are real tenders
    the portal doesn't list (9 published since 1 Sep 2026, e.g. E3263GXPARN2
    "Outside Plant MV Switchgear Upgrade at Arnot Power Station", E3630GXGPLET
    hydrogen production plant maintenance at Lethabo).

So the bulletin adds tenders the portal misses AND is the one place Eskom's
own change notices (cancellations, validity extensions, bidders lists) are
listed. This reader classifies each entry as a tender or a notice
(`notice_kind`); gov_sources.py feeds the tenders to Discovery and
tender_changes.py turns the notices into change events on the tender they
refer to.

Access: the bulletin is a single-page app; its data comes from a public JSON
API the page itself calls (found in the page's JS bundle):
    GET /webapi/api/Lookup/GetTender?TENDER_ID=      every published entry
    GET /webapi/api/Files/GetDocs?TENDER_ID=<id>     the entry's documents
    GET /webapi/api/Files/GetFile?FileID=<id>        one document (no form, no CAPTCHA:
                                                     checked, a 204,730-byte PDF came back)
No login. robots.txt is the SPA's index page (no rules). The contact e-mail
and the user id on each entry are dropped at parse time.

Not covered: Eskom's NTCSA bulletin (tenderbulletin.ntcsa.co.za) answers 403
to a script (Cloudflare) - its tenders still reach Discovery through the
portal ("Eskom National Transmission Company of South Africa").

Usage:
    python3 eskom_bulletin.py [--no-documents] [--out FILE.json]
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "eskom_bulletin"
API = "https://tenderbulletin.eskom.co.za/webapi/api"
PAGE_URL = "https://tenderbulletin.eskom.co.za/tender/{id}"
FILE_URL = API + "/Files/GetFile?FileID={id}"
PAUSE_S = 0.3

# Order matters: the first match names the notice. Matched on the reference
# number plus the first part of the header, where Eskom puts the notice word
# ("E3484CXMWPList of bidders", "MWP2524DXcancellatio", "REGRER LETTER ...").
NOTICE_PATTERNS = [
    ("cancellation", re.compile(r"cancel", re.I)),
    ("bidders_list", re.compile(r"bidder|list\s+of\s+bidders|publication\s+of\s+(the\s+)?(names|bidders)|names?\s+of\s+(the\s+)?bidders", re.I)),
    ("regret", re.compile(r"regre[tr]", re.I)),
    ("validity_extension", re.compile(r"validity", re.I)),
    ("closing_date_extension", re.compile(r"(tender|closing)\W{0,3}(date\W{0,3})?(extension|extended)|postpone", re.I)),
    ("award", re.compile(r"\baward|successful\s+bidder|intention\s+to\s+award", re.I)),
    ("addendum", re.compile(r"addend|amendment|clarification", re.I)),
]
# Notice words Eskom glues onto (or in front of) the original reference,
# longest first, removed as plain substrings ("CANCELLAE3122GXGPLET",
# "AWARDE1535GXGPLETR", "E3386CXMWPBIDDERSLIS", "E2778DXGOURegretLett").
REF_NOTICE_WORDS = re.compile("|".join([
    "cancellation", "cancellatio", "cancella", "cancel", "bidderslist", "bidders", "bidder", "list",
    "regretlett", "regret", "validity", "award", "publication", "publish", "extension", "names",
    "updated", "update"]), re.I)


def classify(entry):
    """'tender', or the kind of notice this bulletin entry is. Matched on the
    reference number (Eskom glues the notice word onto it:
    "E3484CXMWPList of bidders", "MWP2524DXcancellatio", "E2281GXMPTUTpublish")
    plus the start of the header ("REGRER LETTER ...", "TENDER CLOSING
    EXTENDED: ...") - only the start, so "...EXECUTIVE OFFICE EXTENSION AT
    MEGAWATT PARK" (a building extension, a real tender) stays a tender."""
    ref = entry.get("REFERENCE") or ""
    head = f"{ref} {(entry.get('HEADER_DESC') or '')[:45]}"
    for kind, pat in NOTICE_PATTERNS:
        if pat.search(head):
            return kind
    if re.search(r"publish", ref, re.I):
        return "bidders_list"
    return "tender"


def base_reference(ref):
    """The tender a notice refers to: 'E3484CXMWPList of bidders' -> 'E3484CXMWP',
    'VALIDITYE2442DXFSOU' -> 'E2442DXFSOU', 'MWP2473DXREGRET' -> 'MWP2473DX'.
    A plain reference comes back unchanged."""
    s = REF_NOTICE_WORDS.sub(" ", (ref or "").strip())
    parts = [p for p in s.split() if re.search(r"\d{3,}", p)]
    return parts[0] if parts else (ref or "").strip()


def fetch_entries():
    return sh.http_json(f"{API}/Lookup/GetTender?TENDER_ID=", timeout=180)


def fetch_documents(tender_id):
    docs = sh.http_json(f"{API}/Files/GetDocs?TENDER_ID={tender_id}", timeout=60) or []
    return [{"title": d.get("NAME"), "url": FILE_URL.format(id=d.get("ID")),
             "date_modified": sh.iso_sast(d.get("CDATE"))} for d in docs if d.get("ID")]


def normalize(entry, docs=None):
    kind = classify(entry)
    title = sh.clean(entry.get("HEADER_DESC")) or sh.clean(entry.get("SUMMARY"))
    rel = sh.release(
        ocid=f"eskom-bulletin:{entry['TENDER_ID']}",
        contract_number=sh.clean(entry.get("REFERENCE")),
        title=title,
        description=sh.clean(entry.get("SCOPE_DETAILS")) or title,
        buyer="ESKOM" + (f" - {sh.clean(entry.get('DESCRIPTION')).title()}" if entry.get("DESCRIPTION") else ""),
        procurement_category=None,
        closing_date=sh.iso_sast(entry.get("CLOSING_DATE")),
        opening_date=sh.iso_sast(entry.get("PUBLISHEDDATE")),
        documents=docs or [],
        source=SOURCE, source_id=str(entry["TENDER_ID"]),
        source_url=PAGE_URL.format(id=entry["TENDER_ID"]),
        status="advertised" if kind == "tender" else None,
        province=sh.clean(entry.get("Province")),
        tender_type=("Pre-qualified suppliers only" if (entry.get("Audience") or "").lower().startswith("pre")
                     else None),
        published_date=sh.iso_sast(entry.get("PUBLISHEDDATE")),
        modified_date=sh.iso_sast(entry.get("DATEMODIFIED")),
    )
    rel["notice_kind"] = None if kind == "tender" else kind
    rel["refers_to_reference"] = base_reference(entry.get("REFERENCE")) if kind != "tender" else None
    rel["office_location"] = sh.clean(entry.get("OFFICE_LOCATION"))
    return rel


def fetch_releases(with_documents=True, log=print):
    """Every bulletin entry, normalised. with_documents: one GetDocs call per
    TENDER (not per notice), paused - about 200 calls."""
    entries = fetch_entries()
    out = []
    for e in entries:
        docs = None
        if with_documents and classify(e) == "tender" and e.get("DOCS"):
            try:
                docs = fetch_documents(e["TENDER_ID"])
            except Exception as ex:  # one entry's documents failing must not lose the listing
                log(f"  WARNING: Eskom documents for {e.get('REFERENCE')} failed: {ex}")
            time.sleep(PAUSE_S)
        out.append(normalize(e, docs))
    tenders = sum(1 for r in out if not r["notice_kind"])
    log(f"  Eskom Tender Bulletin: {len(out)} entries ({tenders} tenders, {len(out) - tenders} notices)")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-documents", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rels = fetch_releases(with_documents=not args.no_documents)
    from collections import Counter
    print("  kinds:", dict(Counter(r["notice_kind"] or "tender" for r in rels)))
    for r in [r for r in rels if not r["notice_kind"]][:15]:
        print(f"  {r['contract_number']:>18}  closes {r['closing_date']}  {r['buyer']}  -  {(r['title'] or '')[:60]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rels, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
