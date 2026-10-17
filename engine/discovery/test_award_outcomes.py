"""
Offline checks for award_outcomes.py's parsing - no network.

Fixtures are trimmed copies of real responses read on 2026-10-17 (an eTenders
portal Awarded-tab row, and SANRAL awarded/closed detail-page tables), with
the individual officials' names replaced by placeholders. Each check is a
behaviour the report relies on:

  1. rand amounts in every format seen on the two sites parse to the same number;
  2. a portal row keeps winner/amount/date/enterprise type, links to its OCDS
     ocid, and drops contact people, phone numbers and officials' emails;
  3. the same award entered twice in two formats is reported once;
  4. SANRAL's result table gives winner, points, amount and award date, and
     never the names of the officials who opened/recorded/attended;
  5. the opening register is read by its header, including the batch layout
     (one amount column per contract) and numbered tenderer names;
  6. a "REFER TO ATTACHED OPENING REGISTER" page yields no fake bidders, and
     says the register is only in the (gated) download.

Usage: python3 engine/discovery/test_award_outcomes.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import award_outcomes as ao  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# 1. amounts
cases = {
    "R551\xa0189,00": 551189.00,
    "678228,5": 678228.50,
    "R678\xa0228,50": 678228.50,
    "R 274 589 809.84": 274589809.84,
    "R274,389,252.50": 274389252.50,
    "R 75 720 000.00 (Including VAT.)": 75720000.00,
    "R0,00": 0.0,
    "-": None,
    "": None,
    290000.0: 290000.0,
}
for raw, want in cases.items():
    got = ao.parse_rand(raw)
    check(f"parse_rand({raw!r})", got == want, f"got {got}")
check("portal 0001-01-01 is no date", ao.parse_portal_date("0001-01-01T00:00:00") is None)
check("SANRAL '21 April 2022'", ao.parse_sanral_date("21 April 2022") == "2022-04-21")
check("SANRAL '08.12.2021' / '19-June-2026' / '03/08/2021'",
      [ao.parse_sanral_date(s) for s in ("08.12.2021", "19-June-2026", "03/08/2021")]
      == ["2021-12-08", "2026-06-19", "2021-08-03"])
check("SANRAL typo date stays unparsed", ao.parse_sanral_date("24 JANAUARY 2023") is None)
check("clean_name strips parentheses", ao.clean_name(" (ROADMAC SURFACING)") == "ROADMAC SURFACING")
check("clean_name strips numbering", ao.clean_name("5. Klipcorp Pty Ltd") == "Klipcorp Pty Ltd")

# 2-3. portal row (shape of id 174379 / a duplicated Limpopo Roads Agency award)
PORTAL_ROW = {
    "id": 174379, "tender_No": "Q27-171-SN ",
    "description": "Supply and delivery of AUMA Multi-turn Actuators and Controllers",
    "category": "Supplies: Electrical Equipment", "type": "Sole source bidding",
    "organ_of_State": "uMngeni-uThukela Water", "province": "KwaZulu-Natal",
    "date_Published": "2026-10-15T00:00:00", "closing_Date": "2026-10-16T11:00:00",
    "awardDate": "2026-10-14T00:00:00",
    "contactPerson": "PLACEHOLDER BUYER CONTACT", "email": "buyer.official@example.org",
    "telephone": "000-000-0000", "awardContact": "PLACEHOLDER SUPPLIER CONTACT",
    "contactNumber": "000 000 0000",
    "awards": [
        {"company": "AUMANAT", "tenderAmount": "678228,5", "enterpriseType": "EME",
         "awardDate": "2026-10-14T00:00:00", "contactPerson": "PLACEHOLDER SUPPLIER CONTACT",
         "contactNumber": "000 000 0000", "createdBy": "buyer.official@example.org",
         "isDeleted": False},
        {"company": "AUMANAT", "tenderAmount": "R678\xa0228,50", "enterpriseType": "EME",
         "awardDate": "2026-10-14T00:00:00", "isDeleted": False},
        {"company": "DELETED CO", "tenderAmount": "R1,00", "isDeleted": True},
    ],
    "bidders": [
        {"biddersName": "DRUBANGO INVESTMENTS", "amount": 290000.0, "isDeleted": False,
         "updatedBy": "buyer.official@example.org"},
        {"biddersName": "DRUBANGO INVESTMENTS", "amount": 290000.0, "isDeleted": False},
    ],
}
rec = ao.normalize_portal_award(PORTAL_ROW)
check("portal ocid from id", rec["ocid"] == "ocds-9t57fa-174379", rec["ocid"])
check("portal bid number trimmed", rec["bid_number"] == "Q27-171-SN")
check("portal award deduped across formats", len(rec["awards"]) == 1, rec["awards"])
check("portal deleted award ignored", all(a["supplier"] != "DELETED CO" for a in rec["awards"]))
check("portal winner + amount + type",
      rec["awards"][0]["supplier"] == "AUMANAT" and rec["awards"][0]["amount_zar"] == 678228.5
      and rec["awards"][0]["enterprise_type"] == "EME")
check("portal bidders deduped", rec["bidders"] == [{"bidder": "DRUBANGO INVESTMENTS", "amount_zar": 290000.0}])
flat = repr(rec)
check("portal drops personal contact data",
      not any(s in flat for s in ("PLACEHOLDER", "example.org", "000-000-0000", "000 000 0000")),
      flat)

# 4-5. SANRAL awarded page (R.336-010-2017/1 layout)
AWARDED_HTML = """
<h3>FOR THE UPGRADING OF NATIONAL ROUTE R336 CONTRACT SANRAL R.336-010-2017/1</h3>
<p><table border="1"><tbody>
<tr><td width="200px"><strong>Tender Notice:</strong>&nbsp;</td><td>&nbsp;</td></tr>
<tr><td width="200px"><strong>Awarded To:</strong>&nbsp;</td><td>ROADMAC SURFACING CAPE (PTY) LTD</td></tr>
<tr><td width="200px"><strong>BBBEE Points:</strong>&nbsp;</td><td>10</td></tr>
<tr><td width="200px"><strong>Full Points Awarded:</strong>&nbsp;</td><td>77.66</td></tr>
<tr><td width="200px"><strong>Approved Contract Amount:</strong>&nbsp;</td><td>R 274 589 809.84</td></tr>
<tr><td width="200px"><strong>Awarded On:</strong>&nbsp;</td><td>21 April 2022</td></tr>
<tr><td width="200px"><strong>Contract Duration:</strong>&nbsp;</td><td>24 Months</td></tr>
<tr><td width="200px"><strong>Tenders Opened by:</strong>&nbsp;</td><td>OFFICIAL ONE</td></tr>
<tr><td width="200px"><strong>Tender Recorded by:</strong>&nbsp;</td><td>OFFICIAL TWO</td></tr>
<tr><td width="200px"><strong>In Attendance:</strong>&nbsp;</td><td>OFFICIAL THREE, OFFICIAL FOUR</td></tr>
</tbody></table>
<table border="1"><tbody>
<tr style="background-color: grey;"><td><strong>Tenderer's Name</strong></td><td><strong>Amount Tendered</strong></td>
<td><strong>Alt Tender</strong></td><td><strong>Notes</strong></td></tr>
<tr><td>ROADMAC SURFACING CAPE</td><td>R275 172 900.30</td><td>&nbsp;</td><td>1</td></tr>
<tr><td>UNIK</td><td>R279 762 356.96</td><td>&nbsp;</td><td>2</td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</tbody></table>
"""
p = ao.parse_sanral_result_page(AWARDED_HTML)
check("SANRAL winner", p["awarded_to"] == "ROADMAC SURFACING CAPE (PTY) LTD", p["awarded_to"])
check("SANRAL points", p["bbbee_points"] == "10" and p["full_points"] == "77.66")
check("SANRAL contract amount", p["approved_contract_amount_zar"] == 274589809.84)
check("SANRAL award date", p["awarded_on"] == "2022-04-21")
check("SANRAL register: 2 tenderers, blank rows skipped", len(p["opening_register"]) == 2, p["opening_register"])
check("SANRAL register amount", p["opening_register"][1]["amounts"][0]["amount_zar"] == 279762356.96)
check("SANRAL drops officials' names", "OFFICIAL" not in repr(p), repr(p))

# 5. batch layout (NRA 2026/0084(B), three contracts, one amount column each)
BATCH_HTML = """<table><tbody>
<tr><td><strong>Awarded To:</strong>&nbsp;</td><td>&nbsp;</td></tr></tbody></table>
<table><tbody>
<tr><td>Tenderer's Name</td><td>Amount Tendered For N.001-012-2026/1F &amp; N.001-014-2026/1F</td>
<td>Amount Tendered For N.007-046-2026/1F</td><td>Amount Tendered For N.002-025-2026/1F</td><td>BBBEE</td><td>Notes</td></tr>
<tr><td>2. Civil Design</td><td>-</td><td>R23 431 778.91</td><td>-</td><td>Level 1</td><td></td></tr>
<tr><td>5. Klipcorp Pty Ltd</td><td>R39 057 887.00</td><td>R23 004 609.96</td><td>R38 280 869.00</td><td>Level 1</td><td></td></tr>
</tbody></table>"""
b = ao.parse_sanral_result_page(BATCH_HTML)
check("batch: not awarded yet", b["awarded_to"] is None)
check("batch: numbered names cleaned", [r["tenderer"] for r in b["opening_register"]] == ["Civil Design", "Klipcorp Pty Ltd"])
k = b["opening_register"][1]
check("batch: one amount per contract column",
      [a["amount_zar"] for a in k["amounts"]] == [39057887.00, 23004609.96, 38280869.00], k)
check("batch: '-' is no bid", b["opening_register"][0]["amounts"][0]["amount_zar"] is None)
check("batch: B-BBEE level kept", k.get("bbbee") == "Level 1")

# 6. register only as an attachment
REFER_HTML = """<table><tr><td>Tenderer's Name</td><td>Amount Tendered</td><td>BBBEE</td><td>Alt Tender</td><td>Notes</td></tr>
<tr><td>REFER TO ATTACHED OPENING REGISTER</td><td>REFER TO ATTACHED OPENING REGISTER</td>
<td>REFER TO ATTACHED OPENING REGISTER</td><td>REFER TO ATTACHED OPENING REGISTER</td></tr></table>"""
r = ao.parse_sanral_result_page(REFER_HTML)
check("attachment-only register: no fake bidders", r["opening_register"] == [], r["opening_register"])
check("attachment-only register: says so", bool(r["opening_register_note"]))

print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED'}")
sys.exit(1 if FAILS else 0)
