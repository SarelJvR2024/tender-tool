"""
Checks for the market-price feedback (store_award_outcomes.py + migration
0053 public_tender_outcomes). Design: docs/specs/Award-Price-Analysis-Findings.md.

Part 1 (offline, in CI): real records read on 2026-10-17 by award_outcomes.py
(fixtures/award_prices/real_outcomes_2026-10-17.json - SANRAL awarded and
closed pages, eTenders Awarded tab; personal fields already dropped) go
through the writer:
  1. one row per real tender: SANRAL's awarded page and the eTenders row for
     X.003-080-2024/1 merge into one outcome, keeping both sources;
  2. the winner is found in the register by name, or by the awarded amount
     when the names differ (VNA Consulting), and says which;
  3. field numbers (rank, winner / median, lowest won) only for a
     single-contract register with 2+ priced bids - a batch register
     (NRA 2026/0084(B), 3 price columns), a multi-package award and the
     gated "refer to attached" register get a data note instead;
  4. an amount SANRAL typed as several packages in one field is not turned
     into a 21-digit price; a sole-source award is marked non-competitive;
  5. a later run of one source keeps the other sources' parts (merge);
  6. award_match_keys() on real references.

Part 2 (AWARD_PRICES_PSQL set - scratch Postgres with every migration
replayed): rows stored through the same upsert path; the SQL
award_match_keys() agrees with the Python one; signed-in users read the
table but cannot write it; tender_market_outcomes() matches a company's
tenders by SANRAL reference (contract_no or nra_reference, any spacing) and
OCDS id, and never through another company's private tender.

    AWARD_PRICES_PSQL="psql -h /tmp/tt-awp-pg/sock -p 54451 -U postgres -d awp" \\
        python3 engine/discovery/test_award_prices.py
"""
import json
import os
import shlex
import subprocess
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("TT_TAXONOMY_SOURCE", "seed")
import store_award_outcomes as sao  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "award_prices", "real_outcomes_2026-10-17.json")
FAILS = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


REFERENCES = {
    "R.396-010-2025/1F": ["R.396-010-2025/1F"],
    "NRA 2026/0756 (C)": ["NRA2026/756C"],
    "NRA 2026/0084(B)": ["NRA2026/84B"],
    "NRA 2026/0084": ["NRA2026/84"],
    "CONTRACT SANRAL N.011-020-2018/1": ["N.011-020-2018/1"],
    "SUB-CONTRACT SANRAL R.071-030-2020/1MI": ["R.071-030-2020/1MI"],
    "CONTRACT SANRAL: X.003-080-2024/1": ["X.003-080-2024/1"],
    "X.004-113/114-2024/1F": ["X.004-113/114-2024/1F"],
    "r.396 - 010-2025/1f": ["R.396-010-2025/1F"],
    "NRA 2026/00167(E)": ["NRA2026/167E"],
    "UPGRADING ... CONTRACT SANRAL N.011-020-2018/1 / NRA 2026/0084 (B)": ["N.011-020-2018/1", "NRA2026/84B"],
    "N001-013-2026/1": ["N.001-013-2026/1"],
    "SANRAL X.005-069-2025-1": ["X.005-069-2025/1"],
    "CONTRACT SANRAL N.008-080-2020.3": ["N.008-080-2020/3"],
    "SANRAL X.002-174-2023-/1F": ["X.002-174-2023/1F"],
    "CONTRACT SANRAL N.002-250-2019_1F": ["N.002-250-2019/1F"],
    "CONTRACT SANRAL R300-010-2022/1RF": ["R.300-010-2022/1RF"],
    "SANRAL N.002\u2013060\u20132021/2 and N.002\u2013060\u20132022/1": ["N.002-060-2021/2", "N.002-060-2022/1"],
    "SCMU10-26/27-0017": [],
    "ER4004/61132-2022/1FR": [],
    "SS 2026/65210/1027/020": [],
    "RFQ 01/2026": [],
    "E2934NTCSAMWP": [],
    "SANRAL HO 57000/1002/2026/1": [],
}


def rows_by_key():
    return {r["outcome_key"]: r for r in sao.build_rows(sao.parts_from_report(json.load(open(FIXTURE))))}


