"""
A re-assessment that DOWNGRADES a company's Discovery verdict is flagged
(Sarel, 2026-10-17: "When evaluation downgrades opportunity it must be
flagged"; discovery_downgrades.py, migration 0055).

Part 1 (always): the verdict order and flag rules (discovery_downgrades.
flag_update), and watch_new_tenders.fan_out() on a real tender: a company that
loses its security tags is re-scored on TN051 (strong_fit -> not_a_fit) and
listed in `company_reassessed` - before this it simply vanished from the
output and its Discovery row kept saying "Strong fit".

Part 2 (DOWNGRADE_PSQL set - a scratch Postgres with every migration
replayed): real rows end to end.
  - Two security companies both get TN051 as strong_fit; one ("Pursuer")
    presses "Prepare this tender" (pursue_discovered_opportunity) and moves it
    to bidding; a third company never matched it.
  - Both security companies' profiles change (security work untagged): the
    watch re-scores only them, the seeder flags BOTH existing rows (was
    strong_fit, now not_a_fit, the reasons it matched before kept), and the
    company that never matched still has no row.
  - A within-report-worthy downgrade (strong_fit -> possible) through the
    seeder's upsert path: flagged, not silently overwritten; a further drop
    keeps the original "was strong_fit".
  - The digest: pending_digest_downgrades() lists the pursued one first
    (urgency high, pipeline_stage bidding); build_digest_for_person gives the
    pursued downgrade to every role (a validator too) but the plain-feed one
    only to full_cycle / viewer (count); carried once (mark_digested).
  - acknowledge_discovery_downgrade() under RLS: the company's own member can
    mark it seen (who + when recorded), another company's member can't, a
    never-downgraded row is refused, nobody can update the row directly,
    anon can't call it; a seen downgrade is not put in a digest.
  - Recovery: the profile change undone -> strong_fit again -> flag cleared.

    python3 engine/discovery/test_discovery_downgrades.py
    DOWNGRADE_PSQL="psql -h /tmp/sock -p 54521 -U postgres -d downtest" python3 engine/discovery/test_discovery_downgrades.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "engine", "intake"))
sys.path.insert(0, os.path.join(ROOT, "engine", "pack"))
sys.path.insert(0, os.path.join(ROOT, "engine", "notify"))
import discovery_downgrades as dd  # noqa: E402
import watch_new_tenders as watch  # noqa: E402
import seed_supabase_opportunities as seeder  # noqa: E402
import system_alerts  # noqa: E402

system_alerts.set_sink(lambda payload: "test-alert")
FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


SAMPLES = json.load(open(os.path.join(ROOT, "templates", "general_samples", "sources.json")))["samples"]


def release(key, pdf):
    s = SAMPLES[key]
    return {"ocid": s["ocid"], "contract_number": s["reference"], "buyer": s["buyer"], "title": s["description"],
            "description": s["description"], "closing_date": "2099-01-01T11:00:00Z", "is_closed": False,
            "documents": [{"url": "file://" + os.path.join(ROOT, "templates", "general_samples", key, pdf),
                           "title": pdf}]}


TN051 = release("dawid_kruiper_tn051", "TN051.pdf")
SCMU5 = release("ecdpwi_scmu5_0007", "SCMU5-26-27-0007SB.pdf")


def part1():
    print("Part 1 - verdict order, flag rules, fan-out on a real tender")
    check(dd.is_downgrade("strong_fit", "not_a_fit") and dd.is_downgrade("strong_fit", "possible")
          and dd.is_downgrade("possible", "needs_review") and dd.is_downgrade("needs_review", "not_a_fit"),
          "downgrade = a worse fit verdict (strong_fit > possible > needs_review > not_a_fit)")
    check(not dd.is_downgrade("not_a_fit", "strong_fit") and not dd.is_downgrade("possible", "possible")
          and not dd.is_downgrade("strong_fit", "closed") and not dd.is_downgrade("strong_fit", "ERROR")
          and not dd.is_downgrade("ERROR", "not_a_fit"),
          "never a downgrade: an upgrade, the same verdict, closed, ERROR")
    row = {"verdict": "strong_fit", "reasons": ["Matches security work"]}
    f = dd.flag_update(row, "not_a_fit", "profile_changed", now="2026-10-18T08:00:00+00:00")
    check(f and f["downgraded_from"] == "strong_fit" and f["reasons_before"] == ["Matches security work"]
          and f["downgrade_cause"] == "profile_changed" and f["downgrade_acknowledged_at"] is None,
          "flag: strong_fit -> not_a_fit keeps was + reasons before + cause")
    check(dd.flag_update(None, "not_a_fit") is None and dd.flag_update(row, "strong_fit") is None
          and dd.flag_update({"verdict": "possible"}, "strong_fit") is None,
          "no flag: no row (never shown), same verdict, upgrade with no earlier flag")
    flagged = {"verdict": "possible", "reasons": ["weaker"], "downgraded_from": "strong_fit",
               "reasons_before": ["Matches security work"], "downgrade_acknowledged_at": None}
    f2 = dd.flag_update(flagged, "not_a_fit")
    check(f2["downgraded_from"] == "strong_fit" and f2["reasons_before"] == ["Matches security work"],
          "an open flag keeps the original 'was strong_fit' through a further drop")
    seen_flag = {**flagged, "downgrade_acknowledged_at": "2026-10-18T09:00:00+00:00"}
    f3 = dd.flag_update(seen_flag, "not_a_fit")
    check(f3["downgraded_from"] == "possible" and f3["downgrade_acknowledged_at"] is None,
          "after it was marked seen, a further drop is a new flag from the current verdict")
    check(dd.flag_update(flagged, "needs_review") is not None and dd.flag_update(flagged, "strong_fit") ==
          {k: None for k in dd.FLAG_COLUMNS}, "recovered to at least 'was': flag cleared")
    check(dd.flag_update({**flagged, "verdict": "not_a_fit"}, "possible") is None,
          "partial recovery (still below 'was'): flag kept")

    guard = {"company_id": None, "legal_name": "Synthetic Guarding CC", "key": "g",
             "profile": {"disciplines": ["security_facilities"], "bee_level": 1, "black_ownership_pct": 100,
                         "has_cidb_grading": False, "offices": [{"province": "Northern Cape", "district_municipality": None,
                                                                "local_municipality": None, "town": None,
                                                                "office_kind": "head_office"}]}}
    seen = {}
    out = watch.fan_out([TN051], [guard], seen, watch.REPORT_WORTHY_VERDICTS)
    check(out and out[0]["company_results"][0]["verdict"] == "strong_fit", "TN051: the guarding company is a strong fit")
    guard["profile"] = {**guard["profile"], "disciplines": ["roads_civil"]}
    out = watch.fan_out([TN051], [guard], seen, watch.REPORT_WORTHY_VERDICTS)
    re = out[0]["company_reassessed"] if out else []
    check(out and out[0]["company_results"] == [] and len(re) == 1 and re[0]["verdict"] == "not_a_fit"
          and re[0]["previous_verdict"] == "strong_fit" and re[0]["rescored"] == "profile_changed",
          "profile change: strong_fit -> not_a_fit is in company_reassessed (before: dropped silently)")
    check(watch.fan_out([TN051], [guard], seen, watch.REPORT_WORTHY_VERDICTS) == [], "next run: nothing")


def part2(psql):
    from test_manual_intake import Client
    import daily_digest
    print("Part 2 - real rows on a scratch Postgres (every migration replayed)")
    c = Client(psql, "/nonexistent")
    c.sql("delete from discovered_opportunities; delete from discovery_seen_releases; delete from tender_packs; "
          "delete from experience_items; delete from company_offices; delete from company_members; "
          "delete from companies where legal_name like 'Downgrade %'")
    c.sql("delete from tenders where ocid in ('" + TN051["ocid"] + "', '" + SCMU5["ocid"] + "')")

    def company(name, tags, province):
        row = c.insert("companies", {"legal_name": name, "bee_level": 1})
        c.insert("experience_items", {"company_id": row["id"], "project_name": f"{name} reference", "disciplines": tags,
                                      "document_type": "completion_certificate", "tagged_at": "2026-10-01T00:00:00+00:00"})
        c.insert("company_offices", {"company_id": row["id"], "province": province, "office_kind": "head_office"})
        return row["id"]

    ids = {"pursuer": company("Downgrade Pursuer Guards", ["security_facilities"], "Northern Cape"),
           "feed": company("Downgrade Feed-only Guards", ["security_facilities"], "Northern Cape"),
           "never": company("Downgrade Never-a-fit Architects", ["buildings", "professional_services"], "Eastern Cape")}
    users = {}
    for k in ("pursuer_owner", "pursuer_validator", "feed_owner", "feed_validator", "never_owner"):
        users[k] = c.sql(f"insert into auth.users (email) values ('{k}@downgrade.example') returning id").splitlines()[0]
    for k, (comp, role, trole) in {"pursuer_owner": ("pursuer", "owner", "full_cycle"),
                                   "pursuer_validator": ("pursuer", "member", "validator"),
                                   "feed_owner": ("feed", "owner", "full_cycle"),
                                   "feed_validator": ("feed", "member", "validator"),
                                   "never_owner": ("never", "owner", "full_cycle")}.items():
        c.insert("company_members", {"company_id": ids[comp], "user_id": users[k], "role": role, "tender_role": trole})

    def companies():
        import company_profiles
        return [r for r in company_profiles.all_company_profiles(c) if r["legal_name"].startswith("Downgrade ")]

    def run_and_seed():
        out = watch.run([TN051, SCMU5], companies(), watch.REPORT_WORTHY_VERDICTS, client=c, log=lambda m: None)
        logs = []
        seeder.seed(c, out, log=logs.append)
        return out, logs

    def opp(comp, rel=TN051):
        rows = c.select("discovered_opportunities", {"company_id": ids[comp], "ocid": rel["ocid"]})
        return rows[0] if rows else None

    run_and_seed()
    check(opp("pursuer")["verdict"] == "strong_fit" and opp("feed")["verdict"] == "strong_fit" and opp("never") is None,
          "first run: TN051 strong_fit for both guarding companies; the architects never shown it (no row)")
    check(opp("pursuer")["downgraded_from"] is None, "a fresh row carries no downgrade flag")
    # The pursuer prepares the tender and starts bidding (real RPC + RLS).
    ok, tender_id = c.as_user(users["pursuer_owner"], f"select pursue_discovered_opportunity('{opp('pursuer')['id']}')")
    check(ok, f"pursuer pressed 'Prepare this tender' ({tender_id if not ok else 'tender ' + tender_id[:8]})")
    ok, n = c.as_user(users["pursuer_owner"], f"with u as (update tender_packs set pipeline_stage = 'bidding' "
                                              f"where tender_id = '{tender_id}' returning 1) select count(*) from u")
    check(ok and n == "1", "pursuer moved it to Bidding")

    # Profile change: both guarding companies untag their security work and tag roads instead.
    for k in ("pursuer", "feed"):
        c.sql(f"update experience_items set disciplines = '{{roads_civil}}' where company_id = '{ids[k]}'")
    out, logs = run_and_seed()
    print("    seeder:", *logs, sep="\n      ")
    re = [(r["contract_number"], x["legal_name"], x["previous_verdict"], x["verdict"])
          for r in out for x in r.get("company_reassessed") or []]
    print("    re-assessed:", re)
    check({n for _, n, _, _ in re} == {"Downgrade Pursuer Guards", "Downgrade Feed-only Guards"} and
          {(cn, n) for cn, n, was, now in re if dd.is_downgrade(was, now)} ==
          {(TN051["contract_number"], "Downgrade Pursuer Guards"), (TN051["contract_number"], "Downgrade Feed-only Guards")},
          "profile change: only the two changed companies re-scored; TN051 strong_fit -> not_a_fit for both "
          "(SCMU5 stays not_a_fit - not a downgrade)")
    p, f = opp("pursuer"), opp("feed")
    for name, row in (("pursuer", p), ("feed-only", f)):
        print(f"    {name}: verdict={row['verdict']} was={row['downgraded_from']} at={row['downgraded_at']} "
              f"cause={row['downgrade_cause']} reasons_before={row['reasons_before']}")
    check(all(r["verdict"] == "not_a_fit" and r["downgraded_from"] == "strong_fit" and r["downgraded_at"]
              and r["downgrade_cause"] == "profile_changed" and r["reasons_before"] and r["reasons_before"] != r["reasons"]
              for r in (p, f)),
          "both rows flagged: was strong_fit, now not_a_fit, when, why, and the reasons it matched before")
    check(p["tender_id"] == tender_id, "the pursuer's row still points at its workspace tender")
    check(opp("never") is None, "the never-a-fit company still has no row (nothing to flag, nothing invented)")

    # A downgrade inside the report-worthy set goes through the seeder's upsert
    # path: strong_fit -> possible on SCMU5 for the architects.
    arch = opp("never", SCMU5)
    check(arch and arch["verdict"] == "strong_fit", "SCMU5: architects strong_fit")
    fake = [{**{k: SCMU5.get(k) for k in ("contract_number", "buyer", "title", "description", "closing_date")},
             "ocid": SCMU5["ocid"], "categories": arch["categories"], "documents": SCMU5["documents"],
             "company_results": [{"company_id": ids["never"], "legal_name": "Downgrade Never-a-fit Architects",
                                  "verdict": "possible", "reasons": ["(test) weaker match"], "score_outlook": None,
                                  "rescored": "profile_changed", "previous_verdict": "strong_fit"}],
             "company_reassessed": []}]
    seeder.seed(c, fake, log=lambda m: None)
    a2 = opp("never", SCMU5)
    check(a2["verdict"] == "possible" and a2["downgraded_from"] == "strong_fit",
          "report-worthy downgrade (strong_fit -> possible) flagged, not silently overwritten")
    fake[0]["company_results"] = []
    fake[0]["company_reassessed"] = [{"company_id": ids["never"], "legal_name": "Downgrade Never-a-fit Architects",
                                      "verdict": "not_a_fit", "reasons": ["(test) no match"], "score_outlook": None,
                                      "rescored": "profile_changed", "previous_verdict": "possible"}]
    seeder.seed(c, fake, log=lambda m: None)
    a3 = opp("never", SCMU5)
    check(a3["verdict"] == "not_a_fit" and a3["downgraded_from"] == "strong_fit" and a3["reasons_before"] == arch["reasons"],
          "a further drop to not_a_fit keeps 'was strong_fit' and the strong_fit reasons")

    # Digest.
    items = dd.pending_digest_downgrades(c)
    mine = [i for i in items if i["company_id"] in ids.values()]
    print("    digest items:", [(i["contract_number"], i["was_verdict"], i["now_verdict"], i["pursuing"],
                                 i["pipeline_stage"], i["urgency"]) for i in mine])
    check(len(mine) == 3 and mine[0]["company_id"] == ids["pursuer"] and mine[0]["pursuing"]
          and mine[0]["pipeline_stage"] == "bidding" and mine[0]["urgency"] == "high",
          "digest: the pursued (bidding) downgrade first, urgency high")
    feed_item = next(i for i in mine if i["company_id"] == ids["feed"])
    check(not feed_item["pursuing"] and feed_item["urgency"] == "info", "digest: the plain-feed downgrade is info")
    roster = [{"person_id": users[k], "name": f"{k}@downgrade.example", "email": f"{k}@downgrade.example",
               "company_id": ids[k.split("_")[0]], "company_name": k, "tender_role": tr}
              for k, tr in (("pursuer_owner", "full_cycle"), ("pursuer_validator", "validator"),
                            ("feed_owner", "full_cycle"), ("feed_validator", "validator"))]
    roster.append({**roster[2], "person_id": "v", "tender_role": "viewer"})
    digests = {}
    delivered = set()
    for person in roster:
        sig = daily_digest.company_signals(person["company_id"], {}, [], [], [], 14, company_id=person["company_id"],
                                           tender_updates=[], reassessed_tenders=items)
        d = daily_digest.build_digest_for_person(person, sig)
        delivered.update(d.pop("_delivered_downgrades", []))
        digests[(person["name"], person["tender_role"])] = d.get("reassessed_tenders")
    for k, v in digests.items():
        print(f"    digest {k[0]} ({k[1]}): {v if not isinstance(v, list) else [(i['contract_number'], i['summary']) for i in v]}")
    po = digests[("pursuer_owner@downgrade.example", "full_cycle")]
    pv = digests[("pursuer_validator@downgrade.example", "validator")]
    fo = digests[("feed_owner@downgrade.example", "full_cycle")]
    fv = digests[("feed_validator@downgrade.example", "validator")]
    vw = digests[("feed_owner@downgrade.example", "viewer")]
    check(po and len(po) == 1 and po[0]["pursuing"] and "You are working on this tender (bidding)" in po[0]["summary"],
          "pursuer full_cycle: the downgrade, saying it is being worked on")
    check(pv and len(pv) == 1, "pursuer validator: gets it too (pursued - like a tender update)")
    check(fo and len(fo) == 1 and not fo[0]["pursuing"], "feed-only full_cycle: gets the plain-feed downgrade")
    check(fv is None, "feed-only validator: no section (a plain-feed downgrade goes where new tenders go)")
    check(vw == {"count": 1, "pursuing_count": 0}, "viewer: the count")
    check(not any(i["company_id"] == ids["pursuer"] for i in fo) and not any(i["company_id"] == ids["feed"] for i in po),
          "each company sees only its own downgrades")
    dd.mark_digested(c, [i for i in mine if i["opportunity_id"] in delivered])
    left = [i for i in dd.pending_digest_downgrades(c) if i["company_id"] in ids.values()]
    check([i["company_id"] for i in left] == [ids["never"]],
          "carried once: delivered ones not pending again (the architects' had no roster member here - still pending)")

    # Mark as seen under RLS.
    c.sql("grant execute on all functions in schema public to authenticated")
    ok, err = c.as_user(users["feed_owner"], f"select acknowledge_discovery_downgrade('{p['id']}')")
    check(not ok and "not found" in err, "another company's member can't mark the pursuer's downgrade seen")
    ok, err = c.as_user(users["pursuer_owner"], f"with u as (update discovered_opportunities set downgrade_acknowledged_at = now() "
                                               f"where id = '{p['id']}' returning 1) select count(*) from u")
    check(ok and err == "0" and opp("pursuer")["downgrade_acknowledged_at"] is None,
          "a member can't update the row directly (no client update policy)")
    plain_row = c.insert("discovered_opportunities", {"company_id": ids["pursuer"], "ocid": "ocds-test-never-downgraded",
                                                      "contract_number": "PLAIN-1", "verdict": "possible"})
    ok2, err2 = c.as_user(users["pursuer_owner"], f"select acknowledge_discovery_downgrade('{plain_row['id']}')")
    check(not ok2 and "not been re-assessed" in err2, "a never-downgraded row: nothing to mark seen (refused)")
    ok, err = c.as_user(users["pursuer_validator"], f"select acknowledge_discovery_downgrade('{p['id']}')")
    p2 = opp("pursuer")
    check(ok and p2["downgrade_acknowledged_at"] and p2["downgrade_acknowledged_by"] == users["pursuer_validator"]
          and p2["downgraded_from"] == "strong_fit",
          "the pursuer's own member marks it seen: who + when recorded, the 'was strong_fit' marker kept")
    ok, err = c.as_user(users["pursuer_owner"], f"select acknowledge_discovery_downgrade('{p['id']}')")
    check(ok and opp("pursuer")["downgrade_acknowledged_by"] == users["pursuer_validator"],
          "marking it seen again keeps the first who/when")
    anon = c.sql("select has_function_privilege('anon', 'acknowledge_discovery_downgrade(uuid)', 'execute')")
    check(anon == "f", "anon can't call acknowledge_discovery_downgrade()")
    c.sql(f"update discovered_opportunities set downgrade_digested_at = null where id = '{p['id']}'")
    check(not any(i["opportunity_id"] == p["id"] for i in dd.pending_digest_downgrades(c)),
          "a downgrade already marked seen in the app is not put in a digest")

    # Recovery: the feed-only company tags security again -> strong_fit -> flag cleared.
    c.sql(f"update experience_items set disciplines = '{{security_facilities}}' where company_id = '{ids['feed']}'")
    run_and_seed()
    f2 = opp("feed")
    check(f2["verdict"] == "strong_fit" and f2["downgraded_from"] is None and f2["reasons_before"] is None,
          "recovery: back to strong_fit, the downgrade flag cleared")
    return ids, users, tender_id


if __name__ == "__main__":
    part1()
    psql = os.environ.get("DOWNGRADE_PSQL")
    if psql:
        part2(psql)
    else:
        print("(Part 2 skipped - set DOWNGRADE_PSQL to a scratch Postgres with the migrations replayed)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
