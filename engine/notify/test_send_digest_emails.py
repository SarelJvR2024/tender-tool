"""
Regression test for send_digest_emails.py - the final email-delivery step of
the daily digest (daily_digest.py only ASSEMBLES a report; this module is the
only thing that actually sends it, over Resend). No dedicated test file
existed anywhere in this repo for it before this pass (confirmed by grep) -
the piece that puts a real message in front of a real customer had zero
coverage.

No network: urlopen is monkeypatched for every case that would otherwise POST
to Resend. No Supabase, no fixtures beyond plain dicts (digest_json's own
shape, as daily_digest.build_digest_for_person()/main() produce it).

Run: python3 engine/notify/test_send_digest_emails.py
"""
import io
import json
import os
import sys
import tempfile
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "alerts"))
import send_digest_emails as sde  # noqa: E402
import system_alerts  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _digest(email="jane@example.test", name="Jane Doe", company="Test Co", **sections):
    d = {"person": {"name": name, "email": email, "tender_role": "full_cycle"},
         "company_name": company, "generated_at": "2026-10-27T00:00:00Z"}
    d.update(sections)
    return d


# --- section_count() / has_content(): list vs viewer-role summary dict -----

def test_section_count_and_has_content():
    print("section_count()/has_content(): list sections, viewer-role summary dicts, and empties")
    check("a list section counts its own length", sde.section_count([1, 2, 3]) == 3)
    check("an empty list counts 0", sde.section_count([]) == 0)
    check("a viewer-role summary dict counts its own 'count'", sde.section_count({"count": 4}) == 4)
    check("a summary dict with count=0 counts 0, not falsy-skipped some other way", sde.section_count({"count": 0}) == 0)
    check("a summary dict with no 'count' key at all counts 0, not a crash", sde.section_count({}) == 0)
    check("None counts 0", sde.section_count(None) == 0)

    empty = _digest(new_tenders=[], document_expiry=[], submission_due={"count": 0})
    check("a digest with every section empty has no content", not sde.has_content(empty))
    some = _digest(new_tenders=[], submission_due={"count": 2, "nearest_closing_date": "2026-11-01"})
    check("a digest with one non-empty viewer-summary section has content", sde.has_content(some))


# --- _item_date(): first present date-shaped key wins -----------------------

def test_item_date_picks_first_present_key():
    print("_item_date(): the first of closing_date/expiry_date/due_date/updated_at present")
    check("closing_date is read and sliced to its date prefix",
          sde._item_date({"closing_date": "2026-11-05T10:00:00+02:00"}) == "2026-11-05")
    check("expiry_date works when closing_date is absent", sde._item_date({"expiry_date": "2026-12-01"}) == "2026-12-01")
    check("an item with none of the known keys returns None, not a wrong guess", sde._item_date({"field": "x"}) is None)
    check("an explicitly empty closing_date falls through to the next key, not a blank result",
          sde._item_date({"closing_date": "", "due_date": "2026-10-30"}) == "2026-10-30")


# --- render_text(): real content reaches the body, 10-item cap -------------

def test_render_text_includes_real_content_and_caps_at_ten():
    print("render_text(): section items actually appear in the body, long lists are capped")
    items = [{"title": f"Tender {i}", "closing_date": "2026-11-01"} for i in range(13)]
    body = sde.render_text(_digest(new_tenders=items))
    check("the section label and count appear", "New matching tenders: 13" in body)
    check("the first item's own title is in the body, not a generic placeholder", "Tender 0" in body)
    check("only 10 items are listed individually", sum(1 for ln in body.splitlines() if ln.strip().startswith("- Tender")) == 10)
    check("the remainder is named, not silently dropped", "... and 3 more" in body)
    check("the dashboard link and opt-out line are present",
          "/dashboard" in body and "opted in to the daily digest" in body)

    viewer_digest = _digest(submission_due={"count": 2, "nearest_closing_date": "2026-11-01"})
    vbody = sde.render_text(viewer_digest)
    check("a viewer-role summary dict renders its count with no per-item detail (no crash on a non-list section)",
          "Closing soon: 2" in vbody)


