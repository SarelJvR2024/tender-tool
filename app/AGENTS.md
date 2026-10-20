<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Design system decisions

- Direction is "confident & premium": deep navy ink, one warm gold accent, Fraunces for display/headings, Inter Tight for UI/body - see app/globals.css for the full token set.
- shadcn/ui is on the current `shadcn@latest` "Nova" preset (Base UI primitives, not Radix) and the `cn` npm package, not a hand-rolled `clsx`+`tailwind-merge` `cn()` - that's what `shadcn init` wires up by default now.
- Gold (`accent`) is reserved for the single most important action or highlight on a screen, not a general-purpose second color - it is not a "secondary blue".
- Every status/semantic color pairs with dark-ink or white text chosen for contrast at that color's lightness, not a blanket white-on-color rule (see `accent-foreground` = ink, not white).
- Badges/status chips use a soft 10%-tint style (bg/10, full-strength text, /20 border) everywhere, including the two outcome states (won/lost) - no solid-fill badges, for a consistent, non-shouty tone.
- Shadows are navy-tinted (`oklch(... 264 / N%)`), not black - elevation should read as "lifted off the warm page", not a generic UI-kit drop shadow.
- `.dark` tokens exist and are complete, but nothing adds the `dark` class anywhere - no toggle was built. Don't treat its presence as a signal that dark mode is live.
- `/design` (app/app/design) is the live reference for every token and component - dev-only, 404s when `NODE_ENV=production`, and is deliberately not linked from SiteNav.
- No existing app page has been migrated to this system yet - it coexists with the inline-CSSProperties app until pages are migrated one prompt at a time.
