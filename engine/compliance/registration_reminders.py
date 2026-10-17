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


def find_due_property_documents(url, key, seen, today, lead_days):
    wd = _wd()
    rows = wd.supabase_request(
        url, key,
        "property_documents?select=id,company_id,property_id,document_type,reference_number,valid_until"
        "&valid_until=not.is.null")
    props = _names(url, key, "company_properties", "label", {r["property_id"] for r in rows})
    companies = _names(url, key, "companies", "legal_name", {r["company_id"] for r in rows})
    due = []
    for r in rows:
        prefix = f"propdoc::{r['id']}::valid_until"
        hit = wd._expiry_window(seen, prefix, "property_document", r["valid_until"], today, lead_days)
        if not hit:
            continue
        left, status = hit
        _mark_company(seen, prefix, r["valid_until"], status, r["company_id"])
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
            "expiry_date": r["valid_until"],
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
    "floor_plan": "Floor plan / layout",
    "maintenance_plan": "Building maintenance plan",
}
