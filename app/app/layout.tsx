import type { Metadata } from "next";
import { Fraunces, Inter_Tight } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Design system direction (2026-10-20, "confident & premium"): Fraunces for
// editorial display/heading type, Inter Tight for UI/body - see
// app/AGENTS.md's design-decisions section for the rest of the token
// choices made alongside this.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "variable",
});

const interTight = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: "Tender Ready",
  description: "SANRAL tender discovery, pack generation and document completion",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      // en-ZA (Batch 2B, Sarel's own live feedback): every native <input
      // type="date"> picker in this app (Quick Blocker drawer, milestone/
      // task due-date fields) follows the document's own lang, not the
      // visitor's OS locale - a bare "en" renders the US mm/dd/yyyy order in
      // Chromium regardless of where the visitor actually is. The value
      // submitted was always ISO yyyy-mm-dd either way; this is purely what
      // the picker itself displays.
      lang="en-ZA"
      className={`${fraunces.variable} ${interTight.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider delay={300}>
          {children}
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