def test_render_text_uses_document_expiry_label_not_raw_field():
    print("render_text(): document_expiry shows the human label, not the raw internal field/slug")
    # Real bug found 2026-10-29: every document_expiry item (watch_deadlines.py's
    # company documents, person credentials, and registration_reminders.py's
    # catalog registrations/property documents) carries both "field" (a raw
    # column name or "held_registrations:<slug>") and "label" (the human text) -
    # but neither ever sets "title"/"description", so the old fallback chain
    # picked "field" and every sent digest showed e.g.
    # "coid_letter_of_good_standing_expiry" instead of "COID Letter of Good
    # Standing".
    items = [{"type": "document", "field": "coid_letter_of_good_standing_expiry",
              "label": "COID Letter of Good Standing", "expiry_date": "2026-11-10"}]
    body = sde.render_text(_digest(document_expiry=items))
    check("the human label appears", "COID Letter of Good Standing" in body)
    check("the raw field name does not leak into the body",
          "coid_letter_of_good_standing_expiry" not in body)

    # A registration_reminders.py item has an even less readable "field"
    # ("held_registrations:<slug>") - same fix must cover it too.
    reg_items = [{"type": "person_credential", "field": "held_registrations:psira_grading",
                  "label": "PSIRA Grading Certificate", "expiry_date": "2026-11-20"}]
    reg_body = sde.render_text(_digest(document_expiry=reg_items))
    check("a registration-catalog item's label appears too", "PSIRA Grading Certificate" in reg_body)
    check("its raw field:slug does not leak into the body",
          "held_registrations:psira_grading" not in reg_body)

    # readiness_changes has no "label" key at all (confirmed by grep) - must
    # keep falling back to "field_key" exactly as before, unaffected by this fix.
    rc_items = [{"field_key": "bee_proof", "status": "confirmed"}]
    rc_body = sde.render_text(_digest(readiness_changes=rc_items))
    check("a section with no 'label' key still falls back to field_key, unaffected",
          "bee_proof" in rc_body)


def test_render_text_names_the_person_on_a_person_credential_item():
    print("render_text(): a person_credential item names WHICH person, not just the credential type")
    # Real bug found 2026-10-29: find_due_person_credentials() and
    # registration_reminders.find_due_registrations() both set "label" to a
    # generic credential type ("ECSA professional registration", "PSIRA
    # Grading Certificate") - the same text for every person who holds one -
    # and a separate "person_name" that render_text() never read. With two
    # key people each renewing the same credential type, the digest listed
    # two identical, unattributed lines; the reader had no way to tell who
    # to chase without opening the app. watch_deadlines.py's own console
    # summary (main()) already prints the holder's name next to the label -
    # the email was the one surface that dropped it.
    items = [{"type": "person_credential", "label": "ECSA professional registration",
              "person_name": "Pat Engineer", "expiry_date": "2026-11-10"}]
    body = sde.render_text(_digest(document_expiry=items))
    check("the person's name appears next to the credential label",
          "Pat Engineer - ECSA professional registration" in body)

    # A company-held document (property document, or a held_registrations
    # row with no person/principal holder) has no "person_name" key at all -
    # must render exactly as before, with no stray "None -" prefix.
    doc_items = [{"type": "document", "label": "COID Letter of Good Standing", "expiry_date": "2026-11-10"}]
    doc_body = sde.render_text(_digest(document_expiry=doc_items))
    check("a company document with no person_name is unaffected", "  - COID Letter of Good Standing" in doc_body)
    check("no stray 'None -' prefix leaks in for an item with no person_name", "None -" not in doc_body)

    # Two different people with the same credential label must now read as
    # two distinguishable lines, not two copies of the same text.
    two_people = [
        {"type": "person_credential", "label": "ECSA professional registration",
         "person_name": "Pat Engineer", "expiry_date": "2026-11-10"},
        {"type": "person_credential", "label": "ECSA professional registration",
         "person_name": "Sipho Director", "expiry_date": "2026-11-12"},
    ]
    two_body = sde.render_text(_digest(document_expiry=two_people))
    check("both named lines are present and distinct",
          "Pat Engineer - ECSA professional registration" in two_body
          and "Sipho Director - ECSA professional registration" in two_body)


