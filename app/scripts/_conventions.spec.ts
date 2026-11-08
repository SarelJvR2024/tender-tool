// Structural guard for the exact bug shape that caused GitHub Actions'
// app-ci "verify" job to be red for 28 consecutive runs (#270-#297,
// 2026-11-07/08, root-caused and fixed in 0e1714d - see
// docs/specs/System-Status.md's "2026-11-08lix" entry and
// docs/specs/QA-Edge-Case-Findings.md): a scripts/*.ts file calling its own
// main()-style entry-point function unconditionally AT MODULE SCOPE,
// outside the `if (import.meta.url === \`file://${process.argv[1]}\`)`
// guard every scripts/send-*.ts file now correctly uses. That bare call
// runs as a side effect the moment ANYTHING imports the file for its other,
// pure, testable exports - which is exactly what
// send-founder-digest.spec.ts and send-onboarding-nudges.spec.ts already
// did, every single time vitest touched them, and which fired
// `process.exit(1)` deep inside an import, mid test-run, in CI.
//
// This test parses every app/scripts/*.ts file (excluding its own
// *.spec.ts/*.test.ts siblings) with the real TypeScript compiler - not a
// regex, so string/template-literal contents and nested callbacks can't
// confuse it - and fails if a locally-declared function is called,
// unconditionally, at the top level of the module, OUTSIDE an
// `if (import.meta.url === ...)` guard, AND that same file is statically
// imported from anywhere else under app/.
//
// The second condition is deliberate, not an oversight. Two files in this
// exact directory have a legitimately different entry-point shape and
// would be false positives under a naive "no bare top-level call, ever"
// rule:
//   - render-pack-ready-email.ts calls its own main() unconditionally with
//     NO guard at all - but nothing ever imports it as an ES module. It is
//     only ever invoked as a standalone child process (by
//     render-pack-ready-email.test.ts's spawnSync(), and in production by
//     engine/notify/send_pack_ready_email.py's subprocess.run()), so its
//     unconditional main() call can never run as an unwanted import side
//     effect - that IS the correct shape for a script that is always run,
//     never imported.
//   - render-email-samples.ts has no guard and no main() function at all
//     (it's a flat top-to-bottom script with no importable pure helpers),
//     so there is nothing for this check to flag in the first place.
// Both are confirmed, not assumed: grepping the whole app/ tree finds no
// `import ... from ".../render-pack-ready-email.ts"` or
// ".../render-email-samples.ts"` anywhere outside comments.
//
// Verified red-then-green against real git history, not just reasoned
// about (see the commit that added this file for the full transcript):
// temporarily overwriting send-founder-digest.ts with its own pre-fix
// content (`git show 0e1714d~1:app/scripts/send-founder-digest.ts` - the
// exact revision that broke CI) makes this test fail, naming that file and
// its importer (send-founder-digest.spec.ts); restoring the real file
// makes it pass again.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPTS_DIR, "..");

/** Both substrings must appear in an `if (...)`'s condition for it to count as the established entry-point guard - matched on text, not a rigid AST shape, so harmless variation (added whitespace, a `?.`) doesn't false-negative. */
const GUARD_MARKERS = ["import.meta.url", "process.argv[1]"];

function isGuardIf(stmt: ts.Statement, sourceFile: ts.SourceFile): boolean {
  if (!ts.isIfStatement(stmt)) return false;
  const conditionText = stmt.expression.getText(sourceFile);
  return GUARD_MARKERS.every((marker) => conditionText.includes(marker));
}

function topLevelFunctionNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) names.add(stmt.name.text);
  }
  return names;
}

