# Start here

This repo is worked on by multiple Claude Code sessions, often concurrently. Before doing
anything else:

1. Read `docs/specs/System-Status.md` in full. It is the standing, cross-session record of
   **current real state** - what's actually built, what's actually verified, what's inconsistent
   between different sessions' work, and what's open for Sarel's own judgment call. It is not a
   history (`git log` is that) and not the phased feature-list spec
   (`docs/strategy/Tender-Tool-Competitor-Feature-Deep-Dive.md` is that). It is maintained by the
   standing solution-architect review pass - keep it that way: update it, don't replace it, and
   never leave a real finding only in chat.
2. If a "Resume here" block exists at the very top of `docs/specs/System-Status.md`, that's a live
   handover from another session mid-task - read it before planning your own work, since it may be
   exactly what you were just asked to continue.
3. `git fetch origin main` and check for other sessions' work in flight (open PRs, recent commits)
   before starting - this repo has had multiple agents working the same codebase at once; don't
   silently duplicate or collide with another session's uncommitted direction.

`app/AGENTS.md` (inside the Next.js app itself) has the product's own design rules and
conventions - read that too once you're working inside `app/`.

Writing or changing any call to an LLM (a new engine, a new field extraction, anything that
generates a document or submission content)? Read `docs/specs/AI-Call-Quality-Standard.md` first -
a generic, one-size prompt and a single-pass "take the first answer" call both fail this
standard, whatever else the code does right.
