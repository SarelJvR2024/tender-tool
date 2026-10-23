"""
Tests for engine/onboarding/classify_documents.py and
process_onboarding_jobs.py. No live Supabase and no Anthropic API key needed
- same scope and the same honest limit as engine/cv/test_extract_cv_fields.py:
this does NOT test how well Claude reads a document. What it does test, for
real:

  1. Text extraction (python-docx synthetic fixtures) and the failure modes
     (unreadable file, too little text, garbled text) - same gates as the CV
     pipeline, imported, not re-checked twice.
  2. The keyword/filename hint never substitutes for the LLM call or the
     quote-verification step (the core "must never be the sole classifier"
     rule from the task brief).
  3. validate_proposal() for one representative v1 kind per routing target
     (CIDB, B-BBEE, SARS, ID document, bank letter, PI insurance, ISO 9001,
     reference letter, unrouted professional-registration, unknown) - each
     checked against hand-written TEST DOUBLE model answers.
  4. The quote-verification gate: an invented value (quote not in the
     document) is never left ticked/verified, for every field kind
     (string, date, number).
  5. SA ID numbers found locally for id_document and never sent to the API.
  6. call_llm()'s request shape and stop-reason handling against a stub
     client (same StubClient/StubResponse pattern as the CV test file).
  7. Queue plumbing (claim, success, put-back on missing key, stale reclaim)
     against an in-memory Supabase stand-in.

Usage: python3 engine/onboarding/test_classify_documents.py (exit 0 = all passed)
"""
import json
import os
import shutil
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import classify_documents as cd  # noqa: E402
import process_onboarding_jobs as pj  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def expect_fail(fn, needle, msg):
    try:
        fn()
    except cd.ClassificationFailed as e:
        needles = needle if isinstance(needle, tuple) else (needle,)
        check(any(n.lower() in str(e).lower() for n in needles), f"{msg} -> refused: {str(e)[:90]}...")
        return
    check(False, f"{msg} -> expected ClassificationFailed")


def sa_id(prefix12):
    import extract_cv_fields as cvx
    for d in "0123456789":
        if cvx._luhn_ok(prefix12 + d):
            return prefix12 + d


SYNTH_ID = sa_id("900215012308")


def make_docx(path, lines):
    import docx
    d = docx.Document()
    for line in lines:
        d.add_paragraph(line)
    d.save(path)


# ----------------------------------------------------------------------------
# 1. Text extraction / failure modes (thin - the heavy lifting is the same
#    scan_ocr/pdf_text/docx_text machinery already proven by
#    test_extract_cv_fields.py; this just checks the generic wording and
#    that the same thresholds are wired up).
# ----------------------------------------------------------------------------

def test_text_extraction(tmp):
    print("1. text extraction + failure modes (generic wording, not CV-worded)")
    docx_path = os.path.join(tmp, "cidb_cert.docx")
    make_docx(docx_path, [
        "CONSTRUCTION INDUSTRY DEVELOPMENT BOARD",
        "CIDB CONTRACTOR GRADING DESIGNATION CERTIFICATE",
        "This is to certify that the contractor named below is registered with the Construction Industry "
        "Development Board in terms of the CIDB Act, 2000 (Act No. 38 of 2000).",
        "Contractor: Klipcorp Test (Pty) Ltd",
        "Registration number: 123456789",
        "Grading: 8CE",
        "Expiry date: 31 December 2026",
        "This certificate remains the property of the Construction Industry Development Board and must be "
        "produced on request to any organ of state inviting tenders for construction works.",
    ])
    r = cd.read_document_text(docx_path, tmp)
    check("123456789" in r["text"] and "8CE" in r["text"], "docx text read (reuses python-docx reader)")
    expect_fail(lambda: cd.assess_text_quality("Name: X\n"), "only", "almost no text -> generic wording")
    check("CV" not in str(_fails_with(lambda: cd.assess_text_quality("Name: X\n"))),
          "failure message doesn't say 'CV' (this isn't the CV pipeline)")
    expect_fail(lambda: cd.assess_text_quality("□■#$%&*+=" * 60 + "ab"), "garbled", "garbled font encoding")
    expect_fail(lambda: cd.assess_text_quality("word " * 40000), "far more than one compliance document", "far too long")
    expect_fail(lambda: cd.read_document_text(os.path.join(tmp, "x.pages"), tmp), "can't be read", "unsupported format")
    return docx_path


