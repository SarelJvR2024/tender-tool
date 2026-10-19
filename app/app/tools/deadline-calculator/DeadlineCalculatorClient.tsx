"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { addBusinessDays, businessDaysBetween, holidaysForYear, isPublicHoliday, isWeekend } from "@/lib/publicHolidays";
import { OtherTools, ToolsHeader } from "../_components/ToolsHeader";

const CARD: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "20px 22px", boxSizing: "border-box" };
const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#16233B", display: "block", marginBottom: 6 };
const INPUT: React.CSSProperties = { width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, boxSizing: "border-box" };

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
    <div style={{ minHeight: "100vh", background: "#F6F5F1", fontFamily: "system-ui, sans-serif" }}>
      <ToolsHeader />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 64px", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 8px" }}>Working-day deadline calculator</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 24px", lineHeight: 1.5 }}>
          Excludes Saturdays, Sundays and South African public holidays (Public Holidays Act 36 of 1994, including the
          Easter-derived Good Friday and Family Day). Use it for &quot;N working days from the briefing&quot; or
          &quot;how many working days until closing&quot; tender clauses.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setMode("add")}
            style={{ flex: 1, minHeight: 40, borderRadius: 8, border: "1px solid #E5E1D5", background: mode === "add" ? "#16233B" : "#FFFFFF", color: mode === "add" ? "#FFFFFF" : "#16233B", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
          >
            Add working days
          </button>
          <button
            onClick={() => setMode("count")}
            style={{ flex: 1, minHeight: 40, borderRadius: 8, border: "1px solid #E5E1D5", background: mode === "count" ? "#16233B" : "#FFFFFF", color: mode === "count" ? "#FFFFFF" : "#16233B", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
          >
            Count working days between dates
          </button>
        </div>

        <div style={{ ...CARD, marginBottom: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL} htmlFor="start">{mode === "add" ? "Start date" : "From date"}</label>
            <input id="start" type="date" value={startDate} onChange={(e) => setStartDateInput(e.target.value)} style={INPUT} />
          </div>

          {mode === "add" ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={LABEL} htmlFor="days">Working days to add (negative to go backwards)</label>
                <input id="days" type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} style={INPUT} />
              </div>
              {addResult.error ? (
                <p style={{ color: "#B91C1C", fontSize: 13 }}>{addResult.error}</p>
              ) : (
                <div style={{ background: "#F6F5F1", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 4 }}>Deadline</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#16233B" }}>{addResult.value}</div>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={LABEL} htmlFor="end">To date</label>
                <input id="end" type="date" value={endDate} onChange={(e) => setEndDateInput(e.target.value)} style={INPUT} />
              </div>
              {countResult.error ? (
                <p style={{ color: "#B91C1C", fontSize: 13 }}>{countResult.error}</p>
              ) : (
                <div style={{ background: "#F6F5F1", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 4 }}>Working days</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#16233B" }}>{countResult.value}</div>
                </div>
              )}
            </>
          )}

          {startDate && (isWeekend(startDate) || isPublicHoliday(startDate)) && (
            <p style={{ fontSize: 12, color: "#B45309", marginTop: 12 }}>
              Note: the start date itself falls on a weekend or public holiday - it is never counted as a working day.
            </p>
          )}
        </div>

        <div style={CARD}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B", marginBottom: 10 }}>Upcoming public holidays</div>
          {upcomingHolidays.length === 0 ? (
            <p style={{ fontSize: 13, color: "#6B6758" }}>None found.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {upcomingHolidays.map((h) => (
                <li key={h.date} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#16233B", padding: "6px 0", borderBottom: "1px solid #F0EEE6" }}>
                  <span>{h.name}</span>
                  <span style={{ color: "#6B6758" }}>{h.date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <OtherTools except="/tools/deadline-calculator" />

        <p style={{ fontSize: 11, color: "#6B6758", marginTop: 24, lineHeight: 1.5 }}>
          Source: Public Holidays Act 36 of 1994, Schedule 1. Fixed-date holidays landing on a Sunday move the
          following Monday to a public holiday (s2A). A one-off holiday gazetted by the President (s2(2))
          isn&apos;t predictable in advance and may not yet be reflected here.
        </p>
      </main>
    </div>
  );
}