def part1():
    print("Part 1 - real published records through the writer")
    for ref, want in REFERENCES.items():
        check(f"award_match_keys({ref!r})", sao.award_match_keys(ref) == want, f"got {sao.award_match_keys(ref)}")

    rows = rows_by_key()
    check("9 source records -> 8 tenders (one merged)", len(rows) == 8, f"{sorted(rows)}")

    x = rows.get("sanral:X.003-080-2024/1")
    check("SANRAL page + eTenders row are one outcome", x and x["sources"] == ["sanral_awarded", "etenders_portal"], f"{x and x['sources']}")
    check("merged outcome keeps the eTenders OCDS id", x and x["ocid"] == "ocds-9t57fa-157638")
    check("merged outcome keeps SANRAL's register (31 tenderers)", x and x["bidders_source"] == "sanral_register" and x["bidder_count"] == 31)
    check("X.003-080: winner found by name, 15th lowest, 0.987 x median",
          x and x["winner_match_basis"] == "name" and x["winner_rank"] == 15 and x["winner_vs_median"] == 0.987 and x["lowest_bid_won"] is False,
          f"{x and (x['winner_match_basis'], x['winner_rank'], x['winner_vs_median'])}")

    n = rows.get("sanral:N.011-020-2018/1")
    check("N.011-020: lowest of 4 won, R1 209 098 827.03",
          n and n["winner_rank"] == 1 and n["lowest_bid_won"] is True and n["priced_bidder_count"] == 4 and n["winner_amount_zar"] == 1209098827.03)

    v = rows.get("sanral:R.062-070-2021/1F")
    check("R.062-070: 'NEXOR 312 T/A VNA CONSULTING' found as 'VNA Consulting' by the awarded amount",
          v and v["winner_match_basis"] == "amount" and [b["name"] for b in v["bidders"] if b.get("is_winner")] == ["VNA Consulting"],
          f"{v and v['winner_match_basis']}")
    check("R.062-070: 38 on the register, 11 with a price (technical-only entries kept, unpriced)",
          v and v["bidder_count"] == 38 and v["priced_bidder_count"] == 11)

    b = rows.get("sanral:NRA2026/84B")
    check("NRA 2026/0084(B) is a batch register: 3 columns, no field-wide numbers, noted",
          b and b["register_columns"] == 3 and b["median_bid_zar"] is None and any("Batch tender" in s for s in b["data_notes"]))
    kc = [e for e in (b or {}).get("bidders", []) if sao.norm_name(e["name"]) == sao.norm_name("Klipcorp (Pty) Ltd")]
    check("NRA 2026/0084(B): Klipcorp's three published prices are kept per contract",
          len(kc) == 1 and [a["amount_zar"] for a in kc[0]["amounts"]] == [39057887.0, 23004609.96, 38280869.0],
          f"{kc and [a['amount_zar'] for a in kc[0]['amounts']]}")
    check("NRA 2026/0084(B): register published, not awarded", b and b["status"] == "register_published" and not b["winner_name"])

    g = rows.get("sanral:R.531-020-2026/2")
    check("gated 'refer to attached' register: no fake bidders, says why",
          g and g["bidder_count"] == 0 and any("reCAPTCHA" in s for s in g["data_notes"]))

    p = next((r for k, r in rows.items() if k.startswith("url:") and "57000" in k), None)
    check("multi-package award: amount text not read as a 21-digit price, no winner placed, noted",
          p and p["winner_amount_zar"] is None and p["winner_rank"] is None
          and any("several packages" in s for s in p["data_notes"]), f"{p and p['data_notes']}")

    s = rows.get("ocid:ocds-9t57fa-174379")
    check("sole-source award is non-competitive and says so", s and s["competitive"] is False and any("Sole source" in t for t in s["data_notes"]))
    e = rows.get("ocid:ocds-9t57fa-172895")
    check("eTenders bidders list (ESKOM E2934): 7 priced, winner lowest at 0.357 x median",
          e and e["bidders_source"] == "etenders_bidders" and e["priced_bidder_count"] == 7 and e["winner_rank"] == 1 and e["winner_vs_median"] == 0.3573)

    # 5. merge across runs: store the closed-list part first, then the awarded part alone
    rep = json.load(open(FIXTURE))
    only_portal = sao.parts_from_report({"portal": {"records": [r for r in rep["portal"]["records"] if r["portal_id"] == 157638]}})
    only_sanral = sao.parts_from_report({"sanral": {"awarded": {"records": [r for r in rep["sanral"]["awarded"]["records"] if "X.003-080" in r["reference"]]}}})
    first = {r["outcome_key"]: r for r in sao.build_rows(only_portal)}
    check("eTenders-only first: the portal's own bidders list is used",
          first["sanral:X.003-080-2024/1"]["bidders_source"] == "etenders_bidders", f"{first['sanral:X.003-080-2024/1']['bidders_source']}")
    second = {r["outcome_key"]: r for r in sao.build_rows(only_sanral, existing=first)}["sanral:X.003-080-2024/1"]
    check("a later SANRAL-only run keeps the eTenders part (OCDS id) and adds the register",
          second["sources"] == ["sanral_awarded", "etenders_portal"] and second["ocid"] == "ocds-9t57fa-157638"
          and second["bidders_source"] == "sanral_register" and second["bidder_count"] == 31)
    check("SANRAL closing dates: list format and free text, never a guess",
          [sao.sanral_closing_date(v) for v in ("2024/09/13 11:00", "Friday, 23 October 2026", "Friday, 23 October 2026 11:00", "TBC")]
          == ["2024-09-13", "2026-10-23", "2026-10-23", None])
    check("a register typo 10x the field (R391m among R37-39m fees) is left out of the numbers",
          sao.without_typos([37099037.38, 38015435.0, 39057887.0, 391453554.20]) == [37099037.38, 38015435.0, 39057887.0])
    check("names compare without legal-form noise", sao.norm_name("Klipcorp Pty Ltd") == sao.norm_name("KLIPCORP (PTY) LTD") == "KLIPCORP")


