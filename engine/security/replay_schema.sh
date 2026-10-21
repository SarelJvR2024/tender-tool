#!/usr/bin/env bash
# Replays the minimal Supabase stand-in (scratch_supabase_stub.sql) and then
# every migration in app/supabase/migrations/, in filename order, against a
# FRESH, EMPTY database (the seed data these tests insert is not idempotent -
# never reuse a database across runs).
#
# Usage: replay_schema.sh <psql connection args...>
#   engine/security/replay_schema.sh -h 127.0.0.1 -p 5432 -U postgres -d tenant_iso
#
# Used by .github/workflows/bridge-worker-ci.yml's tenant-isolation-db job to
# build the database TENANT_PSQL points at. Also usable by hand, the same
# way engine/security/test_tenant_isolation.py's own module docstring and
# docs/specs/POPIA-Security-Audit.md's "How to re-run" section describe.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$ROOT/app/supabase/migrations"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <psql connection args...>" >&2
  exit 2
fi

PSQL=(psql "$@" -v ON_ERROR_STOP=1 -q)

echo "== Applying minimal Supabase auth/storage stand-in =="
"${PSQL[@]}" -f "$HERE/scratch_supabase_stub.sql"

echo "== Replaying migrations from $MIGRATIONS =="
shopt -s nullglob
files=("$MIGRATIONS"/*.sql)
if [ "${#files[@]}" -eq 0 ]; then
  echo "no migration files found under $MIGRATIONS" >&2
  exit 1
fi
for f in "${files[@]}"; do
  echo "  -> $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "== Schema replay complete ($((${#files[@]})) migrations) =="
