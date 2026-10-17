"""
Tender Tool's own discipline / category taxonomy - a MAINTAINED, growing list
(Sarel, 2026-10-17: "There is no standard list ... build our own list ...
it's a list that we're gonna have to maintain and build").

Where the list lives:
  - LIVE: the `discipline_categories` table (migration 0038). Adding a
    category is an INSERT (`add` below, or SQL) - never a migration. The
    Discovery fan-out reads it at the start of each run.
  - SEED / OFFLINE: config/discipline_taxonomy.json - the reviewed list in
    git, used when no database is reachable (CLI runs, tests) and pushed to
    the table with `sync`.

Shape: two levels. A top-level row (parent null) is a discipline GROUP; the
seven groups Tender Tool started with keep their old slugs (roads_civil,
water, buildings, electrical_mechanical, it_telecoms, professional_services,
security_facilities), so every experience tag, price_sector and stored
discovered_opportunities.categories value written before 0038 is still a
valid category. Children are the specific disciplines tenders are sorted
into. A company tagged with a group matches every child of it.

Evidence for the seed list: docs/specs/Discipline-Taxonomy-Findings.md.

CLI (maintenance):
    python3 engine/discovery/taxonomy.py check
        validate the seed file (slugs, parents, duplicate keywords)
    python3 engine/discovery/taxonomy.py coverage <releases.json> [--show-uncategorized N]
        how a batch of real tenders sorts (OCDS normalised report, raw OCDS
        release list, or the eTenders website's PaginatedTenderOpportunities
        rows) and what the uncategorised ones are about - the review step
        for growing the list
    python3 engine/discovery/taxonomy.py sync
        upsert the seed file into discipline_categories (service-role env)
    python3 engine/discovery/taxonomy.py add --slug S --label L [--parent P] --keywords "a, b*"
        insert one new category into the live table (and, with --write-seed,
        into the seed file too)
    python3 engine/discovery/taxonomy.py sql
        print the seed as INSERT statements (what migration 0038 carries)
"""
import argparse
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.normpath(os.path.join(HERE, "..", "..", "config", "discipline_taxonomy.json"))
SLUG_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")  # same format check as 0036 tt_all_slugs()

# The seven groups that existed before 0038 (assess_tender's old
# DISCIPLINE_KEYWORDS keys). Kept as group slugs - never renamed - because
# stored tags, price_sector values and Discovery rows use them.
LEGACY_GROUPS = ("roads_civil", "water", "buildings", "electrical_mechanical", "it_telecoms",
                 "professional_services", "security_facilities")


