"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Award, FileSearch, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/tt/page-header";
import { SectionCard } from "@/components/tt/section-card";
import { StatCard } from "@/components/tt/stat-card";
import { StatusBadge, type TenderStatus } from "@/components/tt/status-badge";
import { DeadlineChip } from "@/components/tt/deadline-chip";
import { EmptyState } from "@/components/tt/empty-state";
import { ProgressRing } from "@/components/tt/progress-ring";
import { Stepper } from "@/components/tt/stepper";
import { DataTable, type DataTableColumn } from "@/components/tt/data-table";
import { StatCardSkeleton, SectionCardSkeleton, TableRowsSkeleton, TextSkeleton } from "@/components/tt/skeletons";

const STATUSES: TenderStatus[] = ["draft", "needs-docs", "in-progress", "ready", "submitted", "won", "lost", "expired"];

const SWATCHES: { name: string; className: string; fg?: string }[] = [
  { name: "background", className: "bg-background border border-border", fg: "text-foreground" },
  { name: "foreground", className: "bg-foreground", fg: "text-background" },
  { name: "card", className: "bg-card border border-border", fg: "text-card-foreground" },
  { name: "muted", className: "bg-muted", fg: "text-muted-foreground" },
  { name: "border", className: "bg-border", fg: "text-foreground" },
  { name: "primary", className: "bg-primary", fg: "text-primary-foreground" },
  { name: "accent", className: "bg-accent", fg: "text-accent-foreground" },
  { name: "success", className: "bg-success", fg: "text-success-foreground" },
  { name: "warning", className: "bg-warning", fg: "text-warning-foreground" },
  { name: "destructive", className: "bg-destructive", fg: "text-destructive-foreground" },
  { name: "info", className: "bg-info", fg: "text-info-foreground" },
  { name: "chart-1", className: "bg-chart-1", fg: "text-primary-foreground" },
  { name: "chart-2", className: "bg-chart-2", fg: "text-accent-foreground" },
  { name: "chart-3", className: "bg-chart-3", fg: "text-primary-foreground" },
  { name: "chart-4", className: "bg-chart-4", fg: "text-primary-foreground" },
  { name: "chart-5", className: "bg-chart-5", fg: "text-primary-foreground" },
];

type DemoRow = { id: string; tender: string; buyer: string; status: TenderStatus; daysLeft: number };

const DEMO_ROWS: DemoRow[] = [
  { id: "1", tender: "N3 Mariannhill upgrade", buyer: "SANRAL", status: "in-progress", daysLeft: 9 },
  { id: "2", tender: "Route R396 Section 10", buyer: "SANRAL", status: "ready", daysLeft: 18 },
  { id: "3", tender: "Pavement rehabilitation, R61", buyer: "SANRAL", status: "submitted", daysLeft: -2 },
  { id: "4", tender: "Stormwater upgrade, Gqeberha", buyer: "Nelson Mandela Bay Municipality", status: "won", daysLeft: -40 },
];

