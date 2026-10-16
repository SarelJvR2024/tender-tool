"use client";

import { useState } from "react";

type Props = {
  testCompany: string;
  tenderRef: string;
  status: string;
  runAt: string;
  details: string | null;
};

// Client-only because of the expand/collapse click state - everything else on
// this page is plain server-rendered data, so this is the one small piece that
// needs "use client" (and therefore can't carry the page's `instant = false`).
export default function HarnessRunRow({ testCompany, tenderRef, status, runAt, details }: Props) {
  const [open, setOpen] = useState(false);
  const ok = status === "ok";
  const chip = ok
    ? { bg: "#DCFCE7", color: "#15803D", label: "ok" }
    : { bg: "#FEE2E2", color: "#B91C1C", label: "flagged" };

  return (
    <div style={{ borderTop: "1px solid #F0EEE6" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!details}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "1.4fr 1.6fr 0.8fr 1.3fr",
          gap: 12,
          alignItems: "center",
          padding: "11px 18px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: details ? "pointer" : "default",
          font: "inherit",
        }}
      >
        <div style={{ fontSize: 13, color: "#16233B", fontWeight: 600 }}>{testCompany}</div>
        <div style={{ fontSize: 12, fontFamily: "monospace", color: "#4B5563" }}>{tenderRef}</div>
        <div>
          <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: chip.bg, color: chip.color }}>
            {chip.label}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#9A9684" }}>
          {new Date(runAt).toLocaleString()}
          {details && <span style={{ marginLeft: 6, color: "#D97706" }}>{open ? "hide detail ▲" : "show detail ▼"}</span>}
        </div>
      </button>
      {open && details && (
        <div style={{ padding: "0 18px 14px 18px", fontSize: 12, color: "#4B5563", whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
          {details}
        </div>
      )}
    </div>
  );
}
