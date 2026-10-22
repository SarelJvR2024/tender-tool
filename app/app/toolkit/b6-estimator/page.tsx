import Link from "next/link";
import { AppShell } from "../../_components/AppShell";
import { PageHeader } from "@/components/tt/page-header";
import B6EstimatorClient from "../../tools/b6-estimator/B6EstimatorClient";

export const metadata = {
  title: "SANRAL B6 functionality score estimator - Tender Ready",
};

export default function Page() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <Link href="/toolkit" className="text-sm text-muted-foreground no-underline">
          ← Tools
        </Link>
        <PageHeader title="SANRAL B6 functionality score estimator" />
        <B6EstimatorClient embedded />
      </div>
    </AppShell>
  );
}