def test_render_text_shows_what_actually_changed_on_a_listing_change():
    print("render_text(): a listing_changes line shows WHAT changed, not just the tender's own title")
    # Real bug found 2026-11-01: listing_change_signals() items (tender_
    # changes.py) carry both "title" (the tender's own title - already
    # shown in every other section of the same email) and "summary" (the
    # actual change: "Closing date extended: ... -> ...", "Cancelled by the
    # buyer ...") - but the bit-selection chain checked "title" first,
    # unconditionally, so a cancellation, a closing-date move and a new
    # addendum all rendered as the exact same line, with the one fact this
    # section exists to report never reaching the sent email at all.
    items = [
        {"contract_number": "R.396-010-2025/1F", "title": "Conventional consulting engineering services R.396",
         "change_type": "cancelled", "summary": "Cancelled by the buyer (R.396-010-2025/1F, 2026-10-30)"},
        {"contract_number": "RFQ/2026/55", "title": "Supply and delivery of office furniture",
         "change_type": "closing_date_changed", "summary": "Closing date extended: 2026-10-20 -> 2026-11-05"},
    ]
    body = sde.render_text(_digest(listing_changes=items))
    check("the cancellation line names the real tender AND the actual change",
          "Conventional consulting engineering services R.396: Cancelled by the buyer" in body)
    check("the closing-date-move line is distinguishable from the cancellation line (not identical generic text)",
          "Supply and delivery of office furniture: Closing date extended: 2026-10-20 -> 2026-11-05" in body)

    # tender_updates items also happen to carry a "summary" key (a different
    # meaning - doc.get("summary"), the watched document's own summary) but
    # never "change_type" - must be completely unaffected by this fix.
    update_items = [{"type": "tender_update", "title": "Addendum 3.pdf", "summary": "unrelated document summary text"}]
    update_body = sde.render_text(_digest(tender_updates=update_items))
    check("a tender_updates item with its own unrelated 'summary' key is unaffected (no change_type -> no append)",
          "  - Addendum 3.pdf" in update_body and "unrelated document summary text" not in update_body)


def test_render_text_shows_why_a_tender_was_reassessed():
    print("render_text(): a reassessed_tenders line shows WHY it's no longer a good fit, not just the title")
    # Finding 122 (2026-11-03): discovery_downgrades.pending_digest_downgrades()
    # items carry the exact same "title" + "summary" shape as listing_changes
    # (the summary names what actually changed: "No longer a good fit: was
    # strong_fit, now possible...") - but they never set "change_type" (that
    # key is unique to tender_changes.py's own items), so Finding 113's own
    # fix, scoped only to "change_type", silently never applied here: every
    # reassessed-tender line showed just the generic tender title, with the
    # one fact this whole section exists to report never reaching the email.
    items = [
        {"contract_number": "R.343-020-2025/1F", "title": "Routine maintenance of provincial roads",
         "was_verdict": "strong_fit", "now_verdict": "possible",
         "summary": "No longer a good fit: was Strong fit, now Possible - your company profile changed since it was first scored"},
    ]
    body = sde.render_text(_digest(reassessed_tenders=items))
    check("the reassessed-tender line names the real tender AND the actual reason it changed",
          "Routine maintenance of provincial roads: No longer a good fit: was Strong fit, now Possible" in body)

    # The sibling tender_updates case above must stay unaffected by widening
    # the condition to cover "was_verdict" too.
    update_items = [{"type": "tender_update", "title": "Addendum 3.pdf", "summary": "unrelated document summary text"}]
    update_body = sde.render_text(_digest(tender_updates=update_items))
    check("a tender_updates item is still unaffected after this widening (no change_type, no was_verdict)",
          "  - Addendum 3.pdf" in update_body and "unrelated document summary text" not in update_body)


