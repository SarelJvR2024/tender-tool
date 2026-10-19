"""
Listing-level change tracking for government tenders: cancellations,
re-advertisements, closing-date and briefing changes, newly listed documents,
and a buyer's own site disagreeing with eTenders - for EVERY tender in
Discovery's sources (gov_sources.py), pursued or not. This is what L2B's
Daily Advisory calls "cancellations, re-advertisements and amendments".

What each change is read from (all checked live 2026-10-17):

  cancelled               the eTenders portal's Cancelled tab (status=4),
                          newest first, with the buyer's reason and the time
                          ("Error by publisher ie. Incorrect date, incorrect
                          documents", 16 Oct 13:15). The OCDS feed can't show
                          this: those same tenders still came back from OCDS on
                          17 Oct with status '' and their original closing date.
                          Also Eskom bulletin cancellation notices.
  closing_date_changed    a listing's closing date differs from the last run's
  briefing_changed        snapshot (OCDS releases and portal rows are updated in
  title_changed           place - a release keeps its id, ocid + publish date,
                          and its content changes: ocds-9t57fa-174359 gained an
                          addendum on 17 Oct without a new release).
  document_added          a document name not in the last snapshot; on a tender's
                          FIRST sighting, any document whose own upload time is
                          a day or more after the tender was published (the
                          portal and OCDS stamp every document) - so a run with
                          no history still reports real addenda. Names only:
                          reading the document is watch_tender_updates.py's job
                          (0039, for pursued tenders) and is not duplicated here.
  sources_disagree        the buyer's own site and eTenders list different
                          closing dates, or the buyer's site says open while the
                          portal moved it to Closed (SANRAL extends on nra.co.za;
                          the portal keeps the original date).
  readvertised            the buyer listed the same bid number again with a
                          different closing date (relistings()), or a new listing that says so ("RE-ADVERTISEMENT",
                          "Re-Issue", a trailing R on the bid number is NOT used -
                          too many false hits) or whose buyer + title equal a
                          tender cancelled in the lookback window.
  validity_extended,      Eskom bulletin notices, attached to the tender they
  bidders_list_published, name when it is in the feed.
  award_published,
  regret_published

Storage: Supabase (tender_listing_snapshots / tender_listing_changes, 0051)
when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, else local
JSON files under state/ (gitignored). Every change has a dedupe_key (listing +
type + new value), so a re-run never records the same change twice.

Usage:
    python3 tender_changes.py [--sources ...] [--lookback-days 14]
        [--local] [--out changes.json] [--from-file gov_sources_out.json]
"""
import argparse
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "alerts"))
import source_http as sh  # noqa: E402
import system_alerts  # noqa: E402

STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "state")
LOCAL_SNAPSHOTS = os.path.join(STATE_DIR, "listing_snapshots.json")
LOCAL_CHANGES = os.path.join(STATE_DIR, "listing_changes.json")
SNAP_TABLE, CHANGE_TABLE = "tender_listing_snapshots", "tender_listing_changes"

ADDENDUM_NAME = re.compile(r"addend|amend|correct|revis|extension|extended|postpon|clarif|notice|cancel|updated", re.I)
READVERT = re.compile(r"\bre-?\s*advert|\bre-?advertis|\bre-?\s*issue|\breissue|\bre-?\s*tender\b", re.I)
# First sighting (no snapshot yet): a document uploaded after publication
# counts only if its NAME says addendum / notice / amended / extension...
# Measured on the 17 Oct 2026 run: 2,168 documents were uploaded a day or more
# after their tender was published - mostly drawings and annexures the buyer
# finished uploading - while the 597 with an addendum-like name were what they
# said ("Second Extension of Tender Closing Date to 28 October 2026.pdf",
# "Addendum no.1 NRA 2026-0169B.zip"), on 301 open tenders. After the first
# run every newly listed document counts (diffed against the snapshot).
LATE_DOC_GRACE = datetime.timedelta(days=1)
NOTICE_LOOKBACK = datetime.timedelta(days=60)  # Eskom notices older than this are history, not news

ESKOM_NOTICE_TYPES = {
    "cancellation": "cancelled", "validity_extension": "validity_extended",
    "closing_date_extension": "closing_date_changed", "bidders_list": "bidders_list_published",
    "award": "award_published", "regret": "regret_published", "addendum": "document_added",
}


