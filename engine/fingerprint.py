"""
Stream 1: template fingerprint and change check.

Sarel's rule: "There's always a chance a tender template has changed, so we
must always check first." This computes a fingerprint of an incoming SANRAL
.xlsm (sheet names/order, dropdown count per sheet, named ranges, a cell-layout
hash per sheet, macro presence/hash, whole-file hash), compares it against the
stored baseline for that template family, and refuses to proceed silently on
any mismatch.

Usage:
    python3 fingerprint.py <template.xlsm> [--family NAME] [--store DIR]

Behaviour:
  - No stored fingerprint for the family yet: stores this one as the
    baseline (tagged with today's date) and exits 0.
  - Stored fingerprint exists and matches: prints OK and exits 0.
  - Stored fingerprint exists and differs: prints exactly what changed and
    exits 1. Never fills a workbook whose fingerprint doesn't match.

Family is auto-detected from the sheet set (see SANRAL-Tender-Automation-
Specification.md section 2.1) unless --family is given explicitly.

Known limitation (documented, not hidden): cell_layout_hashes fingerprints
the set of occupied cell references per sheet, not which cells are unlocked
non-formula inputs (section 5.3 L1/L2 of the spec). It will correctly ignore
tender-specific values typed into existing cells (contract number, closing
date, etc.) while still catching an added, removed or moved cell. It will
NOT catch a cell that silently changed from unlocked to locked, or vice
versa, without any cell being added or removed. A tighter fingerprint based
on lock/formula status is future work, not yet built.

Three known-noisy signals, found and root-caused 2026-10-15 comparing 4 real
downloaded templates against the R.334-030-2025.1F baseline (every one of
them differed on first check; all three causes below were confirmed benign
by direct inspection, not assumed):
  - zip_part_count used to include customXml/* parts, which are SharePoint/
    document-management metadata stamped on some downloads and not others -
    nothing to do with template structure. Now excluded from the count.
  - cell_layout_hashes used to include cells with no value and no formula,
    just a style attribute (e.g. a stray border/fill a few columns past the
    real form, confirmed by inspecting the raw XML: `<c r="EA1" s="804"/>`,
    no <v> or <f>). Now only counts cells with actual content.
  - macro hash varies per independently-saved copy even when the VBA source
    is unchanged - this is a well-known compiled-bytecode artifact (the
    PerformanceCache section Excel embeds), not something a fingerprint
    comparison can meaningfully use. A macro-only difference (everything
    else matches) is now reported as a warning, not a blocking mismatch;
    any OTHER difference alongside it still stops the run as before.
"""
import sys, os, re, json, hashlib, zipfile, argparse, datetime
from sanral_fill import Workbook

DEFAULT_STORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fingerprints")


def detect_family(sheet_names):
    if any(re.match(r"^FORM C2\.4 TECH -TENDER \d+$", s) for s in sheet_names):
        return "RRM Consultant Tender"
    if "FORM C2.4 TECH" in sheet_names and "B6 - Scoring - Past Performance" in sheet_names:
        return "Conventional Consultant Tender"
    return "UNKNOWN"


def sheet_order(wb):
    N = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = wb._xml("xl/workbook.xml")
    return [s.get("name") for s in root.find("m:sheets", N)]


def dropdown_counts(wb):
    counts = {}
    for sheet, cells in wb.controls.items():
        n = sum(len(v) for v in cells.values())
        if n:
            counts[sheet] = n
    return counts


def named_ranges(wb):
    N = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = wb._xml("xl/workbook.xml")
    dn = root.find("m:definedNames", N)
    if dn is None:
        return {}
    return {d.get("name"): "".join(d.itertext()) for d in dn}


def cell_layout_hashes(wb):
    N = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    out = {}
    for sheet, path in wb.sheet_path.items():
        root = wb._xml(path)
        data = root.find("m:sheetData", N)
        # Only cells with an actual value or formula count as "occupied" - a cell with
        # just a style attribute and no <v>/<f> is formatting noise (confirmed 2026-10-15:
        # a block of style-only cells a few columns past the real form differed between two
        # genuinely identical-layout templates and nothing else did).
        refs = [c.get("r") for row in data.findall("m:row", N) for c in row.findall("m:c", N)
                if c.find("m:v", N) is not None or c.find("m:f", N) is not None]
        out[sheet] = hashlib.sha256(",".join(sorted(refs)).encode()).hexdigest()
    return out


