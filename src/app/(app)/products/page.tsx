import { PageShell } from "@/components/layout/page-shell";
import { ProductsClient } from "@/components/products/products-client";

export default function ProductsPage() {
  return (
    <PageShell
      title="Products"
      description="Every product created in the studio, synced from Google Sheets."
    >
      <ProductsClient />
    </PageShell>
  );
}