def snapshot_of(r):
    return {
        "closing_date": r.get("closing_date"),
        "briefing_date": (r.get("briefing") or {}).get("date"),
        "status": r.get("status"),
        "title": r.get("title"),
        "documents": sorted({d.get("title") for d in r.get("documents") or [] if d.get("title")}),
        "sources": sorted({s["source"] for s in r.get("listing_sources") or []}),
    }


def _event(r, change_type, summary, old=None, new=None, when=None, evidence=None, key_extra=None):
    key = r.get("ocid") or f"{r.get('source')}:{r.get('contract_number')}"
    if key_extra is None:
        # A mutable field (closing/briefing date, title, a cross-source
        # disagreement) can genuinely revisit an earlier value: extended
        # B, reverted to A, extended to B again - three separate, real,
        # newsworthy changes. Keying only on `new` made the third one
        # collide with the first's dedupe_key and silently dropped it as
        # "already reported" (QA-Edge-Case-Findings.md, 2026-10-19 -
        # reproduced directly: a tender's closing date going A->B->A->B
        # across 4 runs only ever reported the first two changes, not the
        # fourth, identical-looking-but-genuinely-new extension). Bucketing
        # by the minute this run saw it still dedupes the one case this
        # mechanism actually exists for - calling detect()/save() again
        # before the first call's save() persisted (watch_new_tenders.py/
        # daily_digest.py both call tender_changes.run() once per scheduled
        # run, so a second call racing the same stale snapshot means an
        # operator or a retry-on-failure wrapper re-ran the same script
        # within seconds to a couple of minutes, never literally a whole
        # calendar day later) - without needing a whole day's width, which
        # would itself collide on a genuine third occurrence of the same
        # value reverted/re-set more than once within one calendar day
        # (confirmed by reproducing it: day-bucketing silently dropped a
        # third same-day A->B->A->B flip the exact same way the original
        # bug dropped a weeks-apart one). Minute-width keeps the real
        # protection this exists for while making that residual collision
        # need two genuinely separate occurrences within the same single
        # minute, rather than the same calendar day, to still happen.
        minute = datetime.datetime.now(sh.SAST).strftime("%Y-%m-%dT%H:%M")
        key_extra = f"{minute}:{json.dumps(new, sort_keys=True, default=str)}"
    return {
        "dedupe_key": f"{key}|{change_type}|{key_extra}"[:600],
        "release_key": key, "ocid": r.get("ocid"), "source": r.get("source") or "unknown",
        "contract_number": r.get("contract_number"), "buyer": r.get("buyer"), "title": r.get("title"),
        "change_type": change_type, "summary": summary, "old_value": old, "new_value": new,
        "evidence_url": evidence or r.get("source_url"), "source_timestamp": when,
    }


def _fmt(iso):
    dt = sh.parse_sast(iso)
    return dt.strftime("%d %b %Y %H:%M") if dt else "no date"


