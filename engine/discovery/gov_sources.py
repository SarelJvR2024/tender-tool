"""
Discovery: every automatable GOVERNMENT tender source, read and merged into
one list of releases (national, provincial and municipal buyers and SOEs -
no private-sector leads, nothing that needs a person to read a gazette).

Sources (each its own reader, each checked live 2026-10-17 - numbers in the
reader's docstring and in docs/specs/Government-Tender-Coverage-Findings.md):

  etenders_portal        National Treasury's eTenders portal, advertised tab
                         (2,211 open tenders, 408 buyers). Replaces the OCDS
                         API as the primary feed: same tenders, same ocid, but
                         with status, province, briefing, a working full page
                         read and a real bid number. OCDS is the fallback
                         (etenders_national.py) if the portal read fails.
  sanral                 SANRAL's own open-tenders list (list_tenders.py) plus
                         each open tender's detail page (detail.py: SCM/NRA bid
                         number, attached file names, closing date). Matched to
                         the portal on BOTH identifiers (contract number and NRA
                         bid number) it is ~99% on eTenders already
                         (Marketing-Pricing-Strategy.md 10.2: 72 of 73) - its
                         value is the CHANGES eTenders doesn't carry (later
                         closing dates, addenda) plus contractor subcontract
                         packages only nra.co.za lists.
  eskom_bulletin         Eskom's Tender Bulletin (eskom_bulletin.py): ~180
                         tenders + ~145 notices (bidders lists, cancellations,
                         validity extensions, awards). Most tenders are on the
                         portal too; the notices are the reason to read it.
  transnet_etenders      Transnet's own eTenders site (transnet_etenders.py):
                         104 open, most on the portal; documents incl. addenda.
  capetown_procurement   City of Cape Town's procurement portal RFQs
                         (capetown_procurement.py): 246 open, none on eTenders.
  sars_procurement       SARS's own Published Tenders page (sars_procurement.py):
                         5 open RFP/RFI entries checked 2026-10-18, run on its
                         own WordPress site rather than the central portal.
  cidb_tenders           cidb's OWN procurement (cidb_tenders.py, not the
                         contractor-registration system this product already
                         reads elsewhere) - 1 open of 34 listed, a small JSON
                         feed behind the "Current Tenders" page.
  dbsa_procurement       Development Bank of Southern Africa's open RFPs/RFRs
                         table (dbsa_procurement.py): 14 open of 14 listed
                         checked 2026-10-18.

merge() keeps one release per tender: a direct-site tender that is also on
the portal (any shared identifier - ref_keys(): the reference after
norm_ref() and, for SANRAL, every contract number and NRA bid number found in
the reference, title, description or SCM reference - and the portal row's
buyer is the same organisation) is folded into the portal release - the portal's
ocid stays its identity, the direct site is added to `listing_sources`, and
the two document lists are combined (a buyer's own site often carries the
addenda first). A direct-site tender the portal doesn't list is kept with
its own source-namespaced key (source_http.py explains why that key sits in
`ocid`). A direct-site tender that is still open on its buyer's own site but
sits in the portal's CLOSED tab (SANRAL extends a closing date on nra.co.za and
the portal keeps the original - NRA 2026/0754 (A): portal 15 Oct, SANRAL
6 Nov) is folded into that closed portal row, keeps the portal's ocid, and the
disagreement is recorded (`source_disagreements`) for tender_changes.py.

Usage:
    python3 gov_sources.py [--sources etenders_portal,sanral,...] [--no-documents]
        [--out releases.json] [--coverage-out coverage.json]
"""
import argparse
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

ALL_SOURCES = ("etenders_portal", "sanral", "eskom_bulletin", "transnet_etenders", "capetown_procurement",
               "sars_procurement", "cidb_tenders", "dbsa_procurement")
