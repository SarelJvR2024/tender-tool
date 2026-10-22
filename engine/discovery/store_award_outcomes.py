"""
Stores published tender outcomes (award_outcomes.py's records) in
public_tender_outcomes (migration 0053), one row per real tender, with the
derived numbers the market-feedback views read. Design and data coverage:
docs/specs/Award-Price-Analysis-Findings.md.

award_outcomes.py stays the reader (report-only). This is the writer:

  * Groups source rows that are the same tender. A SANRAL tender shows up on
    SANRAL's closed list (opening register), its awarded list (winner) and the
    eTenders Awarded tab (winner, OCDS id). Key: 'sanral:<first SANRAL
    contract / NRA reference>' (award_match_keys(), same rule as the SQL
    function in 0053), else 'ocid:<ocid>'.
  * Keeps each source's own record under `parts` and recomputes everything
    else from the parts, so one source's later run never wipes another's.
  * Identifies the winner inside the register (exact name; else the one bid
    equal to the awarded amount; else a unique first-word match) and says
    which way it was found.
  * Computes per-tender, scale-free numbers - bidder count, winner's rank,
    winner / median bid, whether the lowest bid won - only where the data
    actually supports them: a single-contract register with 2+ priced bids.
    A batch register (one price column per contract), a multi-package award,
    an implausible amount or a register SANRAL only published inside the
    reCAPTCHA-gated download all get a plain-language data note instead.
  * Sorts each tender into Tender Tool's own discipline list
    (assess_tender.categorize() on the title - the taxonomy, not a second
    matcher).

Input: an award_outcomes.py report (--report, repeatable) or a fresh read
(--fetch, same options as award_outcomes.py). Output: rows upserted with the
service role (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), or
--dry-run to print the merged rows. Not scheduled anywhere yet.

Usage:
    python3 store_award_outcomes.py --report run.json [--report run2.json] [--dry-run]
    python3 store_award_outcomes.py --fetch --source both --limit 500 --sanral-limit 100
"""
import argparse
import datetime
import json
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import award_outcomes as ao  # noqa: E402
import assess_tender  # noqa: E402

# Above this a parsed amount is a source typo, not a price: SANRAL's
# "1. ARRB ... (for Package A) 2. ..." award text runs every package's figure
# into one 21-digit number. The largest real single award seen is ~R2.5bn.
MAX_PLAUSIBLE_ZAR = 50_000_000_000
# eTenders procurement types that mean no open price competition (a
# piggy-back on another organ of state's or SITA's contract included).
NOT_COMPETITIVE = ("sole source", "single source", "emergency", "deviation", "procurement from other", "sita contract")
SOURCE_PRIORITY = ("sanral_awarded", "sanral_closed", "etenders_portal")

# SANRAL contract numbers as typed on the two sites: "N.011-020-2018/1",
# "N001-013-2026/1" (no dot), "X.005-069-2025-1", "N.008-080-2020.2",
# "X.002-174-2023-/1F", batches "X.004-113/114-2024/1F". Normalised to
# L.RRR-...-YYYY/S. Same pattern in 0053's award_match_keys().
CONTRACT_RE = re.compile(r"(?:^|[^A-Z])([A-Z]{1,2})\.?([0-9]{3}-[0-9./-]*[0-9]{4})[-/._]+([0-9A-Z]+)")
NRA_RE = re.compile(r"NRA([0-9]{4})/([0-9]+)\(?([A-Z]{0,3})\)?", re.I)
NAME_NOISE = re.compile(r"\b(PTY|LTD|LIMITED|CC|INC|T/A|TRADING AS|THE|SA|SOUTH AFRICA|HOLDINGS|GROUP)\b")


def award_match_keys(text):
    """Python twin of the SQL award_match_keys() in 0053 - keep them identical."""
    t = (text or "").upper().replace("\u2013", "-").replace("\u2014", "-")
    keys = set()
    for m in CONTRACT_RE.finditer(re.sub(r"\s*([./-])\s*", r"\1", t)):
        keys.add(f"{m.group(1)}.{m.group(2)}/{m.group(3)}")
    for m in NRA_RE.finditer(re.sub(r"\s+", "", t)):
        keys.add(f"NRA{m.group(1)}/{m.group(2).lstrip('0')}{m.group(3).upper()}")
    return sorted(keys)