# ------------------------------------------------------------------ Part 2

class Psql:
    def __init__(self, cmd):
        self.cmd = shlex.split(cmd)

    def run(self, q, uid=None):
        if uid:
            q = f"set role authenticated; set test.uid = '{uid}'; " + q
        # on stdin, not -c: a batch of stored rows is larger than an argv allows
        return subprocess.run(self.cmd + ["-q", "-tA", "-v", "ON_ERROR_STOP=1"], input=q, capture_output=True, text=True)

    def val(self, q, uid=None):
        r = self.run(q, uid)
        if r.returncode:
            raise RuntimeError(r.stderr)
        return r.stdout.strip()

    # the slice of RestClient store() uses
    def select(self, table, filters=None, order=None):
        where = ""
        if filters:
            (col, vals), = filters.items()
            where = f" where {col} in (select jsonb_array_elements_text({lit(json.dumps(vals))}::jsonb))"
        return json.loads(self.val(f"select coalesce(json_agg(t), '[]') from (select * from {table}{where}) t"))

    def upsert(self, table, rows, on_conflict):
        cols = list(rows[0].keys())
        sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c != on_conflict)
        self.val(f"insert into {table} ({', '.join(cols)}) select {', '.join(cols)} from "
                 f"jsonb_populate_recordset(null::{table}, {lit(json.dumps(rows, default=str))}::jsonb) "
                 f"on conflict ({on_conflict}) do update set {sets}")


def lit(s):
    return "'" + s.replace("'", "''") + "'"


