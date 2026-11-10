"""
Automated completeness check for app/lib/adminHealthGroups.ts's own
exhaustiveness invariant - "every real system_alerts.source literal is in
exactly one HEALTH_SOURCE_GROUPS group" - added after that invariant was
missed by a manual grep-and-eyeball sweep THREE separate times in a row
(2026-11-06, 2026-11-09, 2026-11-10/Finding 354), each time believing its own
"every real call site" accounting was now complete. Standing review pass,
2026-11-10 (Finding 354's own write-up flagged this as worth building, not
built that pass as out of scope for a two-line fix - built here instead of a
4th manual sweep).

What this does, instead of grepping for known source names (which only ever
finds sources someone already thought to grep for):

  1. AST-walks every .py file under engine/ for a REAL call to
     system_alerts.record(source, ...) - any attribute chain ending in
     ".system_alerts.record(" at ANY depth (not just a single `system_alerts.
     record(` hop - this is exactly the shape that hid "requirements" from
     every prior sweep: engine/general/requirements.py calls
     `scan_ocr.system_alerts.record("requirements", ...)`, two hops deep,
     because it imports `scan_ocr` rather than `system_alerts` itself), or a
     bare `record(` after `from system_alerts import record`.
  2. Extracts the literal source string where the first argument is a
     string literal, and resolves the two known places a real source is
     passed indirectly instead (run_bridges.py's BRIDGES dict keys; every
     poll_forever(..., alert_source="...") call) by reading those specific
     structures directly, rather than assuming any non-literal first
     argument is one of these two known shapes - any OTHER non-literal
     call site is a hard failure here, not a silent skip, so a brand new
     indirection added later gets caught instead of quietly bypassing this
     check the way "requirements" bypassed three manual sweeps.
  3. Reads HEALTH_SOURCE_GROUPS directly out of app/lib/adminHealthGroups.ts
     (a plain regex over the literal object - that file's own comment
     history is not treated as ground truth, only the real
     Record<string, string[]> value is) and checks every source this script
     actually found in engine/ is in EXACTLY one group - not zero (invisible
     on /admin and /admin/telemetry) and not two-or-more (double-counted).
  4. Also cross-checks the TS test file's own hand-maintained
     REAL_SYSTEM_ALERT_SOURCES ground-truth list (adminHealthGroups.spec.ts)
     against what this script found, in both directions - catching either a
     source this script finds that the TS list doesn't know about, or a
     stale TS entry for a source nothing in engine/ raises any more.

This is a one-time verification script turned into a cheap, standing
regression test (no live Supabase/Postgres/API key, pure static analysis of
the checked-in source tree) - run it the same way as any other
engine/alerts/test_*.py file:

    python3 engine/alerts/test_system_alerts_sources_exhaustive.py
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ENGINE_ROOT = os.path.join(ROOT, "engine")
ADMIN_HEALTH_GROUPS_TS = os.path.join(ROOT, "app", "lib", "adminHealthGroups.ts")
ADMIN_HEALTH_GROUPS_SPEC_TS = os.path.join(ROOT, "app", "lib", "adminHealthGroups.spec.ts")

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


# ---------------------------------------------------------------------------
# Step 1-2: AST-walk engine/ for every real system_alerts.record() call site.
# ---------------------------------------------------------------------------

def _module_aliases(tree):
    """Local names bound to the system_alerts module itself, and local names
    bound directly to its record function (from system_alerts import record
    [as x], including a re-export like `from poll_loop import system_alerts`)."""
    module_names = {"system_alerts"}
    func_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "system_alerts" or alias.name.endswith(".system_alerts"):
                    module_names.add(alias.asname or alias.name.split(".")[-1])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "system_alerts":
                    module_names.add(alias.asname or alias.name)
                elif (node.module or "").split(".")[-1] == "system_alerts" and alias.name == "record":
                    func_names.add(alias.asname or alias.name)
    return module_names, func_names


def _literal_str(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _find_record_calls(path, literal_sources, nonliteral_sites):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        nonliteral_sites.append((path, 0, f"<file failed to parse: {e}>"))
        return
    module_names, func_names = _module_aliases(tree)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        is_record_call = False
        if isinstance(func, ast.Attribute) and func.attr == "record":
            base = func.value
            if isinstance(base, ast.Name) and base.id in module_names:
                is_record_call = True
            elif isinstance(base, ast.Attribute) and base.attr == "system_alerts":
                # Arbitrary-depth chain ending "....system_alerts.record(" -
                # e.g. requirements.py's `scan_ocr.system_alerts.record(...)`,
                # where `system_alerts` is never imported by that name in
                # THIS file at all (it imports `scan_ocr`, which itself does
                # `import system_alerts`). A single-hop-only check is exactly
                # the blind spot that hid "requirements" from every prior
                # manual sweep.
                is_record_call = True
        elif isinstance(func, ast.Name) and func.id in func_names:
            is_record_call = True
        if not is_record_call:
            continue
        if not node.args:
            nonliteral_sites.append((path, node.lineno, "record() called with no positional first arg"))
            continue
        lit = _literal_str(node.args[0])
        if lit is not None:
            literal_sources.setdefault(lit, []).append((path, node.lineno))
        else:
            nonliteral_sites.append((path, node.lineno, ast.dump(node.args[0])[:160]))


def scan_engine_for_record_calls():
    literal_sources = {}
    nonliteral_sites = []
    for dirpath, _dirnames, filenames in os.walk(ENGINE_ROOT):
        if "__pycache__" in dirpath:
            continue
        for fn in filenames:
            if fn.endswith(".py"):
                _find_record_calls(os.path.join(dirpath, fn), literal_sources, nonliteral_sites)
    return literal_sources, nonliteral_sites


# ---------------------------------------------------------------------------
# Resolve the two known indirect-source shapes, by reading their real
# structure directly rather than assuming every non-literal call site is one
# of them.
# ---------------------------------------------------------------------------

def resolve_run_bridges_labels():
    """engine/worker/run_bridges.py passes BRIDGES' own dict keys as the
    source for each bridge's process-level alerts (system_alerts.record(label,
    ...)). Read the real keys of that module-level dict literal."""
    path = os.path.join(ENGINE_ROOT, "worker", "run_bridges.py")
    with open(path, "r", encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=path)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 \
                and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "BRIDGES" \
                and isinstance(node.value, ast.Dict):
            keys = [k.value for k in node.value.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)]
            if len(keys) == len(node.value.keys):
                return set(keys)
    return None  # BRIDGES not found in the shape expected - caller treats as unresolved


def resolve_poll_forever_alert_sources():
    """Every poll_forever(..., alert_source="...") call anywhere in engine/
    is the other place a literal source reaches system_alerts.record()
    indirectly, via engine/worker/poll_loop.py's own generic per-cycle
    failure handler."""
    sources = set()
    for dirpath, _dirnames, filenames in os.walk(ENGINE_ROOT):
        if "__pycache__" in dirpath:
            continue
        for fn in filenames:
            if not fn.endswith(".py"):
                continue
            path = os.path.join(dirpath, fn)
            with open(path, "r", encoding="utf-8") as f:
                try:
                    tree = ast.parse(f.read(), filename=path)
                except SyntaxError:
                    continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "poll_forever":
                    for kw in node.keywords:
                        if kw.arg == "alert_source":
                            lit = _literal_str(kw.value)
                            if lit is not None:
                                sources.add(lit)
    return sources


def is_known_nonliteral_site(path, lineno):
    """The exact call sites this script already accounts for via
    resolve_run_bridges_labels()/resolve_poll_forever_alert_sources() -
    anything else non-literal is a genuine unresolved gap, reported as a
    failure rather than silently ignored."""
    rel = os.path.relpath(path, ROOT)
    if rel == os.path.join("engine", "worker", "run_bridges.py"):
        return True  # the `label` variable, from the BRIDGES dict handled above
    if rel == os.path.join("engine", "worker", "poll_loop.py"):
        return True  # the `alert_source` parameter, forwarded from poll_forever() callers handled above
    return False


# ---------------------------------------------------------------------------
# Step 3-4: read the real TS constants, no eyeballing.
# ---------------------------------------------------------------------------

def read_health_source_groups():
    with open(ADMIN_HEALTH_GROUPS_TS, "r", encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"export const HEALTH_SOURCE_GROUPS[^=]*=\s*\{(.*?)\n\};", src, re.S)
    check(m is not None, "found HEALTH_SOURCE_GROUPS's literal object in adminHealthGroups.ts")
    groups = {}
    for line in m.group(1).splitlines():
        gm = re.match(r'\s*"([^"]+)":\s*\[(.*?)\],?\s*$', line)
        if not gm:
            continue
        name, items = gm.groups()
        groups[name] = re.findall(r'"([^"]+)"', items)
    return groups


def read_real_system_alert_sources_ground_truth():
    with open(ADMIN_HEALTH_GROUPS_SPEC_TS, "r", encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"const REAL_SYSTEM_ALERT_SOURCES\s*=\s*\[(.*?)\];", src, re.S)
    check(m is not None, "found REAL_SYSTEM_ALERT_SOURCES's literal array in adminHealthGroups.spec.ts")
    return set(re.findall(r'"([^"]+)"', m.group(1)))


def main():
    literal_sources, nonliteral_sites = scan_engine_for_record_calls()
    unresolved = [(p, ln, d) for (p, ln, d) in nonliteral_sites if not is_known_nonliteral_site(p, ln)]
    for (p, ln, d) in unresolved:
        print(f"  FAIL unresolved non-literal system_alerts.record() first argument at "
              f"{os.path.relpath(p, ROOT)}:{ln} ({d}) - add a resolver for this shape instead of "
              f"assuming it's covered")
    check(not unresolved, "every non-literal system_alerts.record() call site is one of the two known, "
                           "explicitly-resolved indirections (run_bridges.py's BRIDGES labels, poll_loop.py's "
                           "alert_source forwarding)")

    bridge_labels = resolve_run_bridges_labels()
    check(bridge_labels is not None, "resolved run_bridges.py's BRIDGES dict keys")
    poll_forever_sources = resolve_poll_forever_alert_sources()
    check(len(poll_forever_sources) > 0, "resolved at least one poll_forever(..., alert_source=...) call site")

    real_sources = set(literal_sources) | (bridge_labels or set()) | poll_forever_sources
    print(f"\n  {len(real_sources)} distinct real system_alerts.source values found across engine/: "
          f"{sorted(real_sources)}")

    groups = read_health_source_groups()
    ts_ground_truth = read_real_system_alert_sources_ground_truth()

    # The actual invariant that matters for /admin + /admin/telemetry:
    # every source this script found by reading the real engine/ call sites
    # - not the hand-maintained TS list, which is exactly what has drifted
    # three times - is in exactly one HEALTH_SOURCE_GROUPS group.
    all_grouped = [s for sources in groups.values() for s in sources]
    for source in sorted(real_sources):
        n = sum(1 for sources in groups.values() if source in sources)
        check(n == 1, f'"{source}" (a real system_alerts source found in engine/) is in exactly one '
                      f"HEALTH_SOURCE_GROUPS group, found in {n}")

    # Cross-check the TS test file's own ground-truth list both ways, so a
    # drift between IT and the real engine/ call sites is caught here too,
    # not just between it and HEALTH_SOURCE_GROUPS (which adminHealthGroups.
    # spec.ts's own vitest test already covers).
    missing_from_ts_list = real_sources - ts_ground_truth
    stale_in_ts_list = ts_ground_truth - real_sources
    check(not missing_from_ts_list,
          f"no real engine/ source is missing from adminHealthGroups.spec.ts's own "
          f"REAL_SYSTEM_ALERT_SOURCES ground-truth list (missing: {sorted(missing_from_ts_list)})")
    check(not stale_in_ts_list,
          f"no stale entry in adminHealthGroups.spec.ts's own REAL_SYSTEM_ALERT_SOURCES for a source "
          f"nothing in engine/ raises any more (stale: {sorted(stale_in_ts_list)})")

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