def norm_name(name):
    """Company name for comparing, not for showing: upper case, legal-form
    words and punctuation dropped ("Klipcorp Pty Ltd" == "KLIPCORP (PTY) LTD")."""
    s = (name or "").upper().replace("&", " AND ")
    s = re.sub(r"\(.*?\)", " ", s) if not re.fullmatch(r"\(.*\)", s.strip()) else s
    s = NAME_NOISE.sub(" ", s)
    return re.sub(r"[^A-Z0-9]", "", s)


def first_token(name):
    for w in re.split(r"[^A-Z0-9]+", (name or "").upper()):
        if len(w) >= 3 and not NAME_NOISE.fullmatch(w):
            return w
    return None


def plausible(amount):
    return amount if amount is not None and 0 < amount <= MAX_PLAUSIBLE_ZAR else None


# ---------------------------------------------------------------- source rows -> parts

def sanral_closing_date(raw):
    """SANRAL's list gives "2024/09/13 11:00" mostly, and free text
    ("Friday, 23 October 2026") sometimes: ISO date or None, never a guess."""
    m = re.match(r"\s*(\d{4})[/-](\d{2})[/-](\d{2})", raw or "")
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    text = re.sub(r"^\s*[A-Za-z]+day,?\s*", "", raw or "")
    return ao.parse_sanral_date(re.sub(r"\s+\d{1,2}[:h]\d{2}.*$", "", text))


def part_from_sanral(rec):
    """One award_outcomes SANRAL record (awarded or closed list) -> a part."""
    notes = []
    bidders = []
    columns = 0
    for e in rec.get("opening_register") or []:
        amounts = []
        for a in e.get("amounts") or []:
            amt = a.get("amount_zar")
            if amt is not None and plausible(amt) is None and amt != 0:
                notes.append(f"{e['tenderer']}: tendered amount {a.get('amount_raw')!r} could not be read as one figure - left out.")
                amt = None
            amounts.append({"column": a.get("column"), "amount_zar": plausible(amt), "amount_raw": a.get("amount_raw")})
        columns = max(columns, len(amounts))
        bidders.append({"name": e["tenderer"], "amounts": amounts, "bbbee": e.get("bbbee"), "notes": e.get("notes")})
    if rec.get("opening_register_note"):
        notes.append("SANRAL published this register only as an attachment inside the reCAPTCHA-gated tender "
                     "download - not read.")
    winner = rec.get("awarded_to")
    amount = rec.get("approved_contract_amount_zar")
    if amount is not None and plausible(amount) is None:
        notes.append(f"Approved amount {rec.get('approved_contract_amount_raw')!r} is not one figure "
                     "(several packages in one field?) - left out.")
        amount = None
    multi = bool(winner and re.search(r"\bPACKAGE\b|\b1\.\s.*\b2\.\s", winner, re.I))
    if multi:
        notes.append("Awarded in several packages to different firms - no single winning price.")
    return {
        "source": rec["source"], "source_url": rec.get("source_url"), "attribution": rec.get("attribution"),
        "reference": rec.get("reference"), "title": rec.get("title"), "buyer": "SANRAL",
        "project_type": rec.get("project_type"), "province": rec.get("province"),
        "closing_date": sanral_closing_date(rec.get("closing_date_raw")),
        "award_date": rec.get("awarded_on"),
        "winner": winner, "winner_amount_zar": amount, "winner_points": rec.get("full_points"),
        "winner_bbbee_points": rec.get("bbbee_points"), "winner_count": (2 if multi else (1 if winner else 0)),
        "bidders": bidders, "bidders_source": "sanral_register" if bidders else None,
        "register_columns": columns, "notes": notes, "competitive": True,
    }


def part_from_portal(rec):
    """One award_outcomes portal record -> a part."""
    notes = []
    awards = rec.get("awards") or []
    winner = awards[0]["supplier"] if len(awards) == 1 else ("; ".join(a["supplier"] for a in awards) or None)
    amount = plausible(awards[0]["amount_zar"]) if len(awards) == 1 else None
    if len(awards) > 1:
        notes.append(f"Awarded to {len(awards)} suppliers (a panel or split award) - no single winning price.")
    bidders = [{"name": b["bidder"], "amounts": [{"column": "Amount", "amount_zar": plausible(b.get("amount_zar")),
                                                  "amount_raw": None}]} for b in rec.get("bidders") or []]
    ptype = rec.get("procurement_type") or ""
    return {
        "source": "etenders_portal", "source_url": rec.get("source_url"), "attribution": None,
        "reference": rec.get("bid_number"), "title": rec.get("title"), "buyer": rec.get("buyer"),
        "ocid": rec.get("ocid"), "procurement_type": ptype or None, "province": rec.get("province"),
        "closing_date": rec.get("closing_date"), "award_date": rec.get("award_date"),
        "winner": winner, "winner_amount_zar": amount, "winner_count": len(awards),
        "bidders": bidders, "bidders_source": "etenders_bidders" if bidders else None,
        "register_columns": 1 if bidders else 0, "notes": notes,
        "competitive": not any(w in ptype.lower() for w in NOT_COMPETITIVE),
    }