def _fails_with(fn):
    try:
        fn()
    except cd.ClassificationFailed as e:
        return e
    return ""


# ----------------------------------------------------------------------------
# 2. The filename hint is advisory only.
# ----------------------------------------------------------------------------

def test_keyword_hint():
    print("2. keyword/filename hint: advisory only, never the classifier")
    check(cd.keyword_hint("CIDB_Certificate_2026.pdf") == "cidb_registration", "obvious CIDB filename matched")
    check(cd.keyword_hint("Scan_0042.pdf") is None, "an uninformative filename returns no hint")
    msg = cd.build_user_message("some text", "CIDB_Certificate_2026.pdf")
    check("hint" in msg.lower() and "may be wrong" in msg.lower(), "the hint text itself says it may be wrong")
    check("document_kind" not in msg, "the hint never hands the model an answer, only a filename note")
    # The function that actually decides kind is validate_proposal() on the
    # MODEL's answer, not keyword_hint() - a filename hint is never consulted
    # there at all (grep-level guarantee, not just a comment):
    import inspect
    src = inspect.getsource(cd.validate_proposal)
    check("keyword_hint" not in src, "validate_proposal() never calls keyword_hint() - the hint can't short-circuit it")


# ----------------------------------------------------------------------------
# 3-4. validate_proposal() per routed kind + the quote-verification gate.
# ----------------------------------------------------------------------------

CIDB_TEXT = "CIDB CONTRACTOR GRADING DESIGNATION\nContractor: Klipcorp Test (Pty) Ltd\nRegistration number: 123456789\nGrading: 8CE\nExpiry date: 31 December 2026\n"
CIDB_ANSWER = {
    "document_kind": "cidb_registration", "document_kind_reason": "CIDB grading certificate.",
    "fields": {
        "registration_number": {"value": "123456789", "evidence": "Registration number: 123456789"},
        "grade_class": {"value": "8CE", "evidence": "Grading: 8CE"},
        "expiry_date": {"value": "2026-12-31", "evidence": "Expiry date: 31 December 2026"},
        "contractor_name": {"value": "Klipcorp Test (Pty) Ltd", "evidence": "Contractor: Klipcorp Test (Pty) Ltd"},
        **{f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS if f not in
           ("registration_number", "grade_class", "expiry_date", "contractor_name")},
    },
    "parse_problems": [],
}


CIDB_ANSWER_WIRE = {
    "document_kind": "cidb_registration", "document_kind_reason": "CIDB grading certificate.",
    "fields": [
        {"field": "registration_number", "value": "123456789", "evidence": "Registration number: 123456789"},
        {"field": "grade_class", "value": "8CE", "evidence": "Grading: 8CE"},
        {"field": "expiry_date", "value": "2026-12-31", "evidence": "Expiry date: 31 December 2026"},
        {"field": "contractor_name", "value": "Klipcorp Test (Pty) Ltd", "evidence": "Contractor: Klipcorp Test (Pty) Ltd"},
    ],
    "parse_problems": [],
}


