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

### Dashboard migration (prompt 2)

- `/dashboard` is migrated; `SiteNav` (the shared top bar every page mounts) deliberately was not - it's a separate migration unit spanning the whole app, not part of "migrate the dashboard". Until SiteNav itself is migrated, every newly-migrated page will show a visible seam between its own navy ink and SiteNav's old amber (#D97706) active-tab color and old Civic Navy (#16233B, close to but not identical to the new ink) - known and expected, not a bug to chase per-page.
- Added a `Button` `variant="accent"` (gold `bg-accent`/`text-accent-foreground`) - the original dashboard's one amber CTA ("Load a tender manually") was already treating that button as the screen's single most important action, exactly the job `accent` is reserved for. shadcn's own default variant set has no accent option, so this was added to `components/ui/button.tsx` directly rather than worked around with a one-off className per call site, since any future migrated page's primary CTA will want the same thing.
- shadcn's built-in button sizes top out at `lg` (36px) - below this app's existing 40-44px touch-target convention for a primary action, re-affirmed on a screen checked constantly on a phone. Bumped with `className="min-h-10"` rather than inventing a new named size; revisit if a real fourth size turns out to be needed across more than one migrated page.
- `StatusBadge`/status mapping preserves the dashboard's exact original wording ("Complete", "Needs your input") via its `children` override, even though the variant's own default label differs ("Ready", "In progress") - the migration changes how a status looks, never its words, unless asked.
- The original showed a past deadline as literal negative text ("-48 days left"); `DeadlineChip`'s existing "Closed" state fixed that for free, by simply using the shared component as designed - noted as a side-effect of the migration, not a separate ask.
- `StatCard` gained an optional `tone` prop (colors the value itself: default/success/warning/destructive) and `EmptyState`'s `description` was widened from `string` to `ReactNode` (so a sentence with inline links, like the dashboard's empty-state copy, doesn't need rewriting into a different shape) - both small, backward-compatible extensions made in service of a real migration, not speculative.