def is_sanral_buyer(buyer):
    b = (buyer or "").upper()
    return b == "SANRAL" or "NATIONAL ROADS AGENCY" in b or "(SANRAL)" in b


def outcome_key(part):
    keys = award_match_keys(part.get("reference")) or award_match_keys(part.get("title"))
    if is_sanral_buyer(part.get("buyer")) and keys:
        return f"sanral:{keys[0]}"
    if part.get("ocid"):
        return f"ocid:{part['ocid']}"
    if part.get("source_url"):
        return f"url:{part['source_url']}"
    return None


# ---------------------------------------------------------------- merge + numbers

# A register amount this many times above or below the field's median is a
# typing error on the published register far more often than a real bid
# (seen: "R39 1453 554.20" for a R39m fee, "R 539 343 850,26" next to R37m).
OUTLIER_FACTOR = 5


def without_typos(sorted_amounts):
    """The priced bids that are within OUTLIER_FACTOR of the median (all of
    them when fewer than 3 - no field to judge against)."""
    if len(sorted_amounts) < 3:
        return sorted_amounts
    med = statistics.median(sorted_amounts)
    return [a for a in sorted_amounts if med / OUTLIER_FACTOR <= a <= med * OUTLIER_FACTOR]


def find_winner(bidders, winner, amount, column=0):
    """Index of the winner in the register and how it was found, or (None, None).

    "name_token" (first-word-only) is NOT a confident match - returned so
    merge() can mention the closest candidate, never so it can be stored as
    `is_winner`. Confirmed live, 2026-10-21: many real South African company
    names share a common first word (place names, Nguni/Sesotho words) while
    being completely unrelated entities - "Bokamoso Trading CC" and
    "Bokamoso Construction (Pty) Ltd" matched on first-token alone with
    neither an exact name nor an amount match, and a difflib similarity
    check doesn't cleanly separate this from a genuine trading-name variant
    of the SAME company (both land around 0.63-0.73) - there is no safe
    threshold, so this basis is never trusted to assert a fact on its own."""
    if not winner or not bidders:
        return None, None
    w = norm_name(winner)
    hits = [i for i, b in enumerate(bidders) if w and norm_name(b["name"]) == w]
    if len(hits) == 1:
        return hits[0], "name"
    if amount:
        hits = [i for i, b in enumerate(bidders) if len(b["amounts"]) > column
                and b["amounts"][column]["amount_zar"] and abs(b["amounts"][column]["amount_zar"] - amount) <= amount * 0.001]
        if len(hits) > 1:  # two equal bids: keep the one whose first word matches
            tok = first_token(winner)
            hits = [i for i in hits if first_token(bidders[i]["name"]) == tok] or hits
        if len(hits) == 1:
            return hits[0], "amount"
    tok = first_token(winner)
    hits = [i for i, b in enumerate(bidders) if tok and first_token(b["name"]) == tok]
    if len(hits) == 1:
        return hits[0], "name_token"
    return None, None