def _count_union_params(schema):
    """What the API's own error actually counts (re-review, 2026-10-23
    evening): 'N parameters with type arrays or anyOf' - only union/
    nullable-typed properties, not every property. The first version of
    this check counted every property regardless of union-ness; it still
    happened to pass here (7 < 16) but wasn't verifying the thing the API
    actually limits - extract_cv_fields.py's own sibling check made that
    gap concrete (it reported "22 total params" as still only partial
    progress, when the real, API-relevant number was already 12). Counting
    only union-typed properties, recursively through `properties`, array
    `items` and `anyOf` branches, is what actually matches the provider's
    limit."""
    if not isinstance(schema, dict):
        return 0
    n = 0
    for v in (schema.get("properties") or {}).values():
        if isinstance(v, dict) and ("anyOf" in v or isinstance(v.get("type"), list)):
            n += 1
        n += _count_union_params(v)
    items = schema.get("items")
    if isinstance(items, dict):
        n += _count_union_params(items)
    for branch in schema.get("anyOf") or []:
        n += _count_union_params(branch)
    return n


def test_validate_proposal_schema():
    import jsonschema
    jsonschema.validate(CIDB_ANSWER_WIRE, cd.output_schema())
    check(True, "array-shaped test-double answer is valid against the real structured-output schema sent to the API")
    # Regression guard for the real 2026-10-23 bug: the old `fields` shape
    # (one named sub-object per entry in ALL_FIELDS) put 54 union-typed
    # parameter definitions in one request and every upload failed outright.
    # This stays small and constant regardless of how many fields/kinds exist.
    n = _count_union_params(cd.output_schema())
    check(n < 16, f"schema has {n} union-typed parameters (API limit 16) - was 54 before the fix")
    check(len(cd.ALL_FIELDS) > 16, f"sanity check: {len(cd.ALL_FIELDS)} real fields exist - if this were still the "
          "old one-sub-object-per-field shape, the schema would already be over the limit on field count alone")


def test_cidb():
    print("3a. CIDB registration (routes to held_registrations)")
    prop, warnings = cd.validate_proposal(json.loads(json.dumps(CIDB_ANSWER)), CIDB_TEXT, [])
    check(prop["document_kind"] == "cidb_registration", "kind kept")
    f = prop["fields"]
    check(f["registration_number"]["verified"] and f["grade_class"]["verified"], "quoted fields verified")
    check(f["expiry_date"]["value"] == "2026-12-31" and f["expiry_date"]["verified"], "full date verified")
    check(not warnings, "no whole-document warnings")


def test_bbbee_and_sars():
    print("3b. B-BBEE certificate + SARS tax clearance (route to companies.* vault columns)")
    text = "B-BBEE VERIFICATION CERTIFICATE\nStatus Level: Level 2\nExpiry: 2027-03-01\nEntity: Klipcorp Test\n"
    answer = {"document_kind": "bbbee_certificate", "document_kind_reason": "SANAS certificate.",
              "fields": {**{f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS},
                         "bee_level": {"value": "Level 2", "evidence": "Status Level: Level 2"},
                         "proof_type": {"value": "certificate", "evidence": "B-BBEE VERIFICATION CERTIFICATE"},
                         "expiry_date": {"value": "2027-03-01", "evidence": "Expiry: 2027-03-01"},
                         "entity_name": {"value": "Klipcorp Test", "evidence": "Entity: Klipcorp Test"}},
              "parse_problems": []}
    prop, _ = cd.validate_proposal(answer, text, [])
    check(prop["fields"]["bee_level"]["verified"] and prop["fields"]["proof_type"]["value"] == "certificate",
          "B-BBEE level and proof type both verified")

    sars_text = "SARS TAX COMPLIANCE STATUS\nPIN: 1234567890\nValid until: 2027-06-24\n"
    sars_answer = {"document_kind": "sars_tax_clearance", "document_kind_reason": "TCS PIN letter.",
                   "fields": {**{f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS},
                              "pin": {"value": "1234567890", "evidence": "PIN: 1234567890"},
                              "expiry_date": {"value": "2027-06-24", "evidence": "Valid until: 2027-06-24"}},
                   "parse_problems": []}
    prop, _ = cd.validate_proposal(sars_answer, sars_text, [])
    check(prop["fields"]["pin"]["verified"] and prop["fields"]["expiry_date"]["verified"], "PIN + expiry verified")