def diff_listing(r, prev):
    """Changes between a listing's previous snapshot and now. prev None =
    first sighting: only the source's own late-document timestamps count."""
    out = []
    now = snapshot_of(r)
    if prev is None:
        pub = sh.parse_sast(r.get("published_date") or r.get("opening_date"))
        for d in r.get("documents") or []:
            up = sh.parse_sast(d.get("date_modified"))
            looks = bool(ADDENDUM_NAME.search(d.get("title") or ""))
            if pub and up and looks and up - pub >= LATE_DOC_GRACE:
                out.append(_event(r, "document_added",
                                  f"Addendum-type document added {up.strftime('%d %b')}, after the tender was published "
                                  f"{pub.strftime('%d %b')}: \"{d.get('title')}\"",
                                  new={"title": d.get("title"), "url": d.get("url"), "looks_like_addendum": looks},
                                  when=up.isoformat(), evidence=d.get("url"), key_extra=d.get("title")))
        return out
    if prev.get("closing_date") != now["closing_date"] and now["closing_date"] and prev.get("closing_date") \
            and sh.parse_sast(prev["closing_date"]) != sh.parse_sast(now["closing_date"]):
        prev_dt, now_dt = sh.parse_sast(prev["closing_date"]), sh.parse_sast(now["closing_date"])
        # One side can fail to parse (a scraped date) while the other parses
        # fine - the `!=` check just above is true either way (None != a
        # real datetime), so this used to compare None > a real datetime and
        # crash. The string-level change is still real and worth reporting;
        # only the "extended/brought forward" direction needs a readable date.
        direction = "extended" if prev_dt and now_dt and now_dt > prev_dt else \
                    "BROUGHT FORWARD" if prev_dt and now_dt else "changed"
        out.append(_event(r, "closing_date_changed",
                          f"Closing date {direction}: {_fmt(prev['closing_date'])} -> {_fmt(now['closing_date'])}",
                          old=prev["closing_date"], new=now["closing_date"]))
    if prev.get("briefing_date") != now["briefing_date"] and (prev.get("briefing_date") or now["briefing_date"]):
        out.append(_event(r, "briefing_changed",
                          f"Briefing session moved: {_fmt(prev.get('briefing_date'))} -> {_fmt(now['briefing_date'])}",
                          old=prev.get("briefing_date"), new=now["briefing_date"]))
    if prev.get("title") and now["title"] and prev["title"] != now["title"]:
        out.append(_event(r, "title_changed", f"Title changed: \"{prev['title'][:80]}\" -> \"{now['title'][:80]}\"",
                          old=prev["title"], new=now["title"]))
    for name in sorted(set(now["documents"]) - set(prev.get("documents") or [])):
        doc = next((d for d in r.get("documents") or [] if d.get("title") == name), {})
        looks = bool(ADDENDUM_NAME.search(name))
        out.append(_event(r, "document_added", f"New document listed: \"{name}\"" + (" (looks like an addendum)" if looks else ""),
                          new={"title": name, "url": doc.get("url"), "looks_like_addendum": looks},
                          when=doc.get("date_modified"), evidence=doc.get("url"), key_extra=name))
    return out


def disagreements(r):
    out = []
    for d in r.get("source_disagreements") or []:
        from gov_sources import SOURCE_LABELS
        own, base = SOURCE_LABELS.get(d["source"], d["source"]), SOURCE_LABELS.get(d["base_source"], d["base_source"])
        if d["field"] == "status":
            summary = (f"{own} lists it as open, closing {_fmt(d['value'] if d['value'] != 'advertised' else r.get('closing_date'))}; "
                       f"{base} moved it to Closed (its date: {_fmt(d.get('base_closing_date'))}). "
                       "The buyer's own site is usually the one that's right.")
            new = {"own_site_closing": r.get("closing_date"), "portal_status": "closed",
                   "portal_closing": d.get("base_closing_date")}
        else:
            a, b = sh.parse_sast(d["value"]), sh.parse_sast(d["base_value"])
            if a and b and a.date() == b.date():
                continue  # same day, different hour: a typing difference, not a moved deadline
            summary = (f"Closing dates disagree: {own} says {_fmt(d['value'])}, {base} says {_fmt(d['base_value'])}. "
                       "Check the buyer's own notice.")
            new = {"own_site_closing": d["value"], "portal_closing": d["base_value"], "own_site": d["source"]}
        url = next((s["url"] for s in r.get("listing_sources") or [] if s["source"] == d["source"]), None)
        out.append(_event(r, "sources_disagree", summary, new=new, evidence=url))
    return out


def cancellations(cancelled_rels):
    out = []
    for r in cancelled_rels:
        c = r.get("cancellation") or {}
        out.append(_event(r, "cancelled",
                          f"CANCELLED by the buyer {_fmt(c.get('cancelled_at'))}" + (f": {c['reason']}" if c.get("reason") else ""),
                          new={"reason": c.get("reason")}, when=c.get("cancelled_at"),
                          evidence="https://www.etenders.gov.za/Home/opportunities?id=4", key_extra="cancelled"))
    return out


def _title_key(r):
    return (re.sub(r"[^a-z0-9]", "", (r.get("buyer") or "").lower()),
            re.sub(r"[^a-z0-9]", "", re.sub(READVERT, "", (r.get("title") or "")).lower())[:80])


def readvertisements(new_rels, cancelled_rels):
    by_title = {_title_key(c): c for c in cancelled_rels if c.get("title")}
    out = []
    for r in new_rels:
        prior = by_title.get(_title_key(r))
        if prior and prior.get("ocid") != r.get("ocid"):
            out.append(_event(r, "readvertised",
                              f"Re-advertised: the same buyer cancelled a tender with this title "
                              f"({prior.get('contract_number')}, {_fmt((prior.get('cancellation') or {}).get('cancelled_at'))}"
                              + (f": {(prior.get('cancellation') or {}).get('reason')}" if (prior.get('cancellation') or {}).get('reason') else "") + ")",
                              old={"ocid": prior.get("ocid"), "contract_number": prior.get("contract_number")},
                              new={"ocid": r.get("ocid")}, key_extra=prior.get("ocid")))
        elif READVERT.search(f"{r.get('contract_number') or ''} {r.get('title') or ''}"):
            out.append(_event(r, "readvertised", "The listing says this is a re-advertisement / re-issue",
                              new={"ocid": r.get("ocid")}, key_extra="flagged"))
    return out


