"""
Expiry reminders for the shared registrations catalog and property documents
(migration 0050) - the SAME mechanism as the vault documents and the
ECSA/SACPCMP/SACNASP/SAGC columns: watch_deadlines._expiry_window(), one
seen store, one lead-time window, the same "renew soon" then "expired"
escalation. Generalised to work off the catalog: one held_registrations row
= one tracked expiry, whatever body it is (PSIRA, SETA accreditation, a
waste permit ...), so a new registration type needs no code change.

Called from watch_deadlines.main() and daily_digest.py's live mode. Items are
shaped like the existing ones so every consumer routes them unchanged:
  * held by the company      -> type "document"          (finance, full_cycle)
  * held by a person/principal -> type "person_credential" (cv_admin, full_cycle)
  * property document         -> type "document"
with source = "held_registrations" / "property_documents".

Only labels, registration numbers and dates are reported - never an ID
number or any other personal field of a principal (POPIA; 0050 header).
"""


import calendar
import datetime


# Mirrors app/lib/properties.ts's own PROPERTY_DOCUMENT_TYPES maxAgeMonths
# rule for the two property-document types whose real "still valid" test is
# an age limit counted from the issue date, not a fixed expiry date the
# certificate itself carries - pest_control_certificate and sapoa_grading.
# The upload form (app/app/company/properties/page.tsx) labels its
# valid_until field "Valid until (if it has one)" for exactly this reason:
# these two types realistically get saved with issued_on set and valid_until
# left null. Before this (standing review, 2026-11-11), find_due_property_
# documents()/find_property_documents_lapsing_before_closing() keyed purely
# off valid_until, so a null valid_until made a row invisible to BOTH
# reminder functions forever, no matter how stale issued_on got - confirmed
# live: test_principals_registrations.py's own Part 2 fixture already
# inserts a pest_control_certificate issued 400 days ago (well past the
# 12-month limit) with valid_until null, and its own assertion (len(pdue)
# == 1) says only the OTHER row, the one with a real valid_until, gets
# reported. The only place this was ever surfaced was lib/properties.ts's
# own tooOld(), a client-render-time-only check on the Properties page
# itself - no email, no daily digest, no "lapses before closing on an open
# tender" warning: a genuinely non-compliant building document for an
# active lease tender produced zero proactive signal unless someone
# happened to load that exact page.
PROPERTY_DOCUMENT_MAX_AGE_MONTHS = {
    "pest_control_certificate": 12,
    "sapoa_grading": 12,
}


