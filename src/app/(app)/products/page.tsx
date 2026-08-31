import Link from "next/link";
import { Upload } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { ProductsClient } from "@/components/products/products-client";

export default function ProductsPage() {
  return (
    <PageShell
      title="Products"
      description="Every product created in the studio, synced from Google Sheets."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/products/import">
            <Upload className="h-3.5 w-3.5" />
            Import from Shopify
          </Link>
        </Button>
      }
    >
      <ProductsClient />
    </PageShell>
  );
}