def relistings(releases):
    """A buyer that lists the SAME bid number again as a new listing with a
    different closing date - instead of editing the original - is extending
    (or re-advertising) it. Seen live 2026-10-17: Eastern Cape Transport's
    scholar-transport bids SCMU10-26/27-0017 A..F were listed on the portal
    with a 26 Oct closing date and again as 0017A..F closing 6 Nov; both stay
    "Published". Reported on the OLDER listing, pointing to the newer one."""
    groups = {}
    for r in releases:
        ref = sh.norm_ref(r.get("contract_number"))
        if len(ref) < 6 or not r.get("closing_date") or r.get("is_closed") is None:
            continue
        groups.setdefault((re.sub(r"[^a-z0-9]", "", (r.get("buyer") or "").lower()), ref), []).append(r)
    out = []
    for rels in groups.values():
        if len({x.get("ocid") for x in rels}) < 2:
            continue
        rels = sorted(rels, key=lambda x: (x.get("published_date") or "", x.get("ocid") or ""))
        newest = rels[-1]
        for old in rels[:-1]:
            a, b = sh.parse_sast(old["closing_date"]), sh.parse_sast(newest["closing_date"])
            if not a or not b or a.date() == b.date():
                continue
            if (sh.parse_sast(old.get("published_date")) or a).date() == (sh.parse_sast(newest.get("published_date")) or b).date():
                # Published the same day: no way to tell which one is current.
                out.append(_event(old, "sources_disagree",
                                  f"The buyer lists this bid number twice with different closing dates: "
                                  f"{_fmt(old['closing_date'])} here, {_fmt(newest['closing_date'])} on "
                                  f"{newest.get('contract_number')}. Check which is current.",
                                  new={"other_ocid": newest.get("ocid"), "other_closing": newest["closing_date"]},
                                  key_extra=f"twin:{newest.get('ocid')}"))
                continue
            out.append(_event(old, "readvertised",
                              f"Listed again by the buyer ({newest.get('contract_number')}, published "
                              f"{_fmt(newest.get('published_date'))}) closing {_fmt(newest['closing_date'])}; "
                              f"this listing says {_fmt(old['closing_date'])}. Use the newer listing's date and documents.",
                              old={"closing_date": old["closing_date"]},
                              new={"ocid": newest.get("ocid"), "closing_date": newest["closing_date"]},
                              key_extra=f"relisted:{newest.get('ocid')}"))
    return out


def portal_bidders(closed_rels):
    """The portal's Closed tab carries the bidders (and sometimes amounts)
    for some tenders - a bidders list on the tender, as L2B sells it."""
    out = []
    for r in closed_rels or []:
        b = r.get("bidders") or []
        if not b:
            continue
        priced = sum(1 for x in b if x.get("amount"))
        names = ", ".join(x["name"] for x in b[:6]) + (f" and {len(b) - 6} more" if len(b) > 6 else "")
        out.append(_event(r, "bidders_list_published",
                          f"{len(b)} bidder(s) listed on eTenders" + (f", {priced} with a price" if priced else "") + f": {names}",
                          new={"bidders": b}, evidence="https://www.etenders.gov.za/Home/opportunities?id=3",
                          key_extra=f"bidders:{len(b)}"))
    return out


