"""
A re-assessment that DOWNGRADES a company's Discovery verdict is flagged, never
silently applied (Sarel, 2026-10-17: "When evaluation downgrades opportunity
it must be flagged").

Before this, when watch_new_tenders.fan_out() re-scored a tender for a company
whose profile changed (Hardcoded-Assumptions-Audit §11.1) and the new verdict
was worse, either nothing happened (a not_a_fit result is not report-worthy, so
the seeder never saw it and the old "Strong fit" row stayed on /discovery) or
the row's verdict was overwritten in place (strong_fit -> possible) with no
trace that it had ever been better.

Now (migration 0055, columns on discovered_opportunities):
  downgraded_from          the best verdict the company was shown before
  downgraded_at            when the re-assessment made it worse
  downgrade_cause          'profile_changed' / 'retry_after_error' (the watch's
                           own `rescored` value), null when unknown
  reasons_before           the reasons it matched before (the row's `reasons`
                           are replaced by the new ones)
  downgrade_acknowledged_* a member pressed "Mark as seen" (acknowledge_
                           discovery_downgrade(), 0055): the loud banner becomes
                           a small "was Strong fit" marker that stays
  downgrade_digested_at    the daily digest carried it (once, same idea as
                           tender_update_notifications.digested_at, 0039)

Verdict order (fit only): strong_fit > possible > needs_review > not_a_fit -
the same order assess_tender.assess_fit() decides them in and Discovery's
filters group them in. `closed` (the tender's closing date passed) and `ERROR`
(scoring failed, retried next run) are not fit verdicts: moving to either is
never a downgrade, and neither is written over a row's fit verdict here.

This module is the one place that order and the flag fields are computed;
seed_supabase_opportunities.py writes them, watch_new_tenders.py prints them,
daily_digest.py reports them.
"""
import datetime

FIT_RANK = {"strong_fit": 3, "possible": 2, "needs_review": 1, "not_a_fit": 0}
FIT_VERDICTS = set(FIT_RANK)
VERDICT_LABEL = {"strong_fit": "Strong fit", "possible": "Possible", "needs_review": "Needs review",
                 "not_a_fit": "Not a fit", "closed": "Closed", "ERROR": "Scoring failed"}

TABLE = "discovered_opportunities"
FLAG_COLUMNS = ("downgraded_from", "downgraded_at", "downgrade_cause", "reasons_before",
                "downgrade_acknowledged_at", "downgrade_acknowledged_by", "downgrade_digested_at")
# briefing_shortlisted (0105) is the same "awaiting outcome, still real work
# already gone into it" bucket 'submitted' is in - pending_digest_downgrades()
# below prioritizes ACTIVE_STAGES tenders specifically because real work may
# already have gone into them. Found 2026-10-31: missing here, same gap as
# watch_tender_updates.py's identical tuple (PR #173's own 0105 migration
# widened this for assessing/building but missed this stage).
ACTIVE_STAGES = ("found", "assessing", "building", "bidding", "submitted", "briefing_shortlisted")  # tender_packs.pipeline_stage = actively pursuing (0021/0039/0105)


def is_downgrade(old, new):
    """True when `new` is a strictly worse FIT verdict than `old`."""
    return old in FIT_RANK and new in FIT_RANK and FIT_RANK[new] < FIT_RANK[old]


def flag_update(existing, new_verdict, cause=None, now=None):
    """The downgrade columns to write when a row currently `existing` (a
    discovered_opportunities row dict, or None) gets `new_verdict`:
      - None: nothing to change (no row, or no flag and not a downgrade).
      - a dict of every FLAG_COLUMNS key: set (a downgrade), or cleared (the
        verdict recovered to at least what it was before).
    An open (unacknowledged) flag keeps its original "was" verdict: strong_fit
    -> possible -> not_a_fit is still "was Strong fit". An acknowledged flag
    followed by a further downgrade is a new flag from the current verdict."""
    if not existing or new_verdict not in FIT_RANK:
        return None
    current = existing.get("verdict")
    was = existing.get("downgraded_from")
    open_flag = bool(was) and not existing.get("downgrade_acknowledged_at")
    if is_downgrade(current, new_verdict):
        best = was if open_flag and FIT_RANK.get(was, -1) > FIT_RANK.get(current, -1) else current
        now = now or datetime.datetime.now(datetime.timezone.utc).isoformat()
        return {"downgraded_from": best, "downgraded_at": now, "downgrade_cause": cause,
                "reasons_before": (existing.get("reasons_before") if best == was and open_flag else None)
                or existing.get("reasons") or [],
                "downgrade_acknowledged_at": None, "downgrade_acknowledged_by": None, "downgrade_digested_at": None}
    if was and FIT_RANK.get(new_verdict, -1) >= FIT_RANK.get(was, 99):
        return {k: None for k in FLAG_COLUMNS}  # back to (at least) where it was: no longer a downgrade
    return None