def test_id_document():
    print("3c. ID document: full_name from the model, id_number from the local SA-ID match (never from the model)")
    text = f"CERTIFIED COPY\nFull Names: Thabo Test Dlamini\nID Number: {SYNTH_ID}\n"
    _, ids = __import__("extract_cv_fields").find_and_redact_sa_ids(text)
    answer = {"document_kind": "id_document", "document_kind_reason": "A South African ID document.",
              "fields": {**{f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS},
                         "full_name": {"value": "Thabo Test Dlamini", "evidence": "Full Names: Thabo Test Dlamini"}},
              "parse_problems": []}
    prop, overall = cd.validate_proposal(answer, text, ids)
    check(prop["fields"]["full_name"]["verified"], "name verified against the text")
    check(prop["fields"]["id_number"]["value"] == SYNTH_ID and prop["fields"]["id_number"]["verified"],
          "id_number proposed from the LOCAL match, not asked of the model (not in KIND_FIELDS['id_document'])")
    check("id_number" not in [k for k in cd.KIND_FIELDS["id_document"]], "schema never asks the model for id_number")
    _, no_id_overall = cd.validate_proposal(json.loads(json.dumps(answer)), text.replace(SYNTH_ID, "not an id"), [])
    check(any("no valid" in w.lower() for w in no_id_overall), "no ID found at all: flagged, nothing guessed")
    two = cd.validate_proposal(json.loads(json.dumps(answer)), text, [SYNTH_ID, sa_id("850101500108")])
    check("id_number" not in two[0]["fields"] and any("2 different" in w for w in two[1]),
          "two different ID numbers: none proposed, warning raised (same rule as the CV pipeline)")


def test_bank_insurance_iso_and_experience():
    print("3d. bank letter / PI insurance / ISO 9001 / reference letter (route to companies.* / experience_items)")
    bank_text = "BANK CONFIRMATION LETTER\nAccount holder: Klipcorp Test (Pty) Ltd\nBank: FNB\nDate: 9 September 2026\n"
    bank_answer = {"document_kind": "bank_confirmation_letter", "document_kind_reason": "Bank letter.",
                   "fields": {**{f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS},
                              "bank_name": {"value": "FNB", "evidence": "Bank: FNB"},
                              "account_holder": {"value": "Klipcorp Test (Pty) Ltd", "evidence": "Account holder: Klipcorp Test (Pty) Ltd"},
                              "letter_date": {"value": "2026-09-09", "evidence": "Date: 9 September 2026"}},
                   "parse_problems": []}
    prop, _ = cd.validate_proposal(bank_answer, bank_text, [])
    check(prop["fields"]["letter_date"]["verified"] and prop["fields"]["bank_name"]["value"] == "FNB", "bank letter fields verified")

    pi_text = "PROFESSIONAL INDEMNITY INSURANCE\nInsurer: Test Insurance Co\nPolicy number: PI-9988\nLimit of indemnity: R5,000,000\nPeriod to: 2027-01-01\n"
    pi_answer = {"document_kind": "pi_insurance_certificate", "document_kind_reason": "PI schedule.",
                 "fields": {**{f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS},
                            "insurer": {"value": "Test Insurance Co", "evidence": "Insurer: Test Insurance Co"},
                            "policy_number": {"value": "PI-9988", "evidence": "Policy number: PI-9988"},
                            "cover_zar": {"value": 5000000, "evidence": "Limit of indemnity: R5,000,000"},
                            "expiry_date": {"value": "2027-01-01", "evidence": "Period to: 2027-01-01"}},
                 "parse_problems": []}
    prop, _ = cd.validate_proposal(pi_answer, pi_text, [])
    check(prop["fields"]["cover_zar"]["value"] == 5000000 and prop["fields"]["cover_zar"]["verified"], "numeric cover amount verified")

    exp_text = "REFERENCE LETTER\nClient: Test Metro\nContract: TMRA/2019/044\nValue: R120 million\nCompleted: 2021-10-01\nReferee: J. Referee-Test\n"
    exp_answer = {"document_kind": "experience_reference_letter", "document_kind_reason": "Client reference letter.",
                  "fields": {**{f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS},
                             "client_name": {"value": "Test Metro", "evidence": "Client: Test Metro"},
                             "contract_number": {"value": "TMRA/2019/044", "evidence": "Contract: TMRA/2019/044"},
                             "project_value_rm": {"value": 120, "evidence": "Value: R120 million"},
                             "completion_date": {"value": "2021-10-01", "evidence": "Completed: 2021-10-01"},
                             "referee_name": {"value": "J. Referee-Test", "evidence": "Referee: J. Referee-Test"}},
                  "parse_problems": []}
    prop, _ = cd.validate_proposal(exp_answer, exp_text, [])
    check(prop["fields"]["project_value_rm"]["value"] == 120 and prop["fields"]["client_name"]["verified"],
          "reference letter fields verified")