SOURCE_LABELS = {
    "etenders_portal": "eTenders portal (National Treasury)",
    "etenders_ocds": "eTenders OCDS feed (National Treasury)",
    "sanral": "SANRAL's own tender site",
    "eskom_bulletin": "Eskom Tender Bulletin",
    "transnet_etenders": "Transnet eTenders",
    "capetown_procurement": "City of Cape Town procurement portal",
    "sars_procurement": "SARS Published Tenders",
    "cidb_tenders": "cidb's own procurement",
    "dbsa_procurement": "DBSA open RFPs/RFRs",
}
# A direct-site tender is only folded into a portal row of the SAME buyer:
# reference numbers aren't unique across buyers ("RFQ 01/2026"). Every
# source in ALL_SOURCES that can fold into the portal needs an entry here -
# a source missing from this dict skips the buyer check entirely (_find()'s
# `not family or family.search(...)` - no family means always true), so its
# tenders can be folded into ANY portal row sharing its reference format,
# silently merging two unrelated tenders' documents/dates. QA-Edge-Case-
# Findings.md, 2026-10-18 (fourteenth run): sars_procurement/cidb_tenders/
# dbsa_procurement shipped without an entry here and reproduced exactly
# that - a SARS tender folded into an unrelated department's portal row on
# a coincidental "RFP14/2026" match, vanishing from the merged list while
# contaminating the other tender's documents.
BUYER_FAMILY = {
    "sanral": re.compile(r"sanral|national roads", re.I),
    "eskom_bulletin": re.compile(r"eskom", re.I),
    "transnet_etenders": re.compile(r"transnet", re.I),
    "capetown_procurement": re.compile(r"city of cape town", re.I),
    "sars_procurement": re.compile(r"\bsars\b|revenue service", re.I),
    "cidb_tenders": re.compile(r"\bcidb\b|construction industry development board", re.I),
    "dbsa_procurement": re.compile(r"\bdbsa\b|development bank of southern africa", re.I),
}
PORTAL_CLOSED_LOOKBACK = 3000  # newest rows of the portal's Closed tab checked for extended tenders
MIN_CONTAINED_REF = 8  # "one reference contains the other" only for references this long

# SANRAL's two identifiers for one tender: the contract number
# ("N.011-010-2027/1F", "X.003-081-2024/1R") and the NRA bid number
# ("NRA 2026/0754 (A)", written "NRA2026/754", "BID NUMBER: 2026/0754 (A)").
# Its own list shows one, the portal often the other - both are read from
# every text field and either one matching is a match.
SANRAL_CONTRACT = re.compile(r"\b([A-Z])\s*[.\-]?\s*(\d{3})\s*-\s*(\d{3})\s*-\s*(\d{4})\s*/\s*(\d[A-Z]{0,2})", re.I)
SANRAL_BID = re.compile(r"(?:NRA|BID\s*NUMBER)\s*:?\s*(?:NRA\s*)?(20\d\d)\s*/\s*0*(\d{1,4})(?:\s*\(?\s*([A-Z])\s*\))?", re.I)


def sanral_ids(*texts):
    keys = set()
    for t in texts:
        if not t:
            continue
        for m in SANRAL_CONTRACT.finditer(t):
            keys.add("SC:" + "".join(g.upper() for g in m.groups()))
        for m in SANRAL_BID.finditer(t):
            keys.add(f"NRA:{m.group(1)}/{int(m.group(2))}" + (m.group(3).upper() if m.group(3) else ""))
    return keys


def ref_keys(r):
    """Every identifier this release can be matched on."""
    keys = set()
    k = sh.norm_ref(r.get("contract_number"))
    if k:
        keys.add(k)
    if re.search(r"sanral|national roads", r.get("buyer") or "", re.I) or r.get("source") == "sanral":
        keys |= sanral_ids(r.get("contract_number"), r.get("title"), r.get("description"), r.get("scm_reference"))
        scm = (r.get("scm_reference") or "").strip()
        if re.fullmatch(r"20\d\d\s*/\s*\d{1,4}(\s*\(?[A-Z]\)?)?", scm, re.I):  # SCM reference "2026/0344"
            keys |= sanral_ids("NRA " + scm)
    return keys


# ---------------------------------------------------------------- SANRAL ---