const DEMO_COLUMNS: DataTableColumn<DemoRow>[] = [
  { key: "tender", header: "Tender", render: (r) => <span className="font-medium text-foreground">{r.tender}</span> },
  { key: "buyer", header: "Buyer", render: (r) => r.buyer },
  { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  { key: "deadline", header: "Deadline", align: "right", render: (r) => <DeadlineChip daysLeft={r.daysLeft} /> },
];

export function DesignSystemShowcase() {
  const [stepperStep] = useState(1);

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-6 py-10 sm:px-10">
      <PageHeader
        title="Tender Tool design system"
        description="Dev-only reference for every token and shared component - not linked from the app's own navigation. Nothing on this page reads or writes real data."
        actions={<Badge variant="outline">dev only</Badge>}
      />

      <Section title="Color tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SWATCHES.map((s) => (
            <div key={s.name} className={`flex h-20 flex-col justify-end rounded-lg p-2.5 ${s.className}`}>
              <span className={`text-xs font-medium ${s.fg ?? "text-foreground"}`}>{s.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography" description="Fraunces for display/headings, Inter Tight for everything else.">
        <div className="space-y-3">
          <h1 className="font-display text-4xl font-medium tracking-tight">Confident, premium, editorial</h1>
          <h2 className="font-display text-2xl font-medium tracking-tight">A section heading in Fraunces</h2>
          <h3 className="font-display text-lg font-medium">A card title, same family, smaller</h3>
          <p className="text-base text-foreground">
            Body copy is Inter Tight - quiet, legible, gets out of the way. This is roughly how a paragraph of real
            content will read: tender descriptions, help text, form labels.
          </p>
          <p className="text-sm text-muted-foreground">Muted text, for secondary detail and captions.</p>
        </div>
      </Section>

      <Section title="Elevation &amp; surface">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-card p-4 text-sm shadow-sm">shadow-sm</div>
          <div className="rounded-lg bg-card p-4 text-sm shadow-md">shadow-md</div>
          <div className="rounded-lg bg-card p-4 text-sm shadow-lg">shadow-lg</div>
        </div>
        <div className="mt-4 flex h-32 items-end rounded-lg bg-hero p-4 text-sm font-medium text-primary-foreground">
          gradient-hero
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default size</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Status &amp; deadlines">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <DeadlineChip daysLeft={21} />
          <DeadlineChip daysLeft={10} />
          <DeadlineChip daysLeft={3} />
          <DeadlineChip daysLeft={-5} />
        </div>
      </Section>

      <Section title="Cards &amp; stats">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Open tenders" value={14} icon={FolderOpen} trend={{ value: "+3 this week", direction: "up" }} />
          <StatCard label="Closing soon" value={5} icon={FileSearch} />
          <StatCard label="Win rate" value="38%" icon={Award} trend={{ value: "-4%", direction: "down" }} />
          <StatCard label="Submitted" value={22} />
        </div>
        <SectionCard
          className="mt-4"
          title="Compliance documents"
          description="The 6 documents every pack is checked against"
          actions={
            <Button variant="outline" size="sm">
              Edit
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground">Section body content goes here - a list, a form, a table.</p>
        </SectionCard>
      </Section>

      <Section title="Progress">
        <div className="flex flex-wrap items-center gap-8">
          <ProgressRing value={72} />
          <ProgressRing value={40} color="warning" />
          <ProgressRing value={95} color="success" />
          <div className="min-w-48 flex-1">
            <Progress value={64}>
              <div className="flex justify-between text-sm">
                <span className="font-medium">Pack readiness</span>
                <span className="text-muted-foreground">64%</span>
              </div>
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
            </Progress>
          </div>
        </div>
      </Section>

      <Section title="Stepper">
        <Stepper
          current={stepperStep}
          steps={[
            { label: "Company details", description: "Vault documents" },
            { label: "Key positions", description: "Who's confirmed" },
            { label: "Pack review", description: "Confirm before compiling" },
            { label: "Submit" },
          ]}
        />
      </Section>

      <Section title="Data table">
        <DataTable columns={DEMO_COLUMNS} rows={DEMO_ROWS} rowKey={(r) => r.id} />
      </Section>

      <Section title="Empty state">
        <div className="rounded-lg border border-dashed border-border">
          <EmptyState
            icon={FolderOpen}
            title="No tenders yet"
            description="Tenders you load manually or pick up from Discovery will show up here."
            action={<Button>Load a tender</Button>}
          />
        </div>
      </Section>

      <Section title="Forms &amp; tabs">
        <Tabs defaultValue="details" className="max-w-md">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="design-demo-name">Legal name</Label>
              <Input id="design-demo-name" placeholder="Klipcorp (Pty) Ltd" />
            </div>
            <Separator />
            <Button
              onClick={() =>
                toast.success("Saved", { description: "This is a sonner toast, wired up globally in app/layout.tsx." })
              }
            >
              Trigger a toast
            </Button>
          </TabsContent>
          <TabsContent value="documents" className="pt-4 text-sm text-muted-foreground">
            Document list goes here.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Skeletons">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCardSkeleton />
          <SectionCardSkeleton />
        </div>
        <TextSkeleton className="mt-4" />
        <TableRowsSkeleton className="mt-4" />
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-medium text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
      <Separator />
    </section>
  );
}