def eskom_notices(notices, releases):
    """Eskom notices -> events on the tender each one refers to (by
    reference), or on the notice itself when that tender isn't in the feed."""
    idx = {}
    for r in releases:
        idx.setdefault(sh.norm_ref(r.get("contract_number")), r)
    out = []
    cutoff = datetime.datetime.now(sh.SAST) - NOTICE_LOOKBACK
    for n in notices:
        ctype = ESKOM_NOTICE_TYPES.get(n.get("notice_kind"))
        published = sh.parse_sast(n.get("published_date"))
        if not ctype or (published and published < cutoff):
            continue
        target = idx.get(sh.norm_ref(n.get("refers_to_reference"))) or n
        base = dict(target)
        label = n["notice_kind"].replace("_", " ")
        out.append(_event(base, ctype,
                          f"Eskom notice ({label}) published {_fmt(n.get('published_date'))}: {(n.get('title') or '')[:140]}",
                          new={"notice_reference": n.get("contract_number"), "notice_kind": n["notice_kind"],
                               "notice_url": n.get("source_url")},
                          when=n.get("published_date"), evidence=n.get("source_url"),
                          key_extra=f"eskom:{n.get('source_id')}"))
    return out


def detect(releases, snapshots, cancelled=(), notices=(), first_run_late_docs=True, portal_closed=()):
    """All changes this run. snapshots: {release_key: snapshot}. Returns
    (events, new_snapshots) - new_snapshots replaces/extends the store."""
    events, new_snaps, fresh = [], {}, []
    for r in releases:
        key = r.get("ocid") or f"{r.get('source')}:{r.get('contract_number')}"
        try:
            prev = snapshots.get(key)
            if prev is None:
                fresh.append(r)
                if first_run_late_docs:
                    events += diff_listing(r, None)
            else:
                events += diff_listing(r, prev)
            events += disagreements(r)
            new_snaps[key] = dict(snapshot_of(r), source=r.get("source"), contract_number=r.get("contract_number"),
                                  buyer=r.get("buyer"))
        except Exception as e:
            # One listing's own bad data (a scraped date, an unexpected
            # shape - snapshot_of() itself can raise on this, not just the
            # diff/disagreement checks, confirmed by testing a release whose
            # documents field wasn't a list) must not cancel change
            # detection for every OTHER tender in the run - same isolation
            # as watch_tender_updates.py's per-pursued-tender guard.
            # new_snaps[key] is deliberately left unset: next run this
            # listing looks "fresh" again rather than diffed against a
            # snapshot built from data that couldn't be read - degraded,
            # not wrong.
            system_alerts.record("tender_changes",
                                 f"Change detection failed for one listing ({key}): {type(e).__name__}: {e}",
                                 "warning", exc=e, context={"release_key": key, "source": r.get("source")})
    events += cancellations(cancelled)
    events += readvertisements(fresh, cancelled)
    events += relistings(releases)
    events += eskom_notices(notices, releases)
    events += portal_bidders(portal_closed)
    seen, unique = set(), []
    for e in events:
        if e["dedupe_key"] not in seen:
            seen.add(e["dedupe_key"])
            unique.append(e)
    return unique, new_snaps


# ---------------------------------------------------------------- stores ---

class LocalStore:
    def __init__(self, snap_path=LOCAL_SNAPSHOTS, change_path=LOCAL_CHANGES):
        self.snap_path, self.change_path = snap_path, change_path

    def _load(self, p, default):
        try:
            return json.load(open(p))
        except (OSError, json.JSONDecodeError):
            return default

    def load_snapshots(self, keys):
        allsnaps = self._load(self.snap_path, {})
        return {k: allsnaps[k] for k in keys if k in allsnaps}

    def save(self, snaps, events):
        os.makedirs(os.path.dirname(self.snap_path), exist_ok=True)
        allsnaps = self._load(self.snap_path, {})
        now = datetime.datetime.now(sh.SAST).isoformat()
        for k, v in snaps.items():
            allsnaps[k] = dict(v, last_seen=now, first_seen=(allsnaps.get(k) or {}).get("first_seen", now))
        json.dump(allsnaps, open(self.snap_path, "w"), indent=1)
        changes = self._load(self.change_path, [])
        known = {c["dedupe_key"] for c in changes}
        new = [dict(e, detected_at=now) for e in events if e["dedupe_key"] not in known]
        json.dump(changes + new, open(self.change_path, "w"), indent=1)
        return new


    def recent_changes(self, ocids, since):
        """Changes recorded at/after `since` (aware datetime) on these ocids."""
        ocids = set(ocids)
        return [c for c in self._load(self.change_path, [])
                if c.get("ocid") in ocids and (sh.parse_utc(c.get("detected_at")) or since) >= since]


