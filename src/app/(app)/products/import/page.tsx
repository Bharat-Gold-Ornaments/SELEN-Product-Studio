import { PageShell } from "@/components/layout/page-shell";
import { ImportClient } from "@/components/products/import-client";

export default function ImportProductsPage() {
  return (
    <PageShell
      title="Import from Shopify"
      description="Products created directly in Shopify admin, not yet tracked here — pick a category for each one to bring it onto the dashboard."
    >
      <ImportClient />
    </PageShell>
  );
}
