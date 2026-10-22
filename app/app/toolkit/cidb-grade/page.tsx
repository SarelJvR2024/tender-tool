import Link from "next/link";
import { AppShell } from "../../_components/AppShell";
import { PageHeader } from "@/components/tt/page-header";
import CidbGradeClient from "../../tools/cidb-grade/CidbGradeClient";

export const metadata = {
  title: "CIDB grade calculator - Tender Ready",
};

export default function Page() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <Link href="/toolkit" className="text-sm text-muted-foreground no-underline">
          ← Tools
        </Link>
        <PageHeader title="CIDB grade calculator" />
        <CidbGradeClient embedded />
      </div>
    </AppShell>
  );
}