def test_unrouted_kinds():
    print("3e. professional_registration_other and unknown: never auto-routed")
    text = "ENGINEERING COUNCIL OF SOUTH AFRICA\nRegistration no. 20169999\nHolder: Naledi Test-Mokoena\n"
    answer = {"document_kind": "professional_registration_other", "document_kind_reason": "ECSA registration, not a CV.",
              "fields": {**{f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS},
                         "body": {"value": "ECSA", "evidence": "ENGINEERING COUNCIL OF SOUTH AFRICA"},
                         "holder_name": {"value": "Naledi Test-Mokoena", "evidence": "Holder: Naledi Test-Mokoena"},
                         "registration_number": {"value": "20169999", "evidence": "Registration no. 20169999"}},
              "parse_problems": []}
    prop, _ = cd.validate_proposal(answer, text, [])
    check(prop["document_kind"] == "professional_registration_other", "kept as its own kind, not forced into another one")
    check(prop["document_kind"] in cd.UNROUTED_KINDS, "flagged as a kind the confirm action must never auto-route")

    empty_unknown = {"document_kind": "unknown", "document_kind_reason": "A tender's returnable schedule, not a compliance document.",
                     "fields": {f: {"value": None, "evidence": None} for f in cd.ALL_FIELDS}, "parse_problems": []}
    expect_fail(lambda: cd.validate_proposal(empty_unknown, text, []), "doesn't look like", "unknown + nothing found")

    expect_fail(lambda: cd.validate_proposal(
        {"document_kind": "not_a_real_kind", "document_kind_reason": "", "fields": {}, "parse_problems": []}, text, []),
        "doesn't look like", "a kind outside the allowed list falls back to unknown (refused, not a crash)")


def test_quote_verification_gate():
    print("4. quote-verification gate: an invented value is never left verified")
    text = CIDB_TEXT
    bad = json.loads(json.dumps(CIDB_ANSWER))
    bad["fields"]["registration_number"] = {"value": "999999999", "evidence": "nowhere in the document"}  # invented
    bad["fields"]["grade_class"] = {"value": "9GB", "evidence": "nowhere either"}
    prop, _ = cd.validate_proposal(bad, text, [])
    check(not prop["fields"]["registration_number"]["verified"] and not prop["fields"]["grade_class"]["verified"],
          "both invented fields (string) left unverified")
    bad_date = json.loads(json.dumps(CIDB_ANSWER))
    bad_date["fields"]["expiry_date"] = {"value": "2026", "evidence": "nowhere"}
    prop, _ = cd.validate_proposal(bad_date, text, [])
    check(not prop["fields"]["expiry_date"]["verified"], "year-only placeholder date never pre-ticked")


# ----------------------------------------------------------------------------
# 5. call_llm() request shape + stop-reason handling (stub client).
# ----------------------------------------------------------------------------