def test_render_text_shows_which_tender_a_document_will_have_lapsed_before():
    print("render_text(): a document_before_closing line names WHICH tender it will have lapsed before, and when it closes")
    # Finding 132 (2026-11-05): watch_deadlines.find_documents_lapsing_before_closing()
    # items carry "status": "lapses_before_closing" plus "tender_label"/"closing_date" -
    # the one fact that makes this line different from an ordinary renew-soon/expired
    # document_expiry line (same label/expiry_date shape as every other one). Before
    # this fix it fell through to the exact same generic rendering, so a sent digest
    # never actually said WHICH tender was at risk or when it closes - just a document
    # label and an expiry date that, on its own, still looks comfortably far away.
    items = [{"type": "document_before_closing", "label": "SARS Tax Compliance Status PIN",
              "expiry_date": "2027-01-15", "status": "lapses_before_closing",
              "tender_label": "R.396-010-2025/1F", "closing_date": "2027-01-05"}]
    body = sde.render_text(_digest(document_expiry=items))
    check("the line names the specific tender it will have lapsed before",
          "R.396-010-2025/1F" in body)
    check("the line says the document will have lapsed, not just shows a bare label+expiry",
          "will have lapsed before R.396-010-2025/1F closes" in body)
    check("the tender's own closing date appears too", "2027-01-05" in body)

    # An ordinary renew-soon/expired document_expiry item (no "lapses_before_closing"
    # status) must render exactly as before - this only changes the new status's own line.
    ordinary = [{"type": "document", "label": "COID Letter of Good Standing",
                "expiry_date": "2026-11-10", "status": "renew_soon"}]
    ordinary_body = sde.render_text(_digest(document_expiry=ordinary))
    check("an ordinary renew_soon item is unaffected", "  - COID Letter of Good Standing" in ordinary_body)
    check("no 'will have lapsed before' text leaks into an unrelated item",
          "will have lapsed before" not in ordinary_body)


def test_render_text_does_not_duplicate_the_closing_date_or_drop_the_real_expiry_date():
    print("render_text(): a lapses_before_closing item shows its OWN expiry date once, "
          "not the tender's closing date twice (Finding 140)")
    # Finding 140 (2026-11-06): a lapses_before_closing item carries BOTH
    # "expiry_date" (the document/credential's own real lapse date) AND
    # "closing_date" (the tender's) - the one document_expiry shape where
    # both coexist. _item_date()'s own priority order checks "closing_date"
    # before "expiry_date" (correct for every OTHER section, which never set
    # both on the same item), so the trailing "(date)" this function used to
    # always append silently resolved to closing_date again here, duplicating
    # the exact date already named by the sentence above it, while the
    # document's own real expiry date never reached the sent email at all.
    items = [{"type": "document_before_closing", "label": "SARS Tax Compliance Status PIN",
              "expiry_date": "2027-01-15", "status": "lapses_before_closing",
              "tender_label": "R.396-010-2025/1F", "closing_date": "2027-01-05"}]
    body = sde.render_text(_digest(document_expiry=items))
    check("the closing date is not duplicated as a trailing '(date) (date)'",
          "(2027-01-05) (2027-01-05)" not in body, body)
    check("the document's own real expiry date now actually appears in the sent email",
          "2027-01-15" in body, body)

    # Finding 139 (2026-11-06)'s own new item shape - a person_credential_before_closing
    # item - carries "expiry_date"/"closing_date" AND "person_name" all at once. Must get
    # the identical fix (the "person_name - " prefix happens earlier in the chain, before
    # this branch, so it isn't itself at risk - checked directly here anyway).
    person_items = [{"type": "person_credential_before_closing", "label": "ECSA professional registration",
                      "person_name": "Assigned Engineer", "expiry_date": "2027-02-04",
                      "status": "lapses_before_closing", "tender_label": "Z.001-2026",
                      "closing_date": "2027-02-14"}]
    person_body = sde.render_text(_digest(document_expiry=person_items))
    check("the person's own name still prefixes the line",
          "Assigned Engineer - ECSA professional registration" in person_body, person_body)
    check("no duplicated closing date for the person-credential shape either",
          "(2027-02-14) (2027-02-14)" not in person_body, person_body)
    check("the credential's own real expiry date actually appears",
          "2027-02-04" in person_body, person_body)
    check("the tender's own closing date still appears exactly once",
          person_body.count("2027-02-14") == 1, person_body)


# --- send_one(): every status path, no real network -------------------------

