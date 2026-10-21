"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { addBusinessDays, businessDaysBetween, holidaysForYear, isPublicHoliday, isWeekend } from "@/lib/publicHolidays";
import { OtherTools, ToolsHeader } from "../_components/ToolsHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Design-system migration (2026-10-21): raw inline-CSSProperties ->
// Tailwind + tokens. The mode toggle was two hand-rolled <button>s with
// hardcoded navy/white swap for the selected state - replaced with the
// real shadcn Tabs/TabsList/TabsTrigger (already used elsewhere, e.g. the
// Bids board's own Board/List toggle) instead of re-styling the hand-rolled
// version, so the selected-state look/focus ring match every other tab
// control in the app rather than a one-off. The "start date falls on a
// weekend/holiday" and matrix-style notes are real warnings, not errors -
// text-warning, not a 1:1 swap of the old amber hex.
const CARD = "rounded-xl border border-border bg-card p-5";
const LABEL = "mb-1.5 block text-xs font-semibold text-foreground";
const INPUT = "min-h-11 w-full rounded-lg border border-border px-3 text-sm";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function subscribeNever() {
  return () => {};
}

function getServerToday() {
  return "";
}

// Reading the current date has to go through useSyncExternalStore, not a
// plain `new Date()` call in the component body or a setState-in-effect:
// this route is static-prerendered, and Next.js's build rejects a
// prerender-time read of the current time outright. useSyncExternalStore's
// getServerSnapshot (empty string) is what the prerender actually sees;
// `today()` only runs once this is live in a real browser.
export default function DeadlineCalculatorClient() {
  const [mode, setMode] = useState<"add" | "count">("add");
  const clientToday = useSyncExternalStore(subscribeNever, today, getServerToday);
  const [startDateInput, setStartDateInput] = useState("");
  const [days, setDays] = useState(10);
  const [endDateInput, setEndDateInput] = useState("");

  const startDate = startDateInput || clientToday;
  const endDate = endDateInput || clientToday;

  const addResult = useMemo(() => {
    try {
      return { value: addBusinessDays(startDate, days), error: null as string | null };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : "Invalid input" };
    }
  }, [startDate, days]);

  const countResult = useMemo(() => {
    try {
      return { value: businessDaysBetween(startDate, endDate), error: null as string | null };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : "Invalid input" };
    }
  }, [startDate, endDate]);

  const upcomingHolidays = useMemo(() => {
    if (!startDate) return [];
    const year = new Date(startDate + "T00:00:00Z").getUTCFullYear();
    const all = [...holidaysForYear(year), ...holidaysForYear(year + 1)];
    return all.filter((h) => h.date >= startDate).slice(0, 6);
  }, [startDate]);

  return (
    <div className="min-h-screen bg-background">
      <ToolsHeader />

      <main className="mx-auto max-w-[640px] px-4 pt-8 pb-16">
        <h1 className="mb-2 font-display text-[22px] font-bold text-foreground">Working-day deadline calculator</h1>
        <p className="mb-6 text-[13px] leading-relaxed text-muted-foreground">
          Excludes Saturdays, Sundays and South African public holidays (Public Holidays Act 36 of 1994, including the
          Easter-derived Good Friday and Family Day). Use it for &quot;N working days from the briefing&quot; or
          &quot;how many working days until closing&quot; tender clauses.
        </p>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "add" | "count")} className="mb-4">
          <TabsList className="h-11 w-full">
            <TabsTrigger value="add" className="h-full flex-1 text-[13px] font-semibold">
              Add working days
            </TabsTrigger>
            <TabsTrigger value="count" className="h-full flex-1 text-[13px] font-semibold">
              Count working days between dates
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className={`${CARD} mb-5`}>
          <div className="mb-4">
            <label className={LABEL} htmlFor="start">{mode === "add" ? "Start date" : "From date"}</label>
            <input id="start" type="date" value={startDate} onChange={(e) => setStartDateInput(e.target.value)} className={INPUT} />
          </div>

          {mode === "add" ? (
            <>
              <div className="mb-4">
                <label className={LABEL} htmlFor="days">Working days to add (negative to go backwards)</label>
                <input id="days" type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} className={INPUT} />
              </div>
              {addResult.error ? (
                <p className="text-[13px] text-destructive">{addResult.error}</p>
              ) : (
                <div className="rounded-lg bg-card px-4 py-3.5">
                  <div className="mb-1 text-xs text-muted-foreground">Deadline</div>
                  <div className="text-xl font-bold text-foreground">{addResult.value}</div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-4">
                <label className={LABEL} htmlFor="end">To date</label>
                <input id="end" type="date" value={endDate} onChange={(e) => setEndDateInput(e.target.value)} className={INPUT} />
              </div>
              {countResult.error ? (
                <p className="text-[13px] text-destructive">{countResult.error}</p>
              ) : (
                <div className="rounded-lg bg-card px-4 py-3.5">
                  <div className="mb-1 text-xs text-muted-foreground">Working days</div>
                  <div className="text-xl font-bold text-foreground">{countResult.value}</div>
                </div>
              )}
            </>
          )}

          {startDate && (isWeekend(startDate) || isPublicHoliday(startDate)) && (
            <p className="mt-3 text-xs text-warning">
              Note: the start date itself falls on a weekend or public holiday - it is never counted as a working day.
            </p>
          )}
        </div>

        <div className={CARD}>
          <div className="mb-2.5 text-[13px] font-bold text-foreground">Upcoming public holidays</div>
          {upcomingHolidays.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">None found.</p>
          ) : (
            <ul className="list-none">
              {upcomingHolidays.map((h) => (
                <li key={h.date} className="flex justify-between border-b border-border py-1.5 text-[13px] text-foreground last:border-b-0">
                  <span>{h.name}</span>
                  <span className="text-muted-foreground">{h.date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <OtherTools except="/tools/deadline-calculator" />

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          Source: Public Holidays Act 36 of 1994, Schedule 1. Fixed-date holidays landing on a Sunday move the
          following Monday to a public holiday (s2A). A one-off holiday gazetted by the President (s2(2))
          isn&apos;t predictable in advance and may not yet be reflected here.
        </p>
      </main>
    </div>
  );
}
