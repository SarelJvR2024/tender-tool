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
  title: "Tender Tool",
  description: "SANRAL tender discovery, pack generation and document completion",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
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
