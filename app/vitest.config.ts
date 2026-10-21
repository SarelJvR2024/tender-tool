import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberately scoped to *.spec.ts only - every existing test in this repo
// is a *.test.ts file run via `node --experimental-strip-types --test`
// (see app-ci.yml's own comment on why), not vitest. Letting vitest's
// default discovery also pick up *.test.ts would try to execute those
// node:test-based files under vitest's runner, which doesn't understand
// node:test's test() the way node --test does. *.spec.ts is this repo's new,
// separate convention for vitest-based unit tests - started with
// lib/readiness.spec.ts.
export default defineConfig({
  test: {
    include: ["**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
  resolve: {
    // Mirrors tsconfig.json's own "@/*": ["./*"] - vitest doesn't read
    // tsconfig paths on its own, so without this any *.spec.ts covering
    // app code that imports via the "@/" alias (rather than a relative
    // path, as lib/readiness.spec.ts's target happens to) fails to resolve.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