/** Bare top-level calls (i.e. not inside a guard `if`) to a function declared in this same file - e.g. `main();` or `main().catch(...)` sitting directly at module scope. Deliberately scoped to top-level EXPRESSION STATEMENTS only (`main();`, `void main()`, `main().catch(...)`) - a FunctionDeclaration is itself a top-level statement too, and its own body is full of ordinary calls to this file's other locally-declared helpers (e.g. `main()`'s body calling `countNewSignups24h()`) that must never be flagged; those live inside the function body, not at module scope, no matter how this scan is written. */
function bareTopLevelEntryCalls(sourceFile: ts.SourceFile): string[] {
  const localNames = topLevelFunctionNames(sourceFile);
  const found: string[] = [];
  for (const stmt of sourceFile.statements) {
    if (isGuardIf(stmt, sourceFile)) continue; // the correct, safe shape - never flag what's inside it
    if (!ts.isExpressionStatement(stmt)) continue; // only a bare expression at module scope can be the bug shape
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && localNames.has(node.expression.text)) {
        found.push(node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(stmt.expression);
  }
  return found;
}

/** Every *.ts/*.tsx file under `dir`, recursively, skipping build/dependency output. */
function listAppTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listAppTsFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Which files (if any) under app/ statically `import ... from` targetFile by a relative specifier - the exact mechanism that turns an unguarded top-level call into an unwanted side effect. */
function importersOf(targetFile: string, allFiles: string[]): string[] {
  const targetDir = path.dirname(targetFile);
  const targetBase = path.basename(targetFile, ".ts");
  const importers: string[] = [];
  const importRe = /\bfrom\s+["']([^"']+)["']/g;
  for (const file of allFiles) {
    if (file === targetFile) continue;
    const text = readFileSync(file, "utf8");
    importRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(text))) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // only a relative import can reach a scripts/*.ts file
      const resolved = path.resolve(path.dirname(file), spec);
      const resolvedBase = resolved.endsWith(".ts") ? resolved.slice(0, -3) : resolved;
      if (resolvedBase === path.join(targetDir, targetBase)) importers.push(path.relative(APP_DIR, file));
    }
  }
  return importers;
}

const scriptFiles = readdirSync(SCRIPTS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts") && !f.endsWith(".test.ts"))
  .map((f) => path.join(SCRIPTS_DIR, f))
  .sort();

describe("app/scripts/*.ts: no unguarded module-scope entry-point call reachable via import", () => {
  it("found the known script files, so this sweep isn't silently scanning nothing", () => {
    // Guards this test itself against a future rename/move of scripts/ that would
    // otherwise make every check below pass vacuously, for the wrong reason.
    expect(scriptFiles.length).toBeGreaterThanOrEqual(10);
    expect(scriptFiles.some((f) => f.endsWith("send-founder-digest.ts"))).toBe(true);
    expect(scriptFiles.some((f) => f.endsWith("send-onboarding-nudges.ts"))).toBe(true);
  });

  const allAppFiles = listAppTsFiles(APP_DIR);

  for (const file of scriptFiles) {
    const name = path.basename(file);
    it(`${name}: an unguarded top-level entry-point call is only safe if nothing imports this file`, () => {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const bareCalls = bareTopLevelEntryCalls(sourceFile);
      if (bareCalls.length === 0) {
        // The common, correct case: either the guard is used (send-*.ts), or there's
        // no locally-declared entry-point function to call bare at all (render-email-samples.ts).
        expect(bareCalls).toEqual([]);
        return;
      }
      const importers = importersOf(file, allAppFiles);
      if (importers.length > 0) {
        throw new Error(
          `${name} calls ${[...new Set(bareCalls)].join(", ")}() unconditionally at module scope, ` +
            `outside an "if (import.meta.url === \`file://\${process.argv[1]}\`)" guard, AND is ` +
            `imported from: ${importers.join(", ")}. This is the exact shape that caused the 28-run ` +
            `app-ci red streak fixed in 0e1714d - the bare call fires as a side effect of the import. ` +
            `Wrap it: if (import.meta.url === \`file://\${process.argv[1]}\`) { ${bareCalls[0]}(); }`
        );
      }
      // Not imported anywhere (e.g. render-pack-ready-email.ts, only ever spawned
      // as a child process) - a legitimately different, safe entry-point shape.
      expect(importers).toEqual([]);
    });
  }
});
