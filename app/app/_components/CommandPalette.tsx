"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { ADMIN_NAV_ITEM, EMPLOYEE_NAV_ITEMS, NAV_ITEMS } from "./nav-items";
import { searchTenders, type TenderSearchResult } from "./search-tenders";

/**
 * Pages/actions are filtered client-side against the typed query; tenders
 * come from a real search (searchTenders, debounced) because contract
 * numbers aren't a fixed list that could ever be preloaded. shouldFilter is
 * off throughout - cmdk's own fuzzy filter would otherwise re-filter (and
 * sometimes hide) the server's own already-matched tender rows.
 *
 * isEmployee (migration 0067): the sidebar's own nav cutdown means nothing
 * if Cmd/Ctrl+K can still jump straight to every page and search every
 * tender - RLS blocks the underlying data either way, but offering a search
 * that can only ever come back empty is confusing, same reasoning as the
 * sidebar's own comment (nav-items.ts).
 */
export function CommandPalette({
  isPlatformAdmin,
  isEmployee,
  open,
  onOpenChange,
}: {
  isPlatformAdmin: boolean;
  isEmployee: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TenderSearchResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const requestId = useRef(0);

  // Reset happens on the close event itself (an event handler, not an
  // effect) - CommandPalette stays mounted while closed, so without this
  // the next open would briefly show the last query's stale results.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setResults([]);
    }
    onOpenChange(next);
  }

  useEffect(() => {
    if (isEmployee) return;
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++requestId.current;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const rows = await searchTenders(q);
        if (requestId.current === id) setResults(rows);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query, isEmployee]);

  const items = isEmployee ? EMPLOYEE_NAV_ITEMS : isPlatformAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  const needle = query.trim().toLowerCase();
  const pageMatches = needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  const actionMatches = !isEmployee && (!needle || "load a tender manually".includes(needle));
  // Derived, not stored: avoids a synchronous setResults([]) in the effect
  // above just to hide stale rows once the query drops below 2 characters.
  const displayedResults = isEmployee || needle.length < 2 ? [] : results;

  function go(href: string) {
    handleOpenChange(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} title="Jump to" description="Jump to a page or a tender by contract number">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Jump to a page, or search a tender by contract no..." value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{isPending ? "Searching..." : "Nothing found."}</CommandEmpty>
          {pageMatches.length > 0 && (
            <CommandGroup heading="Pages">
              {pageMatches.map((item) => (
                <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {actionMatches && (
            <CommandGroup heading="Actions">
              <CommandItem value="load-a-tender" onSelect={() => go("/tenders/new")}>
                <FilePlus2 />
                Load a tender manually
              </CommandItem>
            </CommandGroup>
          )}
          {displayedResults.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Tenders">
                {displayedResults.map((t) => (
                  <CommandItem key={t.id} value={`tender-${t.id}`} onSelect={() => go(`/tenders/${t.id}`)}>
                    <span className="font-mono text-xs font-semibold">{t.contract_no ?? "(no reference)"}</span>
                    <span className="truncate text-muted-foreground">{t.description}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