def test_send_one_skips_cleanly_without_email_or_content():
    print("send_one(): no email on file, and nothing to report, both skip without ever POSTing")
    status, detail = sde.send_one("key", "from@x.test", _digest(email=None))
    check("no email -> skipped_no_email", status == "skipped_no_email", detail)
    status, detail = sde.send_one("key", "from@x.test", _digest(email="not-an-email"))
    check("an email with no '@' at all -> skipped_no_email, not sent to a broken address",
          status == "skipped_no_email", detail)
    status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[]))
    check("nothing to report -> skipped_empty", status == "skipped_empty", detail)


def test_send_one_dry_run_never_touches_the_network():
    print("send_one(): --dry-run never calls urlopen, even with content and a real-looking email")
    real_urlopen = sde.urllib.request.urlopen
    called = []
    sde.urllib.request.urlopen = lambda *a, **k: called.append(1) or (_ for _ in ()).throw(RuntimeError("must not be called"))
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]), dry_run=True)
        check("dry_run status, no network call made", status == "dry_run" and not called, detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


class _FakeResp:
    def __init__(self, body=b"{}"):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_send_one_reports_sent_on_a_real_looking_success():
    print("send_one(): a successful Resend POST reports 'sent'")
    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = lambda req, timeout=20: _FakeResp()
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("status is 'sent', detail names the recipient", status == "sent" and detail == "jane@example.test", detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


def test_send_one_retries_once_on_429_then_succeeds():
    print("send_one(): a single 429 is retried once (no real sleep) and a second success is reported as 'sent'")
    calls = []

    def flaky(req, timeout=20):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(sde.RESEND_ENDPOINT, 429, "Too Many Requests",
                                         {"Retry-After": "0"}, io.BytesIO(b"rate limited"))
        return _FakeResp()

    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = flaky
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("exactly 2 attempts were made (1 original + 1 retry)", len(calls) == 2, len(calls))
        check("the retry's own success is reported as 'sent', not a failure", status == "sent", detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


def test_send_one_does_not_retry_a_second_429():
    print("send_one(): a SECOND consecutive 429 is reported as 'failed', not retried again (bounded retry)")
    calls = []

    def always_429(req, timeout=20):
        calls.append(1)
        raise urllib.error.HTTPError(sde.RESEND_ENDPOINT, 429, "Too Many Requests",
                                     {"Retry-After": "0"}, io.BytesIO(b"rate limited"))

    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = always_429
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("exactly 2 attempts were made, no unbounded retry loop", len(calls) == 2, len(calls))
        check("status is 'failed' after the bounded retry is exhausted", status == "failed", detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


def test_send_one_handles_a_retry_after_http_date_not_just_seconds():
    print("send_one(): Retry-After as an HTTP-date (not a bare integer) doesn't crash the retry wait")
    calls = []

    def flaky_http_date(req, timeout=20):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(sde.RESEND_ENDPOINT, 429, "Too Many Requests",
                                         {"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}, io.BytesIO(b"rate limited"))
        return _FakeResp()

    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = flaky_http_date
    try:
        status, _ = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("an HTTP-date Retry-After doesn't crash float() and the retry still succeeds",
              status == "sent" and len(calls) == 2, (status, len(calls)))
    finally:
        sde.urllib.request.urlopen = real_urlopen


def test_send_one_reports_failed_on_a_permanent_http_error():
    print("send_one(): a permanent (non-429) HTTP error is reported as 'failed' with the real detail, no retry")
    calls = []

    def permanent_400(req, timeout=20):
        calls.append(1)
        raise urllib.error.HTTPError(sde.RESEND_ENDPOINT, 400, "Bad Request", {}, io.BytesIO(b'{"message":"invalid from"}'))

    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = permanent_400
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("no retry on a non-429 error", len(calls) == 1, len(calls))
        check("status is 'failed' and the real Resend error body is in the detail",
              status == "failed" and "invalid from" in detail, detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


# --- main(): one malformed digest entry never aborts the rest of the batch -

def test_main_isolates_a_malformed_digest_entry():
    print("main(): a corrupted digest entry (no 'person' key at all) must not abort every digest after it")
    good_before = _digest(new_tenders=[{"title": "x"}])
    bad = {"company_name": "Broken Co"}  # no "person" key at all - a partial/corrupted --out write
    good_after = _digest(email="later@example.test", new_tenders=[{"title": "y"}])

    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "digest.json")
        json.dump([good_before, bad, good_after], open(path, "w"))

        alerts = []
        system_alerts.set_sink(alerts.append)
        real_argv = sys.argv
        sys.argv = ["send_digest_emails.py", path, "--dry-run"]
        try:
            sde.main()
        except SystemExit:
            pass
        except Exception as e:
            check("main() does not itself crash on the malformed entry", False, f"{type(e).__name__}: {e}")
        else:
            check("main() does not itself crash on the malformed entry", True)
        finally:
            sys.argv = real_argv
            system_alerts.set_sink(None)


# --- mark_delivered_items(): the Finding 2026-11-06 fix - a re-assessed-
# tender downgrade / tender update is only marked digested once THIS run
# actually confirms the email carrying it was sent, never at build time. ---

class _FakeRestClient:
    pass


def test_mark_delivered_items_marks_nothing_for_a_run_with_no_sent_digests():
    print("mark_delivered_items(): no 'sent' digests at all -> no Supabase call attempted, no crash")
    real_from_env = sde.company_profiles.RestClient.from_env
    calls = []
    sde.company_profiles.RestClient.from_env = staticmethod(lambda: calls.append(1) or _FakeRestClient())
    try:
        sde.mark_delivered_items([])
        check("from_env() is never even called when there's nothing to mark", calls == [], calls)
    finally:
        sde.company_profiles.RestClient.from_env = real_from_env


def test_mark_delivered_items_only_marks_ids_from_confirmed_sent_digests():
    print("mark_delivered_items(): marks exactly the ids carried by the digests it's given (the caller's job "
          "in main() is to only pass digests with status=='sent' - this checks the marking itself is correct "
          "and doesn't, say, re-read or guess from anywhere else)")
    sent_only = _digest(_delivered_downgrades=["OPP-1", "OPP-2"],
                        _delivered_tender_updates=[{"company_id": "C1", "watched_document_id": "W1"}])

    real_from_env = sde.company_profiles.RestClient.from_env
    real_dd_mark = sde.discovery_downgrades.mark_digested
    real_wtu_mark = sde.watch_tender_updates.mark_digested
    dd_calls, wtu_calls = [], []
    sde.company_profiles.RestClient.from_env = staticmethod(lambda: _FakeRestClient())
    sde.discovery_downgrades.mark_digested = lambda client, items: dd_calls.append(items)
    sde.watch_tender_updates.mark_digested = lambda client, items: wtu_calls.append(items)
    try:
        sde.mark_delivered_items([sent_only])
        check("exactly 1 call to discovery_downgrades.mark_digested", len(dd_calls) == 1, dd_calls)
        check("both downgrade ids from the sent digest are in it, nothing extra",
              {i["opportunity_id"] for i in dd_calls[0]} == {"OPP-1", "OPP-2"}, dd_calls)
        check("exactly 1 call to watch_tender_updates.mark_digested", len(wtu_calls) == 1, wtu_calls)
        check("the tender-update key from the sent digest is in it",
              wtu_calls[0] == [{"company_id": "C1", "watched_document_id": "W1"}], wtu_calls)
    finally:
        sde.company_profiles.RestClient.from_env = real_from_env
        sde.discovery_downgrades.mark_digested = real_dd_mark
        sde.watch_tender_updates.mark_digested = real_wtu_mark


def test_mark_delivered_items_degrades_safely_with_no_supabase_credentials():
    print("mark_delivered_items(): no NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY available this step "
          "-> never crashes, never marks anything, warns once via system_alerts (safe direction: carried again "
          "tomorrow, not silently lost)")
    sent_only = _digest(_delivered_downgrades=["OPP-1"], _delivered_tender_updates=[])
    real_from_env = sde.company_profiles.RestClient.from_env
    real_dd_mark = sde.discovery_downgrades.mark_digested
    sde.company_profiles.RestClient.from_env = staticmethod(lambda: None)
    dd_calls = []
    sde.discovery_downgrades.mark_digested = lambda client, items: dd_calls.append(items)
    alerts = []
    system_alerts.set_sink(alerts.append)
    try:
        sde.mark_delivered_items([sent_only])
        check("mark_digested is never reached without real credentials", dd_calls == [], dd_calls)
        check("a warning alert explains why, for a human to act on", any(
            a.get("p_severity") == "warning" and "credentials" in a.get("p_message", "") for a in alerts), alerts)
    finally:
        sde.company_profiles.RestClient.from_env = real_from_env
        sde.discovery_downgrades.mark_digested = real_dd_mark
        system_alerts.set_sink(None)


def test_main_only_marks_the_digest_that_actually_sent_not_a_skipped_one():
    print("main(): end to end - a digest with no e-mail on file (skipped_no_email) must NOT have its own "
          "re-assessed-tender/tender-update ids marked digested, only the one that actually sent")
    sent_entry = _digest(email="jane@example.test", new_tenders=[{"title": "x"}],
                         _delivered_downgrades=["OPP-SENT"])
    skipped_entry = _digest(email=None, new_tenders=[{"title": "y"}],
                            _delivered_downgrades=["OPP-SKIPPED"])

    real_urlopen = sde.urllib.request.urlopen
    real_from_env = sde.company_profiles.RestClient.from_env
    real_dd_mark = sde.discovery_downgrades.mark_digested
    sde.urllib.request.urlopen = lambda req, timeout=20: _FakeResp()
    sde.company_profiles.RestClient.from_env = staticmethod(lambda: _FakeRestClient())
    dd_calls = []
    sde.discovery_downgrades.mark_digested = lambda client, items: dd_calls.append(items)

    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "digest.json")
        json.dump([sent_entry, skipped_entry], open(path, "w"))
        real_argv, real_environ = sys.argv, dict(os.environ)
        sys.argv = ["send_digest_emails.py", path]
        os.environ["RESEND_API_KEY"] = "test-key"
        try:
            sde.main()
            check("mark_digested was called exactly once (for the batch of sent digests)", len(dd_calls) == 1, dd_calls)
            ids = {i["opportunity_id"] for i in dd_calls[0]} if dd_calls else set()
            check("only the SENT digest's downgrade id was marked", ids == {"OPP-SENT"}, ids)
            check("the skipped digest's own downgrade id was NOT marked (carried again tomorrow instead)",
                  "OPP-SKIPPED" not in ids, ids)
        except SystemExit:
            check("main() did not exit early", False)
        finally:
            sys.argv = real_argv
            os.environ.clear()
            os.environ.update(real_environ)
            sde.urllib.request.urlopen = real_urlopen
            sde.company_profiles.RestClient.from_env = real_from_env
            sde.discovery_downgrades.mark_digested = real_dd_mark


def main():
    test_section_count_and_has_content()
    test_item_date_picks_first_present_key()
    test_render_text_includes_real_content_and_caps_at_ten()
    test_render_text_uses_document_expiry_label_not_raw_field()
    test_render_text_names_the_person_on_a_person_credential_item()
    test_render_text_shows_what_actually_changed_on_a_listing_change()
    test_render_text_shows_why_a_tender_was_reassessed()
    test_render_text_shows_which_tender_a_document_will_have_lapsed_before()
    test_render_text_does_not_duplicate_the_closing_date_or_drop_the_real_expiry_date()
    test_send_one_skips_cleanly_without_email_or_content()
    test_send_one_dry_run_never_touches_the_network()
    test_send_one_reports_sent_on_a_real_looking_success()
    test_send_one_retries_once_on_429_then_succeeds()
    test_send_one_does_not_retry_a_second_429()
    test_send_one_handles_a_retry_after_http_date_not_just_seconds()
    test_send_one_reports_failed_on_a_permanent_http_error()
    test_main_isolates_a_malformed_digest_entry()
    test_mark_delivered_items_marks_nothing_for_a_run_with_no_sent_digests()
    test_mark_delivered_items_only_marks_ids_from_confirmed_sent_digests()
    test_mark_delivered_items_degrades_safely_with_no_supabase_credentials()
    test_main_only_marks_the_digest_that_actually_sent_not_a_skipped_one()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