def sanral_releases(with_details=True, log=print):
    """SANRAL's open list; with_details also reads each still-open tender's
    detail page (1 s apart, ~85 pages) for its SCM/NRA bid number - needed to
    match it to the portal - its attached file names (tender_changes.py diffs
    them) and the page's own closing date."""
    import list_tenders
    rows, total, total_filtered = list_tenders.fetch_tenders(page_size=300)
    out, seen = [], set()
    for r in rows:
        if r["reference"] in seen:
            continue
        seen.add(r["reference"])
        rel = sh.release(
            ocid=f"sanral:{r.get('slug') or sh.norm_ref(r['reference'])}",
            contract_number=r["reference"],
            title=sh.clean(r.get("description")),
            description=sh.clean(r.get("description")),
            buyer="South African National Roads Agency Soc Limited (SANRAL)",
            procurement_category=r.get("project_type"),
            closing_date=sh.iso_sast(r.get("closing_date")),
            # SANRAL's own copy sits behind a reCAPTCHA form (download_documents.py);
            # the portal's copy, when merged in, is a direct link.
            documents=[],
            source="sanral", source_id=r.get("slug"), source_url=r.get("detail_url"),
            status="advertised", province=r.get("province"), tender_type=r.get("project_type"),
        )
        if with_details and r.get("slug") and not rel["is_closed"]:
            import time
            import detail
            try:
                d = detail.fetch_detail(r["slug"])
                rel["scm_reference"] = d.get("scm_reference")
                if d.get("title"):
                    rel["title"] = sh.clean(d["title"])
                rel["documents"] = [{"title": f, "url": None} for f in d.get("attached_files") or []]
                rel["modified_date"] = sh.iso_sast(d.get("last_updated"))
                if sh.parse_sast(d.get("closing_date")):  # the page's date is SANRAL's current one
                    rel["list_closing_date"] = rel["closing_date"]
                    rel["closing_date"] = sh.iso_sast(d["closing_date"])
                    rel["is_closed"] = sh.is_past(rel["closing_date"])
            except Exception as e:
                log(f"  WARNING: SANRAL detail {r['slug']} failed: {e}")
            time.sleep(1.0)
        out.append(rel)
    log(f"  SANRAL list: {len(out)} rows, {sum(1 for x in out if not x['is_closed'])} still open "
        f"(SANRAL's own total_filtered {total_filtered})")
    return out


# ------------------------------------------------------------------ read ---

def read_source(name, with_documents=True, log=print):
    """(releases, notices) for one source. Notices are Eskom's non-tender
    bulletin entries (tender_changes.py reads them)."""
    if name == "etenders_portal":
        import etenders_portal
        return etenders_portal.fetch_releases("advertised", log=log), []
    if name == "etenders_ocds":
        import etenders_national
        today = datetime.date.today()
        raw = etenders_national.fetch_releases((today - datetime.timedelta(days=14)).isoformat(), today.isoformat())
        return [ocds_to_release(etenders_national.normalize(r)) for r in raw], []
    if name == "sanral":
        return sanral_releases(with_details=with_documents, log=log), []
    if name == "eskom_bulletin":
        import eskom_bulletin
        rels = eskom_bulletin.fetch_releases(with_documents=with_documents, log=log)
        return [r for r in rels if not r.get("notice_kind")], [r for r in rels if r.get("notice_kind")]
    if name == "transnet_etenders":
        import transnet_etenders
        return transnet_etenders.fetch_releases(with_documents=with_documents, log=log), []
    if name == "capetown_procurement":
        import capetown_procurement
        return capetown_procurement.fetch_rfqs(log=log), []
    if name == "sars_procurement":
        import sars_procurement
        return sars_procurement.fetch_releases(with_documents=with_documents, log=log), []
    if name == "cidb_tenders":
        import cidb_tenders
        return cidb_tenders.fetch_releases(log=log), []
    if name == "dbsa_procurement":
        import dbsa_procurement
        return dbsa_procurement.fetch_releases(log=log), []
    raise ValueError(f"unknown source {name!r}")


def ocds_to_release(n):
    """etenders_national.normalize() output -> the common shape (fallback path)."""
    return sh.release(**{k: v for k, v in n.items() if k != "is_closed"},
                      source="etenders_ocds", source_id=n.get("portal_id"),
                      source_url="https://www.etenders.gov.za/Home/opportunities?id=1", status=None)


# ----------------------------------------------------------------- merge ---

def _refs_match(a, b):
    if not a or not b:
        return False
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    return len(short) >= MIN_CONTAINED_REF and short in long_


def _merge_docs(primary, extra):
    seen = {(d.get("url") or "", (d.get("title") or "").lower()) for d in primary}
    titles = {(d.get("title") or "").lower() for d in primary if d.get("title")}
    out = list(primary)
    for d in extra:
        key = (d.get("url") or "", (d.get("title") or "").lower())
        if key in seen or ((d.get("title") or "").lower() in titles and d.get("title")):
            continue
        out.append(d)
        seen.add(key)
    return out


