"""
Every company's own fit profile, for scoring a discovered tender per company.

Sarel, 2026-10-17 (Hardcoded-Assumptions-Audit Q4): "It should score for all
companies in the app. Nothing must be klipcorp specific, they are just a
company, not a benchmark, treat all processing for all companies and not
specific to anything we upload as a sample."

So the national Discovery feed (watch_new_tenders.py) no longer reads one
shared profile JSON. It reads every company in the system and builds each
one's profile from that company's OWN rows - the same shape and the same
sources the intake/bridge path already used for one company
(engine/general/process_general_jobs.py, which now calls
profile_from_company_rows() below instead of its own copy):

  disciplines      union of the company's tagged Experience Library items
                   (experience_items.disciplines where tagged_at is set)
  has_cidb_grading companies.cidb_grading (0018)
  bee_level, black_ownership_pct   companies (0001)
  offices          company_offices (0015), else derived from the registered
                   address (assess_tender.offices_from_company)

`client` is anything with .select(table, filters) - the bridge's Supabase
REST client, or bridge_selftest.PsqlClient against a scratch Postgres.

A profile JSON file (config/test_companies/*.json, or a real company's
exported profile) is still accepted by profiles_from_files() - for a local run
without Supabase, and only ever as the profile of the company it names, never
as a stand-in for every company.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assess_tender  # noqa: E402


def profile_from_company_rows(client, company_id, company=None):
    """assess_tender's profile shape, from one company's own rows."""
    company = company or (client.select("companies", {"id": company_id}) or [{}])[0]
    items = client.select("experience_items", {"company_id": company_id})
    disciplines = sorted({d for i in items if i.get("tagged_at") for d in (i.get("disciplines") or [])})
    offices = [{k: o.get(k) for k in ("province", "district_municipality", "local_municipality", "town", "office_kind")}
               for o in client.select("company_offices", {"company_id": company_id})]
    if not offices:
        offices = assess_tender.offices_from_company({"registered_address": company.get("registered_address")})
    return {"disciplines": disciplines, "bee_level": company.get("bee_level"),
            "black_ownership_pct": company.get("black_ownership_pct"),
            "has_cidb_grading": bool(company.get("cidb_grading")), "offices": offices}


def all_company_profiles(client, include_test_companies=False):
    """[{company_id, legal_name, key, profile}] for every company in the
    system. Synthetic test companies (companies.is_test_company, 0007) are
    left out unless asked for - they exist for the admin harness, and a
    Discovery row on one is noise on nobody's real feed."""
    rows = client.select("companies")
    out = []
    for c in sorted(rows, key=lambda r: (r.get("legal_name") or "", r["id"])):
        if c.get("is_test_company") and not include_test_companies:
            continue
        out.append({"company_id": c["id"], "legal_name": c.get("legal_name"), "key": c["id"],
                    "profile": profile_from_company_rows(client, c["id"], c)})
    return out


def profiles_from_files(paths):
    """[{company_id: None, legal_name, key, profile}] from profile JSON files,
    one entry per file, each the profile of the company that file names."""
    out = []
    for p in paths:
        data = json.load(open(p))
        legal = (data.get("company") or {}).get("legal_name") or os.path.splitext(os.path.basename(p))[0]
        out.append({"company_id": None, "legal_name": legal, "key": f"file:{legal}",
                    "profile": assess_tender.load_company_profile(p)})
    return out


class RestClient:
    """The slice of Supabase PostgREST the Discovery scripts need (select,
    upsert, insert), service-role key from the environment - same env vars and
    same urllib approach as every other engine/ writer. Never the anon key:
    discovered_opportunities has no client insert policy (0004)."""

    def __init__(self, url, key):
        self.url, self.key = url.rstrip("/"), key

    @classmethod
    def from_env(cls):
        url, key = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        return cls(url, key) if url and key else None

    def _req(self, method, path, body=None, prefer=None):
        import urllib.request
        import urllib.error
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        req = urllib.request.Request(self.url + "/rest/v1/" + path, method=method, headers=h,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read()
                return json.loads(text) if text else []
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path.split('?')[0]} failed: {e.code} {e.read().decode(errors='replace')[:300]}")

    def select(self, table, filters=None, order=None):
        import urllib.parse
        parts = [f"{k}=eq.{urllib.parse.quote(str(v), safe='')}" for k, v in (filters or {}).items()]
        parts.append("select=*")
        if order:
            parts.append(f"order={order}")
        return self._req("GET", f"{table}?{'&'.join(parts)}")

    def upsert(self, table, rows, on_conflict):
        return self._req("POST", f"{table}?on_conflict={on_conflict}", rows,
                         "return=representation,resolution=merge-duplicates")

    def insert(self, table, row):
        out = self._req("POST", table, row, "return=representation")
        return out[0] if out else None
