"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { sendTestNotificationEmail } from "./actions";

export type GalleryItem = {
  key: string;
  label: string;
  tier: string;
  category: string;
  subject: string;
  html: string;
  text: string;
};

const TIER_ORDER = ["Tier 0", "Tier 1", "Tier 2", "Tier 3"];
const TIER_DESCRIPTION: Record<string, string> = {
  "Tier 0": "Onboarding & lifecycle",
  "Tier 1": "Tender operational alerts",
  "Tier 2": "Compliance & vault alerts",
  "Tier 3": "Founder & Quality Scout",
};

export function TemplateGalleryTab({ items, sentMessage, errorMessage }: { items: GalleryItem[]; sentMessage: string | null; errorMessage: string | null }) {
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  return (
    <>
      <p className="mb-4 text-[13px] text-muted-foreground">
        One realistic sample of every template this engine actually sends - {items.length} in total, grouped by
        tier. Preview any of them, or send a real test copy to your own inbox.
      </p>

      {sentMessage && (
        <div className="mb-4 rounded-lg border border-success/20 bg-success/10 px-4 py-2.5 text-[13px] text-success">
          Sent &ldquo;{sentMessage}&rdquo; to your own inbox - check the Dispatch Log tab once it lands.
        </div>
      )}
      {errorMessage && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
          {errorMessage}
        </div>
      )}

      {TIER_ORDER.map((tier) => {
        const tierItems = items.filter((i) => i.tier === tier);
        if (tierItems.length === 0) return null;
        return (
          <div key={tier} className="mb-5">
            <h2 className="mb-2 text-[13px] font-semibold text-foreground">
              {tier} <span className="font-normal text-muted-foreground">- {TIER_DESCRIPTION[tier]}</span>
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
              {tierItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => { setSelected(item); setViewport("desktop"); }}
                  className="min-h-11 rounded-lg border border-border bg-card p-3 text-left hover:border-accent"
                >
                  <div className="text-[13px] font-semibold text-foreground">{item.label}</div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground" title={item.subject}>{item.subject}</div>
                  <span className="mt-2 inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
                    {item.category}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{selected?.label}</SheetTitle>
            <SheetDescription>{selected?.subject}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-3 overflow-y-auto px-4">
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={viewport === "desktop" ? "default" : "outline"} onClick={() => setViewport("desktop")}>
                  Desktop
                </Button>
                <Button type="button" size="sm" variant={viewport === "mobile" ? "default" : "outline"} onClick={() => setViewport("mobile")}>
                  Mobile
                </Button>
              </div>
              <div className="overflow-hidden rounded-lg border border-border bg-muted/30 p-3" style={{ display: "flex", justifyContent: "center" }}>
                <iframe
                  title={`Preview of ${selected.label}`}
                  srcDoc={selected.html}
                  sandbox=""
                  style={{ width: viewport === "desktop" ? "600px" : "375px", height: "480px", border: "none", background: "white" }}
                />
              </div>
            </div>
          )}
          <SheetFooter>
            <form action={sendTestNotificationEmail} className="flex items-center gap-2.5">
              <input type="hidden" name="template_key" value={selected?.key ?? ""} />
              <Button type="submit" size="sm">Send Test to Me</Button>
              <span className="text-[11px] text-muted-foreground">Sends to your own signed-in email, with sample data - never a real customer.</span>
            </form>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