def _fold(hit, r, name):
    hit["listing_sources"] = hit["listing_sources"] + r["listing_sources"]
    hit["documents"] = _merge_docs(hit.get("documents") or [], [d for d in r.get("documents") or [] if d.get("url")])
    for f in ("briefing", "province", "tender_type", "description", "scm_reference"):
        if not hit.get(f) and r.get(f):
            hit[f] = r[f]
    if r.get("documents"):
        hit.setdefault("direct_documents", {})[name] = [d.get("title") for d in r["documents"]]
    if r.get("closing_date") and hit.get("closing_date") and \
            sh.parse_sast(r["closing_date"]) != sh.parse_sast(hit["closing_date"]):
        hit.setdefault("source_disagreements", []).append(
            {"field": "closing_date", "source": name, "value": r["closing_date"],
             "base_source": hit["source"], "base_value": hit["closing_date"]})


def _index(rels):
    idx = {}
    for r in rels:
        for k in ref_keys(r):
            idx.setdefault(k, []).append(r)
    return idx


def _lot_conflict(k, m):
    """k = 'NRA:2026/21' (no lot letter); m's own keys include 'NRA:2026/21B':
    m is one LOT of that bid, not the bid - not a match (SANRAL lists the bid
    and each lot separately)."""
    if not k.startswith("NRA:") or k[-1].isalpha():
        return False
    return any(o.startswith(k) and o[len(k):].isalpha() for o in ref_keys(m))


def _find(idx, r, family):
    keys = ref_keys(r)
    cands = [m for k in keys for m in idx.get(k, []) if not _lot_conflict(k, m)]
    if not cands and not any(k.startswith(("SC:", "NRA:")) for k in keys):
        # "One reference contains the other" only when there are no
        # structured SANRAL ids to go on (they're exact, and a containment
        # match would let "NRA20260021" swallow its lot "NRA20260021B").
        plain = sh.norm_ref(r.get("contract_number"))
        cands = [m for k, ms in idx.items() if not k.startswith(("SC:", "NRA:")) and _refs_match(plain, k) for m in ms]
    # Never fold two rows of the same source into each other (SANRAL lists
    # "NRA 2026/0021" and its lot "NRA 2026/0021 (B)" separately).
    cands = [m for m in cands if m.get("source") != r.get("source")
             and (not family or family.search(m.get("buyer") or ""))]
    return cands[0] if cands else None


def merge(by_source, portal_closed=None):
    """{source: [release]} -> one list, one release per tender (see module
    docstring). The portal (or the OCDS fallback) is the base; direct sources
    fold into it. portal_closed: recent rows of the portal's Closed tab - an
    open direct-site tender found only there is folded into that row (the
    portal kept the original closing date; the buyer's site moved it)."""
    base_name = "etenders_portal" if by_source.get("etenders_portal") else "etenders_ocds"
    merged = [dict(r, listing_sources=list(r["listing_sources"])) for r in by_source.get(base_name) or []]
    idx = _index(merged)
    closed_idx = _index(portal_closed or [])
    for name, rels in by_source.items():
        if name in ("etenders_portal", "etenders_ocds"):
            continue
        family = BUYER_FAMILY.get(name)
        for r in rels:
            hit = _find(idx, r, family)
            if hit is None and not r["is_closed"]:
                closed = _find(closed_idx, r, family)
                if closed is not None:
                    # The buyer's own site says it is still open: that wins for
                    # Discovery (status, closing date), the portal's ocid stays the identity.
                    hit = dict(closed, listing_sources=list(closed["listing_sources"]),
                               status="advertised", closing_date=r["closing_date"], is_closed=False)
                    hit.setdefault("source_disagreements", []).append(
                        {"field": "status", "source": name, "value": "advertised",
                         "base_source": closed["source"], "base_value": "closed",
                         "base_closing_date": closed["closing_date"]})
                    merged.append(hit)
                    for k in ref_keys(hit):
                        idx.setdefault(k, []).append(hit)
                    hit["listing_sources"] = hit["listing_sources"] + r["listing_sources"]
                    hit["documents"] = _merge_docs(hit.get("documents") or [], [d for d in r.get("documents") or [] if d.get("url")])
                    if r.get("documents"):
                        hit.setdefault("direct_documents", {})[name] = [d.get("title") for d in r["documents"]]
                    continue
            if hit is None:
                merged.append(dict(r))
                for k in ref_keys(r):
                    idx.setdefault(k, []).append(merged[-1])
                continue
            _fold(hit, r, name)
    return merged


# -------------------------------------------------------------- coverage ---

