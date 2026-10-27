"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export type DispatchLogRow = {
  id: string;
  notification_type: string;
  recipient_email: string;
  company_id: string | null;
  tender_id: string | null;
  subject: string;
  status: "sent" | "failed" | "skipped_no_api_key";
  resend_id: string | null;
  error: string | null;
  sent_at: string;
  idempotency_key: string;
  typeLabel: string;
  tierLabel: string;
  category: string;
  sentAtDisplay: string;
};

const STATUS_LABEL: Record<DispatchLogRow["status"], string> = {
  sent: "Delivered",
  failed: "Failed",
  skipped_no_api_key: "Skipped (no API key)",
};
const STATUS_CHIP_CLASS: Record<DispatchLogRow["status"], string> = {
  sent: "bg-success/10 text-success border-success/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  skipped_no_api_key: "bg-warning/10 text-warning border-warning/20",
};
const CATEGORY_CHIP_CLASS: Record<string, string> = {
  system: "bg-muted text-muted-foreground border-border",
  ops: "bg-accent/10 text-accent border-accent/20",
  compliance: "bg-warning/10 text-warning border-warning/20",
  scout: "bg-destructive/10 text-destructive border-destructive/20",
};

export function DispatchLogTab({ rows, rowsShown }: { rows: DispatchLogRow[]; rowsShown: number }) {
  const [selected, setSelected] = useState<DispatchLogRow | null>(null);
  const sentCount = rows.filter((r) => r.status === "sent").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;

  return (
    <>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Every email Resend was asked to send, across Tier 0 (onboarding), Tier 1 (tender operations), Tier 2
        (compliance) and Tier 3 (founder/Scout) - most recent {rowsShown} first.{" "}
        {rows.length > 0 ? `${sentCount} delivered, ${failedCount} failed, of ${rows.length} shown.` : ""}
      </p>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 && <div className="p-4.5 text-[13px] text-muted-foreground">No notifications sent yet.</div>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                  <th className="px-4.5 py-2 font-semibold">Sent (SAST)</th>
                  <th className="px-4.5 py-2 font-semibold">Recipient</th>
                  <th className="px-4.5 py-2 font-semibold">Template</th>
                  <th className="px-4.5 py-2 font-semibold">Category</th>
                  <th className="px-4.5 py-2 font-semibold">Tier</th>
                  <th className="px-4.5 py-2 font-semibold">Status</th>
                  <th className="px-4.5 py-2 font-semibold">Resend message ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">{r.sentAtDisplay}</td>
                    <td className="max-w-[220px] truncate px-4.5 py-2 text-foreground" title={r.recipient_email}>{r.recipient_email}</td>
                    <td className="px-4.5 py-2 text-foreground">{r.typeLabel}</td>
                    <td className="whitespace-nowrap px-4.5 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${CATEGORY_CHIP_CLASS[r.category] ?? CATEGORY_CHIP_CLASS.system}`}>
                        {r.category}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">{r.tierLabel}</td>
                    <td className="whitespace-nowrap px-4.5 py-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CHIP_CLASS[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="max-w-[160px] truncate px-4.5 py-2 font-mono text-[11px] text-muted-foreground" title={r.resend_id ?? undefined}>
                      {r.resend_id ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected?.typeLabel}</SheetTitle>
            <SheetDescription>{selected?.subject}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-3 overflow-y-auto px-4 text-[13px]">
              <Row label="Status">
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CHIP_CLASS[selected.status]}`}>
                  {STATUS_LABEL[selected.status]}
                </span>
              </Row>
              <Row label="Sent">{selected.sentAtDisplay}</Row>
              <Row label="Recipient">{selected.recipient_email}</Row>
              <Row label="Category">{selected.category}</Row>
              <Row label="Tier">{selected.tierLabel}</Row>
              <Row label="Notification type">{selected.notification_type}</Row>
              <Row label="Idempotency key"><span className="break-all font-mono text-[11px]">{selected.idempotency_key}</span></Row>
              <Row label="Resend message ID">
                {selected.resend_id ? <span className="break-all font-mono text-[11px]">{selected.resend_id}</span> : "—"}
              </Row>
              <Row label="Company ID">{selected.company_id ?? "—"}</Row>
              <Row label="Tender ID">{selected.tender_id ?? "—"}</Row>
              {selected.error && (
                <Row label="Error">
                  <span className="break-all text-destructive">{selected.error}</span>
                </Row>
              )}
              <div className="mt-2 rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                This log only records metadata about the send (recipient, subject, status, Resend ID) - the exact
                HTML body of a historical send isn&apos;t stored anywhere and can&apos;t be shown here. Use the
                Template Gallery tab to preview this template&apos;s current rendering.
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-foreground">{children}</span>
    </div>
  );
}
