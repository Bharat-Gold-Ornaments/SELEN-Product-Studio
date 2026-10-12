import { PageShell } from "@/components/layout/page-shell";
import { SalesClient } from "@/components/sales/sales-client";

export default function SalesPage() {
  return (
    <PageShell
      title="Sales"
      description="Record the day's shop sales; online orders come in from Shopify. Stock comes off Inventory and Shopify, and every change is kept in the Stock Log tab."
    >
      <SalesClient />
    </PageShell>
  );
}