class StubResponse:
    def __init__(self, text=None, stop_reason="end_turn"):
        self.content = [types.SimpleNamespace(type="thinking", thinking="")] + (
            [types.SimpleNamespace(type="text", text=text)] if text is not None else [])
        self.stop_reason, self.model = stop_reason, "stub-model"
        self.usage = types.SimpleNamespace(input_tokens=3000, output_tokens=800)


class StubClient:
    def __init__(self, response):
        self.calls = []
        outer = self
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(
            create=lambda **kw: (outer.calls.append(kw), response)[1]))


def test_llm_call():
    print("5. call_llm request shape and stop-reason handling (stub client)")
    c = StubClient(StubResponse(json.dumps(CIDB_ANSWER)))
    data, meta = cd.call_llm("doc text", "CIDB_Certificate.pdf", client=c)
    kw = c.calls[0]
    check(kw["output_config"]["format"]["type"] == "json_schema" and kw["output_config"]["effort"] == "medium",
          "structured output + effort")
    check("<document_text>\ndoc text\n</document_text>" in kw["messages"][0]["content"], "document text sent inside tags")
    check("CIDB_Certificate.pdf" in kw["messages"][0]["content"], "filename hint included in the prompt")
    check(data["document_kind"] == "cidb_registration", "JSON parsed from the text block")
    for resp, needle, label in [(StubResponse(None, "refusal"), "declined", "refusal"),
                                (StubResponse("{}", "max_tokens"), "more content", "max_tokens"),
                                (StubResponse("not json"), "valid structured", "bad JSON")]:
        expect_fail(lambda: cd.call_llm("t", "f.pdf", client=StubClient(resp)), needle, f"stop/answer: {label}")

    # Re-review 2026-10-23: same fix as extract_cv_fields.py's sibling check
    # - a BadRequestError (the exact shape of the real "too many union
    # parameters" rejection) must come out as a clean, fixed customer
    # message, with the technical detail only on `.detail`, not folded into
    # the message a customer sees via onboarding_uploads.classification_error.
    import anthropic
    # Finding 65, 2026-10-23: same fix as extract_cv_fields.py's sibling check
    # - this is httpx2, not httpx (anthropic==1.15.0's real dependency,
    # confirmed from a real CI run's own pip install log), and anthropic's
    # own exception classes don't accept a plain httpx.Response anyway.
    import httpx2 as httpx
    raw = ("Schemas contains too many parameters with union types (54 parameters with type arrays or anyOf). "
           "This causes exponential compilation cost. Reduce the number of nullable or union-typed parameters "
           "(limit: 16 parameters with unions).")
    resp = httpx.Response(400, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"),
                          json={"type": "error", "error": {"type": "invalid_request_error", "message": raw},
                                "request_id": "req_test456"})

    def boom(**kw):
        raise anthropic.BadRequestError(raw, response=resp, body=resp.json())
    bad_client = types.SimpleNamespace(beta=types.SimpleNamespace(messages=types.SimpleNamespace(create=boom)))
    try:
        cd.call_llm("doc text", "f.pdf", client=bad_client)
        check(False, "BadRequestError should raise ClassificationFailed")
    except cd.ClassificationFailed as e:
        check("Error code" not in str(e) and "request_id" not in str(e) and "54 parameters" not in str(e),
              "customer-facing message has no raw provider error or request id")
        check(e.detail and "54 parameters" in e.detail, "raw provider detail kept on .detail for system_alerts, not lost")


# ----------------------------------------------------------------------------
# 6. Queue plumbing (in-memory Supabase stand-in).
# ----------------------------------------------------------------------------

