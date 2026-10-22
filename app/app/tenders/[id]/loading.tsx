import { SectionCardSkeleton, StatCardSkeleton, TableRowsSkeleton } from "@/components/tt/skeletons";

/**
 * Next's automatic route-segment loading state for /tenders/[id] - shown
 * only on the first navigation to a tender, while the page's own (uncached)
 * server read runs. Shaped like this page's real layout - facts header, the
 * 3 Fix/Provide/Verify-ish report groups, a Pack Review-shaped table - using
 * only existing components/tt/skeletons.tsx primitives, so nothing new is
 * invented here, just composed to this page's own shape.
 */
export default function TenderWorkspaceLoading() {
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px" }}>
      {/* Tender facts header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* 3 Fix/Provide/Verify-shaped groups */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 16 }}>
        <SectionCardSkeleton lines={3} />
        <SectionCardSkeleton lines={3} />
        <SectionCardSkeleton lines={3} />
      </div>

      {/* Pack review -shaped table */}
      <div style={{ marginBottom: 16 }}>
        <TableRowsSkeleton rows={5} columns={3} />
      </div>
    </div>
  );
}