def normalise(text):
    """Lower-case, punctuation -> space, collapsed. Applied to both the
    tender text and every keyword, so 'air-conditioning', 'Air Conditioning'
    and 'air conditioning,' all compare equal."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9*]+", " ", (text or "").lower())).strip()


def _keyword_regex(kw):
    kw = normalise(kw)
    if not kw:
        return None
    if kw.endswith("*"):
        body = re.escape(kw[:-1].strip())
        return rf"(?<![a-z0-9]){body}[a-z0-9]*"
    return rf"(?<![a-z0-9]){re.escape(kw)}(?:s|es)?(?![a-z0-9])"


class Taxonomy:
    """An ordered list of categories, compiled for matching."""

    def __init__(self, rows, source):
        self.source = source
        self.rows = [dict(r) for r in rows if r.get("active", True)]
        self.by_slug = {r["slug"]: r for r in self.rows}
        self.order = {r["slug"]: i for i, r in enumerate(self.rows)}
        self._compiled = []
        for r in self.rows:
            kws = r.get("keywords") or []
            pats = [p for p in (_keyword_regex(k) for k in kws if "&" not in k) if p]
            rx = re.compile("|".join(pats)) if pats else None
            # "school & construct*": every part must appear (a school named
            # as the SITE of a solar install is not school building work)
            conj = [[re.compile(p) for p in (_keyword_regex(part) for part in k.split("&")) if p]
                    for k in kws if "&" in k]
            # "!phrase": the phrase's presence vetoes the whole category (a
            # lease of premises AT "Ocean Road" is not road work); a plain
            # phrase is cut out of the text before this category is tried.
            excl = [normalise(e) for e in (r.get("exclude") or []) if not e.startswith("!") and normalise(e)]
            veto = [normalise(e[1:]) for e in (r.get("exclude") or []) if e.startswith("!") and normalise(e[1:])]
            self._compiled.append((r["slug"], r.get("parent"), rx, conj, excl, veto))

    def parent_of(self, slug):
        r = self.by_slug.get(slug)
        return r.get("parent") if r else None

    def ancestors(self, slug):
        out, seen = [], set()
        p = self.parent_of(slug)
        while p and p not in seen:
            out.append(p)
            seen.add(p)
            p = self.parent_of(p)
        return out

    def label(self, slug):
        r = self.by_slug.get(slug)
        return r["label"] if r else slug.replace("_", " ").capitalize()

    def match(self, text):
        """Every category whose keywords appear in `text`, in list order,
        with a group dropped when one of its own children matched (the child
        says more). Returns [] when nothing matched."""
        norm = normalise(text)
        hits = []
        for slug, parent, rx, conj, excl, veto in self._compiled:
            if rx is None and not conj:
                continue
            if any(re.search(rf"(?<![a-z0-9]){re.escape(v)}(?![a-z0-9])", norm) for v in veto):
                continue
            t = norm
            for e in excl:
                t = t.replace(e, " ")
            if (rx is not None and rx.search(t)) or any(all(p.search(t) for p in parts) for parts in conj):
                hits.append(slug)
        hit_set = set(hits)
        return [s for s in hits
                if not any(self.parent_of(h) == s for h in hit_set)]

    def overlap(self, categories, company_disciplines):
        """How a tender's categories relate to a company's discipline tags.
        exact: same slug, or the company's tag is a GROUP the category sits
        in (tagged roads_civil -> every road/bridge/stormwater child);
        broad: the tender is only known at group level and the company has a
        child of that group (tender 'civil works', company road_maintenance) -
        same field, scope still to be checked. A sibling (architecture vs
        geotechnical) is not a match."""
        tags = set(company_disciplines or [])
        exact, broad = [], []
        for c in categories:
            if c in tags or any(a in tags for a in self.ancestors(c)):
                exact.append(c)
            elif any(c in self.ancestors(t) for t in tags if t in self.by_slug):
                broad.append(c)
        return exact, broad


_ACTIVE = None


def load_seed(path=SEED_PATH):
    data = json.load(open(path))
    return [{"slug": c["slug"], "label": c["label"], "parent": c.get("parent"),
             "keywords": c.get("keywords") or [], "exclude": c.get("exclude") or [],
             "etenders": c.get("etenders") or [], "l2b": c.get("l2b") or [], "cidb": c.get("cidb") or [],
             "active": True} for c in data["categories"]]


def rows_from_db(db_rows):
    """discipline_categories rows -> the same dicts load_seed() returns."""
    rows = sorted(db_rows, key=lambda r: (r.get("sort_order") or 0, r["slug"]))
    return [{"slug": r["slug"], "label": r["label"], "parent": r.get("parent_slug"),
             "keywords": r.get("keywords") or [], "exclude": r.get("exclude_keywords") or [],
             "etenders": r.get("etenders_categories") or [], "l2b": r.get("l2b_categories") or [],
             "cidb": r.get("cidb_classes") or [], "active": r.get("active", True)} for r in rows]


def load_taxonomy(client=None, path=SEED_PATH):
    """The live table when a client (company_profiles.RestClient) is given and
    the table answers with rows; otherwise the seed file. Never silently
    empty: a DB error falls back to the seed, and says so in .source."""
    if client is not None:
        try:
            db = client.select("discipline_categories", order="sort_order.asc")
            if db:
                return Taxonomy(rows_from_db(db), "discipline_categories table")
            note = "discipline_categories table is empty"
        except Exception as e:  # noqa: BLE001 - any read failure -> seed
            note = f"could not read discipline_categories ({e})"
        return Taxonomy(load_seed(path), f"seed file ({note})")
    return Taxonomy(load_seed(path), "seed file")


def active():
    """The taxonomy categorize() uses unless given one: whatever
    use_taxonomy() set; else, once per process, the LIVE table when the
    service-role env is present (every engine process that writes to
    Supabase - the Discovery cron, the bridge worker - so a category added
    to the table is used on the next run without a code change); else the
    seed file. TT_TAXONOMY_SOURCE=seed forces the seed (tests, offline)."""
    global _ACTIVE
    if _ACTIVE is None:
        client = None
        if os.environ.get("TT_TAXONOMY_SOURCE") != "seed":
            url, key = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            if url and key:
                sys.path.insert(0, HERE)
                import company_profiles  # noqa: E402
                client = company_profiles.RestClient(url, key)
        _ACTIVE = load_taxonomy(client)
    return _ACTIVE


def use_taxonomy(tax):
    global _ACTIVE
    _ACTIVE = tax
    return tax


# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------

def validate(rows):
    problems = []
    slugs = [r["slug"] for r in rows]
    for s, n in collections.Counter(slugs).items():
        if n > 1:
            problems.append(f"duplicate slug {s}")
    known = set(slugs)
    for r in rows:
        if not SLUG_RE.match(r["slug"]):
            problems.append(f"bad slug format {r['slug']!r}")
        if r.get("parent") and r["parent"] not in known:
            problems.append(f"{r['slug']}: parent {r['parent']!r} is not a category")
        if r.get("parent") and (r["parent"] in known) and rows[slugs.index(r["parent"])].get("parent"):
            problems.append(f"{r['slug']}: parent {r['parent']!r} is itself a child (two levels only)")
        if not r.get("label"):
            problems.append(f"{r['slug']}: no label")
    for g in LEGACY_GROUPS:
        if g not in known:
            problems.append(f"legacy group {g} missing - stored tags/price_sector values use it")
        elif rows[slugs.index(g)].get("parent"):
            problems.append(f"legacy group {g} must stay top-level")
    return problems


def releases_from_file(path):
    """(title, description, buyer_category) triples from any of the three
    shapes this project has on disk."""
    data = json.load(open(path))
    if isinstance(data, dict):
        data = data.get("releases") or data.get("data") or []
    out = []
    for r in data:
        if "tender" in r and isinstance(r["tender"], dict):  # raw OCDS release
            t = r["tender"]
            out.append((t.get("title"), t.get("description"), t.get("mainProcurementCategory"), None))
        elif "tender_No" in r or "organ_of_State" in r:
            # eTenders website row (Home/PaginatedTenderOpportunities)
            out.append((r.get("tender_No"), r.get("description"), None, r.get("category")))
        else:  # etenders_national.normalize() shape
            out.append((r.get("title"), r.get("description"), r.get("procurement_category"), None))
    return out


def coverage(path, show_uncategorized=40, tax=None):
    tax = tax or active()
    items = releases_from_file(path)
    per_cat = collections.Counter()
    unmatched, group_only = [], 0
    for title, desc, kind, site_cat in items:
        cats = tax.match(f"{title or ''} {desc or ''}")
        if not cats:
            unmatched.append((desc or title or "", site_cat or kind))
            continue
        if all(not tax.parent_of(c) for c in cats):
            group_only += 1
        for c in cats:
            per_cat[c] += 1
    n = len(items)
    print(f"{n} tenders from {path} against {len(tax.rows)} categories ({tax.source})")
    print(f"  matched a specific discipline: {n - len(unmatched) - group_only} "
          f"({100 * (n - len(unmatched) - group_only) / max(n, 1):.1f}%)")
    print(f"  matched a group only:          {group_only}")
    print(f"  uncategorised:                 {len(unmatched)} ({100 * len(unmatched) / max(n, 1):.1f}%)")
    print("\nTenders per category:")
    for c, k in per_cat.most_common():
        print(f"  {k:5d}  {c}")
    words = collections.Counter()
    for desc, _ in unmatched:
        ws = [w for w in normalise(desc).split() if len(w) > 3 and not w.isdigit()]
        words.update(set(ws))
    print("\nMost common words in the uncategorised tenders (candidates for new keywords/categories):")
    print("  " + ", ".join(f"{w} ({k})" for w, k in words.most_common(40)))
    if show_uncategorized:
        print(f"\nFirst {show_uncategorized} uncategorised:")
        for desc, cat in unmatched[:show_uncategorized]:
            one_line = " ".join(desc.split())[:130]
            print(f"  - [{cat}] {one_line}")
    return {"total": n, "uncategorized": len(unmatched), "group_only": group_only, "per_category": dict(per_cat)}


def _sql_array(vals):
    if not vals:
        return "'{}'::text[]"
    return "array[" + ", ".join("'" + v.replace("'", "''") + "'" for v in vals) + "]"


def seed_sql(rows):
    lines = ["insert into discipline_categories (slug, label, parent_slug, sort_order, keywords, exclude_keywords, "
             "etenders_categories, l2b_categories, cidb_classes, added_from) values"]
    vals = []
    for i, r in enumerate(rows):
        lab = r["label"].replace("'", "''")
        parent = f"'{r['parent']}'" if r.get("parent") else "null"
        vals.append(f"  ('{r['slug']}', '{lab}', {parent}, {(i + 1) * 10}, {_sql_array(r['keywords'])}, "
                    f"{_sql_array(r['exclude'])}, {_sql_array(r['etenders'])}, {_sql_array(r['l2b'])}, "
                    f"{_sql_array(r['cidb'])}, 'seed 2026-10-17 (Discipline-Taxonomy-Findings.md)')")
    return "\n".join(lines) + "\n" + ",\n".join(vals) + "\non conflict (slug) do nothing;"


def db_row(r, sort_order, added_from):
    return {"slug": r["slug"], "label": r["label"], "parent_slug": r.get("parent"), "sort_order": sort_order,
            "keywords": r.get("keywords") or [], "exclude_keywords": r.get("exclude") or [],
            "etenders_categories": r.get("etenders") or [], "l2b_categories": r.get("l2b") or [],
            "cidb_classes": r.get("cidb") or [], "added_from": added_from, "active": True}


def _client():
    sys.path.insert(0, HERE)
    import company_profiles  # noqa: E402
    c = company_profiles.RestClient.from_env()
    if c is None:
        raise SystemExit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    return c


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    cv = sub.add_parser("coverage")
    cv.add_argument("path")
    cv.add_argument("--show-uncategorized", type=int, default=40)
    sub.add_parser("sync")
    sub.add_parser("sql")
    ad = sub.add_parser("add")
    ad.add_argument("--slug", required=True)
    ad.add_argument("--label", required=True)
    ad.add_argument("--parent", default=None)
    ad.add_argument("--keywords", default="")
    ad.add_argument("--exclude", default="")
    ad.add_argument("--note", default="added with taxonomy.py add")
    ad.add_argument("--write-seed", action="store_true", help="also append it to config/discipline_taxonomy.json")
    args = ap.parse_args()

    if args.cmd == "check":
        rows = load_seed()
        problems = validate(rows)
        groups = [r for r in rows if not r.get("parent")]
        print(f"{len(rows)} categories ({len(groups)} groups, {len(rows) - len(groups)} disciplines)")
        for p in problems:
            print("  PROBLEM", p)
        sys.exit(1 if problems else 0)
    if args.cmd == "coverage":
        coverage(args.path, args.show_uncategorized)
    elif args.cmd == "sql":
        print(seed_sql(load_seed()))
    elif args.cmd == "sync":
        rows = load_seed()
        problems = validate(rows)
        if problems:
            raise SystemExit("seed file has problems: " + "; ".join(problems))
        client = _client()
        # parents first, so the parent_slug FK is satisfied
        ordered = [r for r in rows if not r.get("parent")] + [r for r in rows if r.get("parent")]
        order = {r["slug"]: (i + 1) * 10 for i, r in enumerate(rows)}
        client.upsert("discipline_categories",
                      [db_row(r, order[r["slug"]], "seed file (taxonomy.py sync)") for r in ordered], "slug")
        print(f"upserted {len(rows)} categories")
    elif args.cmd == "add":
        if not SLUG_RE.match(args.slug):
            raise SystemExit(f"slug {args.slug!r} must be a lower-case slug (a-z, 0-9, _)")
        r = {"slug": args.slug, "label": args.label, "parent": args.parent,
             "keywords": [k.strip() for k in args.keywords.split(",") if k.strip()],
             "exclude": [k.strip() for k in args.exclude.split(",") if k.strip()],
             "etenders": [], "l2b": [], "cidb": []}
        client = _client()
        existing = client.select("discipline_categories", order="sort_order.desc")
        if any(e["slug"] == args.slug for e in existing):
            raise SystemExit(f"{args.slug} already exists")
        if args.parent and not any(e["slug"] == args.parent for e in existing):
            raise SystemExit(f"parent {args.parent} is not a category")
        top = max([e.get("sort_order") or 0 for e in existing] or [0])
        client.insert("discipline_categories", db_row(r, top + 10, args.note))
        print(f"added {args.slug} to discipline_categories")
        if args.write_seed:
            data = json.load(open(SEED_PATH))
            data["categories"].append(r)
            json.dump(data, open(SEED_PATH, "w"), indent=1, ensure_ascii=False)
            print(f"and to {SEED_PATH}")


if __name__ == "__main__":
    main()