def part2(cmd):
    print("Part 2 - public_tender_outcomes on the replayed migrations")
    db = Psql(cmd)
    db.val("delete from public_tender_outcomes")
    parts = sao.parts_from_report(json.load(open(FIXTURE)))
    sao.store(db, parts, log=lambda m: None)
    check("8 outcomes stored", db.val("select count(*) from public_tender_outcomes") == "8")
    sao.store(db, parts, log=lambda m: None)
    check("storing again is idempotent (still 8, first_seen_at kept)", db.val("select count(*) from public_tender_outcomes") == "8")

    for ref, want in REFERENCES.items():
        got = json.loads(db.val(f"select to_json(award_match_keys({lit(ref)}))"))
        check(f"SQL award_match_keys = Python for {ref!r}", got == sao.award_match_keys(ref), f"sql {got}")

    ua, ub = str(uuid.uuid4()), str(uuid.uuid4())
    db.val(f"insert into auth.users (id, email) values ('{ua}', 'a@test.local'), ('{ub}', 'b@test.local')")
    ca = db.val("insert into companies (legal_name) values ('Klipcorp (Pty) Ltd') returning id").splitlines()[0]
    cb = db.val("insert into companies (legal_name) values ('Market Test Co B') returning id").splitlines()[0]
    db.val(f"insert into company_members (company_id, user_id, role) values ('{ca}', '{ua}', 'owner'), ('{cb}', '{ub}', 'owner')")
    sfx = uuid.uuid4().hex[:8]

    def tender(contract_no, nra=None, ocid=None, source="sanral", owner=None):
        cols = {"slug": f"mkt-{sfx}-{uuid.uuid4().hex[:6]}", "contract_no": contract_no, "nra_reference": nra, "ocid": ocid,
                "source": source, "owner_company_id": owner, "family": "Conventional Consultant Tender" if source == "sanral" else "GENERAL"}
        cols = {k: v for k, v in cols.items() if v is not None}
        return db.val(f"insert into tenders ({', '.join(cols)}) values ({', '.join(lit(str(v)) for v in cols.values())}) returning id").splitlines()[0]

    t_batch = tender("NRA 2026/0084 (B)")                        # spacing differs from the register's reference
    t_nra = tender("R.999-999-2026/1F", nra="CONTRACT SANRAL N.011-020-2018/1")
    t_ocid = tender("172895", ocid="ocds-9t57fa-172895", source="etenders_ocds")
    t_none = tender("R.000-000-2026/1F")
    t_priv = tender("X.003-080-2024/1", source="manual", owner=cb)  # company B's private copy
    for t in (t_batch, t_nra, t_ocid, t_none):
        db.val(f"insert into tender_packs (company_id, tender_id) values ('{ca}', '{t}')")
    db.val(f"insert into tender_packs (company_id, tender_id) values ('{cb}', '{t_priv}')")
    db.val("grant usage on schema public to authenticated; grant all on public_tender_outcomes, tenders, tender_packs to authenticated; "
           "grant execute on function tender_market_outcomes(uuid[]), award_match_keys(text) to authenticated")

    ids = "array[" + ",".join(f"'{t}'::uuid" for t in (t_batch, t_nra, t_ocid, t_none, t_priv)) + "]"
    got = json.loads(db.val(f"select coalesce(json_agg(json_build_object('t', m.tender_id, 'k', o.outcome_key, 'on', m.matched_on)), '[]') "
                            f"from tender_market_outcomes({ids}) m join public_tender_outcomes o on o.id = m.outcome_id", uid=ua))
    seen = {(g["t"], g["k"], g["on"]) for g in got}
    check("company A: 'NRA 2026/0084 (B)' finds the NRA 2026/0084(B) register", (t_batch, "sanral:NRA2026/84B", "reference") in seen, f"{seen}")
    check("company A: a tender whose nra_reference carries the contract finds N.011-020", (t_nra, "sanral:N.011-020-2018/1", "reference") in seen)
    check("company A: an eTenders tender finds its award by OCDS id", (t_ocid, "ocid:ocds-9t57fa-172895", "ocid") in seen)
    check("company A: a tender with no published result matches nothing", not any(g["t"] == t_none for g in got))
    check("company A: company B's private tender never matches (RLS on tenders)", not any(g["t"] == t_priv for g in got))
    check("company A gets exactly 3 matches", len(got) == 3, f"{len(got)}")
    got_b = json.loads(db.val(f"select coalesce(json_agg(m.tender_id), '[]') from tender_market_outcomes({ids}) m", uid=ub))
    check("company B: its own private copy of X.003-080 finds the published outcome", t_priv in got_b, f"{got_b}")
    check("company B: shared tenders match for B too (they are public), so 4 in all", len(got_b) == 4, f"{got_b}")

    check("signed-in users read the outcomes", db.val("select count(*) from public_tender_outcomes", uid=ua) == "8")
    r = db.run("insert into public_tender_outcomes (outcome_key, status) values ('x:test', 'awarded')", uid=ua)
    check("signed-in users cannot insert (service role only)", r.returncode != 0)
    r = db.run("update public_tender_outcomes set winner_name = 'me' returning id", uid=ua)
    check("signed-in users cannot update", r.returncode == 0 and r.stdout.strip() == "")
    r = db.run("set role anon; select count(*) from public_tender_outcomes")
    check("anonymous visitors read nothing", r.stdout.strip().endswith("0") or r.returncode != 0, r.stdout + r.stderr)

    db.val(f"delete from tender_packs where company_id in ('{ca}', '{cb}'); delete from tenders where slug like 'mkt-{sfx}-%'; "
           f"delete from companies where id in ('{ca}', '{cb}'); delete from auth.users where id in ('{ua}', '{ub}')")


def main():
    part1()
    cmd = os.environ.get("AWARD_PRICES_PSQL")
    if cmd:
        part2(cmd)
    else:
        print("(Part 2 skipped: set AWARD_PRICES_PSQL to a replayed scratch database)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