def coverage(by_source, merged):
    """Per source: listed, open, also on the portal, only here."""
    rows = {}
    for name, rels in by_source.items():
        only_here = [m for m in merged if [s["source"] for s in m["listing_sources"]] == [name]]
        rows[name] = {
            "label": SOURCE_LABELS.get(name, name),
            "listed": len(rels),
            "open": sum(1 for r in rels if not r["is_closed"]),
            "only_from_this_source": len(only_here),
            "also_on_portal": (None if name in ("etenders_portal", "etenders_ocds") else
                               len(rels) - len([m for m in only_here])),
        }
    return {
        "generated_at": datetime.datetime.now(sh.SAST).isoformat(),
        "sources": rows,
        "merged_total": len(merged),
        "merged_open": sum(1 for m in merged if not m["is_closed"]),
        "buyers": len({m.get("buyer") for m in merged}),
        "listed_by_more_than_one_source": sum(1 for m in merged if len(m["listing_sources"]) > 1),
    }


def fetch_all(sources=ALL_SOURCES, with_documents=True, log=print):
    """Reads every source (one failing source is logged and skipped, never
    fatal - the portal falling over falls back to the OCDS feed). Returns
    {releases, notices, by_source, coverage, errors}."""
    by_source, notices, errors = {}, [], {}
    for name in sources:
        try:
            rels, notes = read_source(name, with_documents=with_documents, log=log)
            by_source[name] = rels
            notices += notes
        except Exception as e:
            errors[name] = str(e)
            log(f"  WARNING: source {name} failed: {e}")
    if "etenders_portal" in sources and not by_source.get("etenders_portal"):
        log("  eTenders portal unavailable - falling back to the OCDS feed for eTenders buyers")
        try:
            by_source["etenders_ocds"] = read_source("etenders_ocds", log=log)[0]
        except Exception as e:
            errors["etenders_ocds"] = str(e)
    portal_closed = []
    if by_source.get("etenders_portal") and any(n in by_source for n in BUYER_FAMILY):
        try:
            import etenders_portal
            portal_closed = etenders_portal.fetch_releases("closed", limit=PORTAL_CLOSED_LOOKBACK, log=log)
        except Exception as e:
            errors["etenders_portal_closed"] = str(e)
    merged = merge(by_source, portal_closed)
    cov = coverage(by_source, merged)
    cov["errors"] = errors
    return {"releases": merged, "notices": notices, "by_source": by_source, "coverage": cov, "errors": errors,
            "portal_closed": portal_closed}


def releases_for_watch(sources=ALL_SOURCES, with_documents=True, log=print):
    """What watch_new_tenders.py scores: every open, merged release."""
    res = fetch_all(sources, with_documents=with_documents, log=log)
    return [r for r in res["releases"] if not r["is_closed"]], res


def published_since(releases, date_from):
    """Releases published on/after date_from (ISO date); a release with no
    publish date on its listing is kept (unknown is not old)."""
    cut = datetime.date.fromisoformat(date_from)
    out = []
    for r in releases:
        pub = sh.parse_sast(r.get("published_date") or r.get("opening_date"))
        if pub is None or pub.date() >= cut:
            out.append(r)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", default=",".join(ALL_SOURCES))
    ap.add_argument("--no-documents", action="store_true", help="skip per-tender document reads (Eskom, Transnet)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--coverage-out", default=None)
    args = ap.parse_args()
    res = fetch_all([s.strip() for s in args.sources.split(",") if s.strip()], with_documents=not args.no_documents)
    cov = res["coverage"]
    print(f"\n{cov['merged_total']} tenders ({cov['merged_open']} open) from {cov['buyers']} buyers; "
          f"{cov['listed_by_more_than_one_source']} listed by more than one source")
    for name, row in cov["sources"].items():
        print(f"  {row['label']:<42} listed {row['listed']:>5}  open {row['open']:>5}  "
              f"only here {row['only_from_this_source']:>5}" +
              (f"  also on portal {row['also_on_portal']:>4}" if row["also_on_portal"] is not None else ""))
    print(f"  Eskom notices (bidders lists, cancellations, extensions, awards): {len(res['notices'])}")
    for name, err in (res.get("errors") or {}).items():
        print(f"  ERROR {name}: {err}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump({"releases": res["releases"], "notices": res["notices"]}, f, indent=2)
        print(f"Wrote {args.out}")
    if args.coverage_out:
        with open(args.coverage_out, "w") as f:
            json.dump(cov, f, indent=2)
        print(f"Wrote {args.coverage_out}")


if __name__ == "__main__":
    main()