class SupabaseStore:
    CHUNK = 100

    def recent_changes(self, ocids, since):
        out, ocids = [], sorted(o for o in set(ocids) if o)
        for i in range(0, len(ocids), self.CHUNK):
            for row in self.client.select(CHANGE_TABLE, {"ocid": ocids[i:i + self.CHUNK]}):
                when = sh.parse_utc(row.get("detected_at"))
                if when is None or when >= since:
                    out.append(row)
        return out

    def __init__(self, client):
        self.client = client

    def load_snapshots(self, keys):
        out = {}
        keys = sorted(keys)
        for i in range(0, len(keys), self.CHUNK):
            for row in self.client.select(SNAP_TABLE, {"release_key": keys[i:i + self.CHUNK]}):
                out[row["release_key"]] = row["snapshot"]
        return out

    def save(self, snaps, events):
        now = datetime.datetime.now(sh.SAST).isoformat()
        rows = [{"release_key": k, "source": v.get("source") or "unknown", "contract_number": v.get("contract_number"),
                 "buyer": v.get("buyer"), "snapshot": v, "last_seen": now} for k, v in snaps.items()]
        for i in range(0, len(rows), self.CHUNK):
            self.client.upsert(SNAP_TABLE, rows[i:i + self.CHUNK], "release_key")
        keys = [e["dedupe_key"] for e in events]
        known = set()
        for i in range(0, len(keys), self.CHUNK):
            known |= {r["dedupe_key"] for r in self.client.select(CHANGE_TABLE, {"dedupe_key": keys[i:i + self.CHUNK]})}
        new = [e for e in events if e["dedupe_key"] not in known]
        for i in range(0, len(new), self.CHUNK):
            self.client.upsert(CHANGE_TABLE, new[i:i + self.CHUNK], "dedupe_key")
        return new


def make_store(local=False):
    if not local:
        import company_profiles
        client = company_profiles.RestClient.from_env()
        if client is not None:
            return SupabaseStore(client), "Supabase"
    return LocalStore(), "local JSON (state/)"


def run(res, store, lookback_days=14, log=print):
    """res: gov_sources.fetch_all() output (+ optional 'cancelled')."""
    cancelled = res.get("cancelled")
    if cancelled is None:
        import etenders_portal
        since = datetime.datetime.now(sh.SAST) - datetime.timedelta(days=lookback_days)
        try:
            cancelled = etenders_portal.fetch_releases("cancelled", since=since, log=log)
        except Exception as e:
            log(f"  WARNING: portal Cancelled tab failed: {e}")
            cancelled = []
    releases = res["releases"]
    keys = [r.get("ocid") or f"{r.get('source')}:{r.get('contract_number')}" for r in releases]
    snaps = store.load_snapshots(keys)
    events, new_snaps = detect(releases, snaps, cancelled, res.get("notices") or [],
                               portal_closed=res.get("portal_closed") or [])
    new = store.save(new_snaps, events)
    return new, events, len(snaps)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", default=None, help="comma list (default: every gov_sources source)")
    ap.add_argument("--from-file", default=None, help="a gov_sources.py --out file instead of reading the sources live")
    ap.add_argument("--lookback-days", type=int, default=14, help="cancellations from the last N days")
    ap.add_argument("--local", action="store_true", help="use state/*.json even if Supabase is configured")
    ap.add_argument("--snapshots", default=None, help="local snapshot file (with --local)")
    ap.add_argument("--changes", default=None, help="local change log file (with --local)")
    ap.add_argument("--out", default=None, help="write the NEW changes of this run to this JSON file")
    args = ap.parse_args()
    import gov_sources
    if args.from_file:
        res = json.load(open(args.from_file))
    else:
        srcs = [s for s in (args.sources or ",".join(gov_sources.ALL_SOURCES)).split(",") if s]
        res = gov_sources.fetch_all(srcs)
    store, where = make_store(args.local)
    if isinstance(store, LocalStore):
        store = LocalStore(args.snapshots or LOCAL_SNAPSHOTS, args.changes or LOCAL_CHANGES)
    new, events, had = run(res, store, args.lookback_days)
    from collections import Counter
    print(f"\n{len(res['releases'])} listings checked ({had} had a snapshot from an earlier run); store: {where}")
    print(f"{len(events)} change(s) this run, {len(new)} not recorded before: {dict(Counter(e['change_type'] for e in new))}")
    for e in new[:40]:
        print(f"  [{e['change_type']}] {e['contract_number'] or '-'}  {e['buyer']}  -  {e['summary'][:150]}")
    if args.out:
        json.dump(new, open(args.out, "w"), indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