# ---------------------------------------------------------------------------
# Daily digest (engine/notify/daily_digest.py): each open downgrade once.
# ---------------------------------------------------------------------------

def _pursuit(client, rows):
    """{opportunity id: pipeline_stage} for rows whose company has an active
    tender_packs row on that tender (by the row's tender_id, else the shared
    tender with the same OCDS id)."""
    ocids = sorted({r["ocid"] for r in rows if r.get("ocid") and not r.get("tender_id")})
    tender_by_ocid = {}
    for i in range(0, len(ocids), 100):
        for t in client.select("tenders", {"ocid": ocids[i:i + 100]}):
            if not t.get("owner_company_id"):  # the shared Discovery tender, not someone's private copy
                tender_by_ocid[t["ocid"]] = t["id"]
    tender_ids = sorted({r.get("tender_id") or tender_by_ocid.get(r.get("ocid")) for r in rows} - {None})
    packs = {}
    for i in range(0, len(tender_ids), 100):
        for p in client.select("tender_packs", {"tender_id": tender_ids[i:i + 100]}):
            packs[(p["company_id"], p["tender_id"])] = p.get("pipeline_stage")
    out = {}
    for r in rows:
        tid = r.get("tender_id") or tender_by_ocid.get(r.get("ocid"))
        stage = packs.get((r["company_id"], tid)) if tid else None
        out[r["id"]] = (tid, stage if stage in ACTIVE_STAGES else None, stage)
    return out


def pending_digest_downgrades(client):
    """Open downgrades not yet carried by a digest (and not already marked as
    seen in the app), one item per company x tender, the ones the company is
    actively pursuing first: real work may already have gone into those."""
    rows = [r for r in client.select(TABLE, order="downgraded_at.asc")
            if r.get("downgraded_from") and not r.get("downgrade_digested_at")
            and not r.get("downgrade_acknowledged_at")]
    if not rows:
        return []
    pursuit = _pursuit(client, rows)
    items = []
    for r in rows:
        tid, active_stage, stage = pursuit[r["id"]]
        was, now = r["downgraded_from"], r["verdict"]
        pursuing = active_stage is not None
        items.append({
            "opportunity_id": r["id"], "company_id": r["company_id"], "tender_id": tid,
            "ocid": r.get("ocid"), "contract_number": r.get("contract_number"), "title": r.get("title"),
            "buyer": r.get("buyer"), "closing_date": r.get("closing_date"),
            "was_verdict": was, "now_verdict": now, "downgraded_at": r.get("downgraded_at"),
            "cause": r.get("downgrade_cause"), "reasons_now": r.get("reasons") or [],
            "reasons_before": r.get("reasons_before") or [],
            "pursuing": pursuing, "pipeline_stage": stage,
            "urgency": "high" if pursuing else "info",
            "summary": (f"No longer a good fit: was {VERDICT_LABEL.get(was, was)}, now {VERDICT_LABEL.get(now, now)}"
                        + (" - your company profile changed since it was first scored" if r.get("downgrade_cause") == "profile_changed" else "")
                        + (f". You are working on this tender ({stage}) - check whether to continue." if pursuing else ".")),
        })
    items.sort(key=lambda i: (not i["pursuing"], i["downgraded_at"] or ""))
    return items


def mark_digested(client, items):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for i in items:
        client.update(TABLE, {"id": i["opportunity_id"]}, {"downgrade_digested_at": now})
    return len(items)