def macro_info(path):
    with zipfile.ZipFile(path) as z:
        if "xl/vbaProject.bin" not in z.namelist():
            return {"present": False}
        return {"present": True, "sha256": hashlib.sha256(z.read("xl/vbaProject.bin")).hexdigest()}


def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_fingerprint(path):
    wb = Workbook(path)
    sheets = sheet_order(wb)
    counts = dropdown_counts(wb)
    # customXml/* parts are SharePoint/document-management metadata stamped on some
    # downloads and not others (confirmed 2026-10-15: the only diff between two
    # genuinely identical-layout templates was 9 customXml/itemN.xml-family parts) -
    # not template structure, excluded from the structural part count.
    structural_parts = [p for p in wb.order if not p.startswith("customXml/")]
    return {
        "family": detect_family(sheets),
        "sheet_names": sheets,
        "zip_part_count": len(structural_parts),
        "dropdown_counts": counts,
        "dropdown_total": sum(counts.values()),
        "named_ranges": named_ranges(wb),
        "cell_layout_hashes": cell_layout_hashes(wb),
        "macro": macro_info(path),
        "file_sha256": file_hash(path),
    }


def diff(stored, current):
    """Returns (blocking_changes, warnings). 'macro' alone is demoted to a warning - it's
    known to vary per independently-saved copy even with unchanged VBA source (see module
    docstring) - but if ANYTHING else also differs, macro is folded back into the blocking
    list too, since at that point there's no reason to extend it the benefit of the doubt."""
    changes, warnings = [], []
    for key in ("family", "sheet_names", "zip_part_count", "dropdown_counts",
                "dropdown_total", "named_ranges"):
        if stored.get(key) != current.get(key):
            changes.append((key, stored.get(key), current.get(key)))
    s_layout, c_layout = stored.get("cell_layout_hashes", {}), current.get("cell_layout_hashes", {})
    for sheet in sorted(set(s_layout) | set(c_layout)):
        if s_layout.get(sheet) != c_layout.get(sheet):
            changes.append((f"cell_layout[{sheet}]", s_layout.get(sheet), c_layout.get(sheet)))
    if stored.get("macro") != current.get("macro"):
        entry = ("macro", stored.get("macro"), current.get("macro"))
        (warnings if not changes else changes).append(entry)
    return changes, warnings


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("template")
    ap.add_argument("--family", help="override the auto-detected template family name")
    ap.add_argument("--store", default=DEFAULT_STORE, help="fingerprint store directory")
    args = ap.parse_args()

    current = build_fingerprint(args.template)
    family = args.family or current["family"]
    if family == "UNKNOWN":
        print(f"ABORT: could not identify template family for {args.template} "
              f"(sheet set matches neither Conventional nor RRM) - refusing to fill this file")
        sys.exit(2)

    os.makedirs(args.store, exist_ok=True)
    store_path = os.path.join(args.store, family.replace(" ", "_") + ".json")

    if not os.path.exists(store_path):
        current["_first_seen"] = datetime.date.today().isoformat()
        current["_source_file"] = os.path.basename(args.template)
        json.dump(current, open(store_path, "w"), indent=2, sort_keys=True)
        print(f"FIRST SEEN: no baseline for '{family}' yet - stored {store_path} "
              f"from {os.path.basename(args.template)} "
              f"({current['dropdown_total']} dropdowns, {len(current['sheet_names'])} sheets, "
              f"{current['zip_part_count']} zip parts)")
        sys.exit(0)

    stored = json.load(open(store_path))
    changes, warnings = diff(stored, current)
    if not changes:
        print(f"OK: {os.path.basename(args.template)} matches the stored '{family}' "
              f"fingerprint (first seen {stored.get('_first_seen')}, "
              f"baseline file {stored.get('_source_file')})")
        for key, old, new in warnings:
            print(f"  WARNING (non-blocking, known-noisy signal): {key}:\n"
                  f"    was: {old}\n    now: {new}")
        sys.exit(0)

    print(f"MISMATCH: {os.path.basename(args.template)} differs from the stored '{family}' "
          f"fingerprint (first seen {stored.get('_first_seen')}, "
          f"baseline file {stored.get('_source_file')}). STOPPING - not filling this file.\n")
    for key, old, new in changes:
        print(f"  {key}:\n    was: {old}\n    now: {new}")
    sys.exit(1)


if __name__ == "__main__":
    main()
