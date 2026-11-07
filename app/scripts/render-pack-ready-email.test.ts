// Regression coverage for the exact runtime contract
// engine/notify/send_pack_ready_email.py's _render() depends on:
//
//   subprocess.run(["node", "--experimental-strip-types", RENDER_SCRIPT,
//                   json.dumps(opts)], cwd=APP_DIR, ...)
//
// Finding 152 / System-Status.md 2026-11-07o (PR #181) found that this
// exact path had never actually run inside the production worker image -
// the Dockerfile had no `node` binary and `.dockerignore` excluded the
// whole `app/` directory, so "your bid pack is ready" never sent once.
// That gap was in the *build*, not the script - but nothing anywhere in
// this repo's test suites had ever actually exercised render-pack-ready-
// email.ts the way it is really invoked (as a standalone subprocess under
// `--experimental-strip-types`, with no bundler and no tsc pass to paper
// over a non-erasable import). Every other test of this email
// (packReadyEmail() itself, emailTemplatesTier1 coverage) imports the pure
// template function directly inside the normal Vitest/Next.js module
// graph, which happily resolves a plain `import { X }` even where X is
// only ever used as a type - `--experimental-strip-types` cannot: it has
// no type information at all and can only erase declarations the
// TypeScript syntax itself marks as type-only (`import type { X }`, or
// `type` keyword inline). So a future edit that changes
// `emailTemplatesTier1.ts`'s own `import type { NotificationEmail } from
// "./notificationEngine.ts"` (render-pack-ready-email.ts's one
// npm-importing dependency, @supabase/supabase-js, is only reachable
// through that type-only import) to a plain value import would typecheck
// fine, build fine under Next.js, and pass every existing unit test - and
// then fail exactly the same way Finding 152 did, silently, in production
// only, the moment the worker actually tries to render a real email.
//
// This test spawns the real script as a real child process, the same way
// Python does, and is picked up automatically by app-ci.yml's existing
// per-file *.test.ts loop (which already triggers on any app/** push,
// regardless of whether PR #181's Dockerfile/`.dockerignore` change has
// landed) - so a regression of this specific shape now fails CI directly
// instead of waiting for the next person to notice a missing email.
//
// Run: node --experimental-strip-types app/scripts/render-pack-ready-email.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_SCRIPT = path.join(APP_DIR, "scripts", "render-pack-ready-email.ts");

function runRender(arg?: string) {
  const args = ["--experimental-strip-types", RENDER_SCRIPT, ...(arg !== undefined ? [arg] : [])];
  return spawnSync(process.execPath, args, { cwd: APP_DIR, encoding: "utf8" });
}

test("render-pack-ready-email.ts: renders a real pack-ready email end to end, exactly as the worker invokes it", () => {
  const opts = {
    reference: "RFQ-2026-TT-0421",
    tenderTitle: "Supply and delivery of bulk cement",
    buyerShortName: "City of Tshwane",
    companyName: "Reviewer Civils (Pty) Ltd",
    pageCount: 37,
    appUrl: "https://app.tendertool.co.za",
    tenderId: "tender-1",
  };
  const result = runRender(JSON.stringify(opts));
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(typeof parsed.subject, "string");
  assert.equal(typeof parsed.html, "string");
  assert.equal(typeof parsed.text, "string");
  assert.match(parsed.subject, /RFQ-2026-TT-0421/);
  assert.match(parsed.html, /City of Tshwane/);
  assert.match(parsed.text, /37/);
});

test("render-pack-ready-email.ts: no argv at all exits 1 with a Usage message, not a crash", () => {
  const result = runRender(undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage/);
  assert.equal(result.stdout, "");
});

test("render-pack-ready-email.ts: unparsable JSON exits 1 on stderr, nothing on stdout", () => {
  const result = runRender("{not json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not parse argv\[2\] as JSON/);
  assert.equal(result.stdout, "");
});