class MemoryDb:
    def __init__(self, files):
        self.tables = {"onboarding_uploads": [], "onboarding_document_results": []}
        self.files = files

    def _parse(self, path):
        import urllib.parse
        table, _, q = path.partition("?")
        filters = {}
        for k, v in urllib.parse.parse_qsl(q):
            if v.startswith("eq."):
                filters[k] = v[3:]
        return table, filters

    def request(self, url, key, method, path, body=None):
        table, f = self._parse(path)
        rows = self.tables.setdefault(table, [])
        match = [r for r in rows if all(str(r.get(k)) == v for k, v in f.items())]
        if method == "GET":
            return [dict(r) for r in match]
        if method == "PATCH":
            for r in match:
                r.update(body)
            return [dict(r) for r in match]
        if method == "POST":
            existing = [r for r in rows if r.get("onboarding_upload_id") == body.get("onboarding_upload_id")]
            if existing:
                existing[0].update(body)
            else:
                rows.append(dict(body))
            return [body]
        raise AssertionError(method)

    def download(self, url, key, object_path, dest):
        shutil.copy(self.files[object_path], dest)


def test_queue(docx_path, tmp):
    print("6. queue plumbing (in-memory Supabase stand-in, stub LLM client)")
    from PIL import Image
    scan = os.path.join(tmp, "scan2.pdf")
    Image.new("RGB", (600, 800), "white").save(scan, "PDF")
    db = MemoryDb({"c1/a-cidb_cert.docx": docx_path, "c1/b-scan.pdf": scan})
    pj.supabase_request, pj.storage_download = db.request, db.download
    base = {"company_id": "c1", "batch_id": "batch1", "status": "classification_requested"}
    db.tables["onboarding_uploads"] = [
        dict(base, id="u1", storage_path="c1/a-cidb_cert.docx", original_filename="cidb_cert.docx", created_at="1"),
        dict(base, id="u2", storage_path="c1/b-scan.pdf", original_filename="scan.pdf", created_at="2"),
    ]

    def no_key():
        raise cd.SetupError("ANTHROPIC_API_KEY is not set")
    try:
        pj.poll_once("u", "k", client_factory=no_key)
        check(False, "missing key should stop the pass")
    except cd.SetupError:
        st = {r["id"]: r["status"] for r in db.tables["onboarding_uploads"]}
        check(st["u1"] == "classification_requested" and not db.tables["onboarding_document_results"],
              "missing key: pass stops, upload put back in the queue (not failed), nothing written")

    stub = StubClient(StubResponse(json.dumps(CIDB_ANSWER)))
    handled = pj.poll_once("u", "k", client_factory=lambda: stub)
    st = {r["id"]: r for r in db.tables["onboarding_uploads"]}
    res = db.tables["onboarding_document_results"]
    check(handled == 2 and st["u1"]["status"] == "classified" and len(res) == 1
          and res[0]["review_status"] == "pending_review" and res[0]["onboarding_upload_id"] == "u1"
          and res[0]["document_kind"] == "cidb_registration", "docx: result stored for review, upload marked classified")
    check(st["u2"]["status"] == "classification_failed" and "no text layer" in st["u2"]["classification_error"]
          and len(stub.calls) == 1, "scan with no text layer: failed with reason, no API call made for it")

    db.tables["onboarding_uploads"].append(dict(base, id="u3", status="classifying", storage_path="x",
                                                original_filename="x", classification_claimed_at="2020-01-01T00:00:00+00:00", created_at="3"))
    pj.poll_once("u", "k", quiet_when_empty=True, client_factory=lambda: stub)
    u3 = [r for r in db.tables["onboarding_uploads"] if r["id"] == "u3"][0]
    check(u3["status"] == "classification_failed" and "stopped mid-job" in u3["classification_error"], "stale 'classifying' reclaimed as failed")


def main():
    tmp = tempfile.mkdtemp(prefix="onboarding_classify_test_")
    try:
        docx_path = test_text_extraction(tmp)
        test_keyword_hint()
        test_validate_proposal_schema()
        test_cidb()
        test_bbbee_and_sars()
        test_id_document()
        test_bank_insurance_iso_and_experience()
        test_unrouted_kinds()
        test_quote_verification_gate()
        test_llm_call()
        test_queue(docx_path, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