def _add_months_clamped(d, months):
    """Same calendar-anniversary clamping as date-fns's addMonths(), which
    lib/properties.ts's own tooOld() already uses for this exact calculation
    (standing review, 2026-11-06) - a bare month-rollover would otherwise
    overflow a certificate issued on Feb 29 into March 1 of the following
    year instead of landing on Feb 28."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return datetime.date(year, month, day)


def _effective_property_expiry(document_type, issued_on, valid_until):
    """The date find_due_property_documents()/find_property_documents_
    lapsing_before_closing() should treat as this document's expiry: the
    real valid_until when the certificate has one, else issued_on plus the
    type's own age limit (PROPERTY_DOCUMENT_MAX_AGE_MONTHS) when it doesn't.
    None if neither applies - exactly like a row with no valid_until did
    before this fix, for every OTHER document type (title deed, building
    insurance, ...), which genuinely have no expiry concept at all and are
    correctly still never reminded."""
    if valid_until:
        return valid_until
    max_months = PROPERTY_DOCUMENT_MAX_AGE_MONTHS.get(document_type)
    if not max_months or not issued_on:
        return None
    try:
        issued = datetime.date.fromisoformat(str(issued_on)[:10])
    except ValueError:
        return None
    return _add_months_clamped(issued, max_months).isoformat()


def _wd():
    import watch_deadlines  # lazy: watch_deadlines imports this module
    return watch_deadlines


def _names(url, key, table, col, ids):
    if not ids:
        return {}
    rows = _wd().supabase_request(url, key, f"{table}?select=id,{col}&id=in.({','.join(sorted(ids))})")
    return {r["id"]: r.get(col) for r in rows}


def _mark_company(seen, prefix, expiry, status, company_id):
    # watch_deadlines may or may not record company_id itself (the DB seen
    # store in 0041 needs it); set it either way.
    entry = seen.get(f"{prefix}::{expiry}::{status}")
    if isinstance(entry, dict) and not entry.get("company_id"):
        entry["company_id"] = company_id


def find_due_registrations(url, key, seen, today, lead_days):
    wd = _wd()
    rows = wd.supabase_request(
        url, key,
        "held_registrations?select=id,company_id,registration_type_id,person_id,principal_id,"
        "registration_number,category,expiry_date&expiry_date=not.is.null")
    types = {}
    type_ids = {r["registration_type_id"] for r in rows}
    if type_ids:
        for t in wd.supabase_request(url, key, f"registration_types?select=id,slug,label&id=in.({','.join(sorted(type_ids))})"):
            types[t["id"]] = t
    companies = _names(url, key, "companies", "legal_name", {r["company_id"] for r in rows})
    people = _names(url, key, "people", "name", {r["person_id"] for r in rows if r.get("person_id")})
    principals = _names(url, key, "company_principals", "full_name", {r["principal_id"] for r in rows if r.get("principal_id")})

    due = []
    for r in rows:
        prefix = f"reg::{r['id']}::expiry_date"
        hit = wd._expiry_window(seen, prefix, "registration", r["expiry_date"], today, lead_days)
        if not hit:
            continue
        left, status = hit
        _mark_company(seen, prefix, r["expiry_date"], status, r["company_id"])
        t = types.get(r["registration_type_id"], {})
        holder_name = people.get(r.get("person_id")) or principals.get(r.get("principal_id"))
        item = {
            "type": "person_credential" if holder_name or r.get("person_id") or r.get("principal_id") else "document",
            "source": "held_registrations",
            "held_registration_id": r["id"],
            "company_id": r["company_id"],
            "company_name": companies.get(r["company_id"]),
            "field": f"held_registrations:{t.get('slug')}",
            "label": t.get("label") or "Registration",
            "registration_slug": t.get("slug"),
            "registration_number": r.get("registration_number"),
            "category": r.get("category"),
            "expiry_date": r["expiry_date"],
            "days_left": left,
            "status": status,
        }
        if r.get("person_id"):
            item.update(person_id=r["person_id"], person_name=holder_name)
        elif r.get("principal_id"):
            item.update(principal_id=r["principal_id"], person_name=holder_name)
        due.append(item)
    return due


def find_held_registrations_lapsing_before_closing(url, key, seen, today, lead_days):
    """Finding 132/139's own "lapses before closing" gap (watch_deadlines.
    find_documents_lapsing_before_closing()/find_person_credentials_lapsing_
    before_closing()), extended to the registrations catalog (0050): a held
    registration that is fine today - outside the normal reminder window -
    but will have lapsed by the closing date of an open tender the company
    has a pack for. Same comparison find_documents_lapsing_before_closing()
    already makes for the fixed TRACKED_EXPIRY_FIELDS columns, generalised
    to the catalog the same way find_due_registrations() generalises
    find_due_documents().

    Deliberately scoped to COMPANY-held rows only (no person_id/principal_id
    set) - mirrors find_documents_lapsing_before_closing()'s own
    company-wide scope, not find_person_credentials_lapsing_before_closing()'s
    per-assignment one. A PERSON-held registration (person_id set, e.g. a
    key person's own PSIRA) would need the identical "confirmed onto THIS
    tender" scoping that function uses
    (tender_pack_assignments.confirmed_person_id) - a real, matching gap,
    deliberately NOT implemented here rather than guessed at (same honest,
    scoped-not-forced discipline Finding 132 itself was first built with,
    before Finding 139 extended it to persons in its own later, dedicated
    pass). A PRINCIPAL-held registration (principal_id set, e.g. a
    director's own PSIRA) has no "confirmed onto a tender" concept at all -
    principals aren't assigned to tender positions the way key people are -
    so it stays on this module's own reactive coverage
    (app/lib/tenderCompliance.ts) only, same "ask don't guess" rule."""
    wd = _wd()
    rows = wd.supabase_request(
        url, key,
        "held_registrations?select=id,company_id,registration_type_id,expiry_date"
        "&expiry_date=not.is.null&person_id=is.null&principal_id=is.null")
    if not rows:
        return []
    type_ids = {r["registration_type_id"] for r in rows}
    types = {}
    if type_ids:
        for t in wd.supabase_request(url, key, f"registration_types?select=id,slug,label&id=in.({','.join(sorted(type_ids))})"):
            types[t["id"]] = t
    companies = _names(url, key, "companies", "legal_name", {r["company_id"] for r in rows})
    packs = wd.supabase_request(url, key, "tender_packs?select=company_id,tender_id")
    tender_ids = sorted({p["tender_id"] for p in packs})
    tenders = {}
    if tender_ids:
        trows = wd.supabase_request(url, key, f"tenders?select=id,contract_no,title,closing_date,status&id=in.({','.join(tender_ids)})")
        tenders = {t["id"]: t for t in trows}
    rows_by_company = {}
    for r in rows:
        rows_by_company.setdefault(r["company_id"], []).append(r)

    due = []
    for p in packs:
        company_rows = rows_by_company.get(p["company_id"])
        if not company_rows:
            continue
        tender = tenders.get(p["tender_id"])
        if not tender or tender.get("status") != "open" or not tender.get("closing_date"):
            continue
        # Same SAST closing-day normalisation as
        # find_documents_lapsing_before_closing() - see that function's own
        # comment for why a naive +2h shift on an already-SAST-tagged offset
        # double-counts the offset (Finding 71, 2026-10-24).
        try:
            closing_ts = datetime.datetime.fromisoformat(str(tender["closing_date"]).replace("Z", "+00:00"))
        except ValueError:
            wd.system_alerts.record(
                "deadlines", f"Tender {tender['id']}'s closing date ('{tender['closing_date']}') is not a valid "
                "date - its held-registration lapsing-before-closing check was skipped.", "warning",
                context={"tender_id": tender["id"], "closing_date": tender["closing_date"],
                         "company_id": p["company_id"]})
            continue
        closing_day = ((closing_ts.astimezone(datetime.timezone.utc) + datetime.timedelta(hours=2)).date()
                       if closing_ts.tzinfo else closing_ts.date())
        to_closing = (closing_day - today).days
        if to_closing < 0:
            continue
        for r in company_rows:
            expiry = r["expiry_date"]
            left = wd.days_until(expiry, today)  # None (alert recorded) for a malformed date
            if left is None:
                continue
            exp_day = today + datetime.timedelta(days=left)
            if exp_day >= closing_day or exp_day < today:
                continue  # covers the closing date / already expired (reported by find_due_registrations)
            if left <= lead_days:
                continue  # already inside the normal window - find_due_registrations reports this one
            seen_key = f"reg_before_closing::{r['id']}::{expiry}::{p['tender_id']}"
            if seen_key in seen:
                continue
            seen[seen_key] = {"first_seen": today.isoformat(), "kind": "held_registration_before_closing",
                              "company_id": r["company_id"]}
            t = types.get(r["registration_type_id"], {})
            due.append({
                "type": "held_registration_before_closing",
                "company_id": r["company_id"],
                "company_name": companies.get(r["company_id"]),
                "held_registration_id": r["id"],
                "field": f"held_registrations:{t.get('slug')}",
                "label": t.get("label") or "Registration",
                "expiry_date": expiry,
                "days_left": (exp_day - today).days,
                "tender_id": p["tender_id"],
                "tender_label": tender.get("contract_no") or tender.get("title") or p["tender_id"],
                "closing_date": closing_day.isoformat(),
                "days_to_closing": to_closing,
                "status": "lapses_before_closing",
            })
    return due


def find_due_property_documents(url, key, seen, today, lead_days):
    wd = _wd()
    rows = wd.supabase_request(
        url, key,
        "property_documents?select=id,company_id,property_id,document_type,reference_number,issued_on,valid_until")
    props = _names(url, key, "company_properties", "label", {r["property_id"] for r in rows})
    companies = _names(url, key, "companies", "legal_name", {r["company_id"] for r in rows})
    due = []
    for r in rows:
        expiry = _effective_property_expiry(r["document_type"], r.get("issued_on"), r.get("valid_until"))
        if not expiry:
            continue
        prefix = f"propdoc::{r['id']}::valid_until"
        hit = wd._expiry_window(seen, prefix, "property_document", expiry, today, lead_days)
        if not hit:
            continue
        left, status = hit
        _mark_company(seen, prefix, expiry, status, r["company_id"])
        label = PROPERTY_DOCUMENT_LABELS.get(r["document_type"], r["document_type"].replace("_", " "))
        due.append({
            "type": "document",
            "source": "property_documents",
            "property_document_id": r["id"],
            "company_id": r["company_id"],
            "company_name": companies.get(r["company_id"]),
            "field": f"property_documents:{r['document_type']}",
            "label": f"{label} - {props.get(r['property_id']) or 'property'}",
            "registration_number": r.get("reference_number"),
            "expiry_date": expiry,
            "days_left": left,
            "status": status,
        })
    return due


# Same keys and wording as app/lib/properties.ts PROPERTY_DOCUMENT_TYPES.
PROPERTY_DOCUMENT_LABELS = {
    "title_deed": "Title deed",
    "owner_mandate": "Owner's mandate / letter of authority",
    "purchase_or_bond": "Offer to purchase / sale agreement / bond",
    "occupancy_certificate": "Occupancy certificate",
    "zoning_certificate": "Zoning certificate",
    "approved_building_plans": "Approved building plans",
    "fire_certificate": "Fire safety / clearance certificate",
    "electrical_coc": "Electrical certificate of compliance",
    "pest_control_certificate": "Pest control certificate",
    "sapoa_grading": "SAPOA building grading",
    "rates_clearance": "Municipal rates clearance certificate",
    "building_insurance": "Building insurance",
    "nbr_compliance": "National Building Regulations compliance certificate",
    "accessibility_compliance": "Disability accessibility compliance certificate",
    "floor_plan": "Floor plan / layout with measurements",
    "maintenance_plan": "Building maintenance plan",
}


def find_property_documents_lapsing_before_closing(url, key, seen, today, lead_days):
    """The identical "lapses before closing" gap find_documents_lapsing_
    before_closing() (company vault documents), find_person_credentials_
    lapsing_before_closing() and find_held_registrations_lapsing_before_
    closing() (company-held registrations catalog) already each cover for
    their own document family, extended to property_documents (0050) -
    QA pass, 2026-11-08. A property document (a fire certificate, an
    electrical COC, a municipal rates clearance...) that is fine today -
    outside the normal doc-lead-days window - but will have lapsed by the
    closing date of an open tender the company has a pack for, got NO
    advance warning anywhere: not in this live reminder system (confirmed
    by reading watch_deadlines.main() - only find_due_property_documents()'s
    own in-window check was ever wired in) and not reactively either
    (confirmed by grep: "property_document" appears nowhere in
    app/lib/tenderCompliance.ts, which only covers the SANRAL vault-field
    returnables, never a company's own properties). Company-wide scope,
    same as find_documents_lapsing_before_closing()/find_held_registrations_
    lapsing_before_closing() - a property document has no per-tender
    assignment concept (it isn't tied to a specific position the way a key
    person's own credential is), so every open tender the company has a
    pack for is equally affected by the SAME property going non-compliant."""
    wd = _wd()
    rows = wd.supabase_request(
        url, key,
        "property_documents?select=id,company_id,property_id,document_type,reference_number,issued_on,valid_until")
    if not rows:
        return []
    companies = _names(url, key, "companies", "legal_name", {r["company_id"] for r in rows})
    props = _names(url, key, "company_properties", "label", {r["property_id"] for r in rows})
    packs = wd.supabase_request(url, key, "tender_packs?select=company_id,tender_id")
    tender_ids = sorted({p["tender_id"] for p in packs})
    tenders = {}
    if tender_ids:
        trows = wd.supabase_request(url, key, f"tenders?select=id,contract_no,title,closing_date,status&id=in.({','.join(tender_ids)})")
        tenders = {t["id"]: t for t in trows}
    rows_by_company = {}
    for r in rows:
        rows_by_company.setdefault(r["company_id"], []).append(r)

    due = []
    for p in packs:
        company_rows = rows_by_company.get(p["company_id"])
        if not company_rows:
            continue
        tender = tenders.get(p["tender_id"])
        if not tender or tender.get("status") != "open" or not tender.get("closing_date"):
            continue
        # Same SAST closing-day normalisation as find_documents_lapsing_
        # before_closing() - see that function's own comment for why a
        # naive +2h shift on an already-SAST-tagged offset double-counts it.
        try:
            closing_ts = datetime.datetime.fromisoformat(str(tender["closing_date"]).replace("Z", "+00:00"))
        except ValueError:
            wd.system_alerts.record(
                "deadlines", f"Tender {tender['id']}'s closing date ('{tender['closing_date']}') is not a valid "
                "date - its property-document lapsing-before-closing check was skipped.", "warning",
                context={"tender_id": tender["id"], "closing_date": tender["closing_date"],
                         "company_id": p["company_id"]})
            continue
        closing_day = ((closing_ts.astimezone(datetime.timezone.utc) + datetime.timedelta(hours=2)).date()
                       if closing_ts.tzinfo else closing_ts.date())
        to_closing = (closing_day - today).days
        if to_closing < 0:
            continue
        for r in company_rows:
            expiry = _effective_property_expiry(r["document_type"], r.get("issued_on"), r.get("valid_until"))
            if not expiry:
                continue
            left = wd.days_until(expiry, today)  # None (alert recorded) for a malformed date
            if left is None:
                continue
            exp_day = today + datetime.timedelta(days=left)
            if exp_day >= closing_day or exp_day < today:
                continue  # covers the closing date / already expired (reported by find_due_property_documents)
            if left <= lead_days:
                continue  # already inside the normal window - find_due_property_documents reports this one
            seen_key = f"propdoc_before_closing::{r['id']}::{expiry}::{p['tender_id']}"
            if seen_key in seen:
                continue
            seen[seen_key] = {"first_seen": today.isoformat(), "kind": "property_document_before_closing",
                              "company_id": r["company_id"]}
            label = PROPERTY_DOCUMENT_LABELS.get(r["document_type"], r["document_type"].replace("_", " "))
            due.append({
                "type": "property_document_before_closing",
                "company_id": r["company_id"],
                "company_name": companies.get(r["company_id"]),
                "property_document_id": r["id"],
                "field": f"property_documents:{r['document_type']}",
                "label": f"{label} - {props.get(r['property_id']) or 'property'}",
                "expiry_date": expiry,
                "days_left": (exp_day - today).days,
                "tender_id": p["tender_id"],
                "tender_label": tender.get("contract_no") or tender.get("title") or p["tender_id"],
                "closing_date": closing_day.isoformat(),
                "days_to_closing": to_closing,
                "status": "lapses_before_closing",
            })
    return due