def merge(key, parts, existing_first_seen=None):
    """All parts of one tender -> one public_tender_outcomes row."""
    by_source = {p["source"]: p for p in parts}
    ordered = [by_source[s] for s in SOURCE_PRIORITY if s in by_source]
    first = lambda field: next((p.get(field) for p in ordered if p.get(field) not in (None, "", [])), None)  # noqa: E731
    register = next((p for p in ordered if p.get("bidders_source") == "sanral_register"), None) \
        or next((p for p in ordered if p.get("bidders")), None)
    winner_part = next((p for p in ordered if p.get("winner")), None)
    notes = [n for p in ordered for n in p.get("notes") or []]
    bidders = [dict(b) for b in (register["bidders"] if register else [])]
    columns = register["register_columns"] if register else 0
    winner = winner_part["winner"] if winner_part else None
    amount = winner_part.get("winner_amount_zar") if winner_part else None
    winner_count = winner_part.get("winner_count", 0) if winner_part else 0
    if winner_part and not amount:
        amount = next((p.get("winner_amount_zar") for p in ordered if p.get("winner_amount_zar")), None)

    row = {
        "outcome_key": key,
        "match_keys": sorted({k for p in ordered for k in award_match_keys(p.get("reference")) + award_match_keys(p.get("title"))}),
        "ocid": first("ocid"), "reference": first("reference"), "buyer": first("buyer"), "title": first("title"),
        "project_type": first("project_type"), "procurement_type": first("procurement_type"), "province": first("province"),
        "competitive": all(p.get("competitive", True) for p in ordered),
        "status": "awarded" if winner else "register_published",
        "closing_date": first("closing_date"), "award_date": first("award_date"),
        "winner_name": winner, "winner_amount_zar": amount,
        "winner_points": first("winner_points"), "winner_bbbee_points": first("winner_bbbee_points"),
        "winner_count": winner_count,
        "bidders_source": register["bidders_source"] if register else None,
        "register_columns": columns,
        "bidder_count": len(bidders),
        "low_bid_zar": None, "median_bid_zar": None, "high_bid_zar": None,
        "winner_rank": None, "winner_vs_median": None, "lowest_bid_won": None, "winner_match_basis": None,
        "sources": [p["source"] for p in ordered],
        "source_urls": [p["source_url"] for p in ordered if p.get("source_url")],
        "attribution": first("attribution"),
        "parts": {p["source"]: p for p in ordered},
        "refreshed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if existing_first_seen:
        row["first_seen_at"] = existing_first_seen
    cats = [c for c in assess_tender.categorize(row["title"], None) if not c.startswith("uncategorized")]
    row["categories"] = cats

    priced = [b["amounts"][0]["amount_zar"] for b in bidders if b["amounts"] and b["amounts"][0]["amount_zar"]]
    row["priced_bidder_count"] = sum(1 for b in bidders if any(a["amount_zar"] for a in b["amounts"]))
    wi, basis = (None, None)
    if winner_count == 1:
        wi, basis = find_winner(bidders, winner, amount)
    if wi is not None and basis in ("name", "amount"):
        bidders[wi]["is_winner"] = True
        row["winner_match_basis"] = basis
    elif wi is not None:  # basis == "name_token": a candidate, never a confirmed fact (see find_winner())
        notes.append(f"The winner ({winner}) could not be confidently matched to a name on the published "
                     f"register - closest candidate by first word: {bidders[wi]['name']} (not assumed; verify manually).")
    elif winner and bidders and winner_count == 1:
        notes.append(f"The winner ({winner}) could not be matched to a name on the published register.")
    if columns > 1:
        notes.append(f"Batch tender: the register has one price per contract ({columns} columns), so no "
                     "single field-wide numbers are worked out.")
    elif len(priced) >= 2:
        s = sorted(priced)
        kept = without_typos(s)
        if len(kept) < len(s):
            notes.append(f"{len(s) - len(kept)} tendered amount(s) more than {OUTLIER_FACTOR}x away from the median bid "
                         "left out of the numbers (most likely a typing error on the register; shown as published).")
        s = kept
        row["low_bid_zar"], row["high_bid_zar"] = s[0], s[-1]
        row["median_bid_zar"] = round(statistics.median(s), 2)
        if wi is not None and bidders[wi]["amounts"] and bidders[wi]["amounts"][0]["amount_zar"]:
            wa = bidders[wi]["amounts"][0]["amount_zar"]
            # A real backfill run crashed the whole store() on a numeric
            # overflow: without_typos() (above) screens the general bid
            # list before the median is taken, but never the WINNER's own
            # amount - a typo'd winner amount (e.g. a missing decimal, an
            # OCR/parsing slip) could still divide out to a ratio
            # winner_vs_median's own numeric(8,4) column (0053) can't hold
            # (max ~9999.9999), and with fewer than 3 bids without_typos()
            # doesn't filter anything at all, so this isn't only a
            # never-happens case. Same OUTLIER_FACTOR bound as the general
            # list, applied to the winner's own amount specifically.
            if row["median_bid_zar"] / OUTLIER_FACTOR <= wa <= row["median_bid_zar"] * OUTLIER_FACTOR:
                row["winner_rank"] = 1 + sum(1 for a in s if a < wa)
                row["winner_vs_median"] = round(wa / row["median_bid_zar"], 4)
                row["lowest_bid_won"] = row["winner_rank"] == 1
            else:
                notes.append(f"The winner's own recorded amount is more than {OUTLIER_FACTOR}x away from the "
                             "median bid (most likely a typing error on the register) - left out of the "
                             "field-wide numbers, shown as published.")
    if not row["competitive"]:
        notes.append(f"The buyer recorded this as '{row['procurement_type']}' - no open price competition.")
    row["bidders"] = bidders
    row["data_notes"] = list(dict.fromkeys(notes))
    return row


def parts_from_report(report):
    parts = []
    for rec in (report.get("portal") or {}).get("records") or []:
        parts.append(part_from_portal(rec))
    for block in (report.get("sanral") or {}).values():
        for rec in block.get("records") or []:
            parts.append(part_from_sanral(rec))
    return parts


def build_rows(parts, existing=None):
    """parts -> merged rows. `existing`: {outcome_key: row already stored},
    whose parts are kept unless this run brings the same source again."""
    existing = existing or {}
    grouped = {}
    for p in parts:
        k = outcome_key(p)
        if k:
            grouped.setdefault(k, {})[p["source"]] = p
    rows = []
    for k, new_parts in grouped.items():
        old = existing.get(k) or {}
        merged_parts = dict(old.get("parts") or {})
        merged_parts.update(new_parts)
        rows.append(merge(k, list(merged_parts.values()), old.get("first_seen_at")))
    return rows


def store(client, parts, log=print):
    keys = sorted({k for k in (outcome_key(p) for p in parts) if k})
    existing = {}
    for i in range(0, len(keys), 100):
        for r in client.select("public_tender_outcomes", {"outcome_key": keys[i:i + 100]}):
            existing[r["outcome_key"]] = r
    rows = build_rows(parts, existing)
    for i in range(0, len(rows), 200):
        client.upsert("public_tender_outcomes", rows[i:i + 200], "outcome_key")
    log(f"stored {len(rows)} tender outcome(s) ({len(existing)} already known, merged)")
    return rows


def summarize(rows):
    return {
        "tenders": len(rows),
        "awarded": sum(1 for r in rows if r["status"] == "awarded"),
        "with_priced_register_2plus": sum(1 for r in rows if r["priced_bidder_count"] >= 2),
        "with_field_numbers": sum(1 for r in rows if r["median_bid_zar"] is not None),
        "winner_placed_in_register": sum(1 for r in rows if r["winner_rank"] is not None),
        "competitive": sum(1 for r in rows if r["competitive"]),
        "categorised": sum(1 for r in rows if r["categories"]),
        "merged_from_2plus_sources": sum(1 for r in rows if len(r["sources"]) > 1),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", action="append", default=[], help="award_outcomes.py --out JSON (repeatable)")
    ap.add_argument("--fetch", action="store_true", help="read the live sources now (award_outcomes.py)")
    ap.add_argument("--source", choices=["portal", "sanral", "both"], default="both")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--department", type=int, default=None)
    ap.add_argument("--sanral-lists", default="awarded,closed")
    ap.add_argument("--sanral-limit", type=int, default=40)
    ap.add_argument("--sanral-start-page", type=int, default=1,
                     help="resume a chunked backfill from this page (page_size 50) instead of the newest tender")
    ap.add_argument("--dry-run", action="store_true", help="print a summary and the rows, write nothing")
    ap.add_argument("--out", default=None, help="with --dry-run: write the merged rows here")
    args = ap.parse_args()

    parts = []
    for path in args.report:
        parts += parts_from_report(json.load(open(path)))
    if args.fetch:
        report = {}
        if args.source in ("portal", "both"):
            raw, _, _, _ = ao.fetch_portal_awarded(args.limit, args.department)
            report["portal"] = {"records": [ao.normalize_portal_award(r) for r in raw]}
        if args.source in ("sanral", "both"):
            report["sanral"] = {k: ao.fetch_sanral_outcomes(k.strip(), args.sanral_limit,
                                                            start_page=args.sanral_start_page)
                                for k in args.sanral_lists.split(",") if k.strip()}
        parts += parts_from_report(report)
    if not parts:
        raise SystemExit("nothing to store: pass --report and/or --fetch")

    if args.dry_run:
        rows = build_rows(parts)
        print(json.dumps(summarize(rows), indent=2))
        if args.out:
            json.dump(rows, open(args.out, "w"), indent=1, default=str)
        return
    import company_profiles  # noqa: E402
    client = company_profiles.RestClient.from_env()
    if client is None:
        raise SystemExit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or use --dry-run).")
    rows = store(client, parts)
    print(json.dumps(summarize(rows), indent=2))


if __name__ == "__main__":
    main()
