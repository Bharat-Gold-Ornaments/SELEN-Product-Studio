import { PageShell } from "@/components/layout/page-shell";
import { InventoryClient } from "@/components/inventory/inventory-client";

export default function InventoryPage() {
  return (
    <PageShell
      title="Inventory"
      description="Log each piece's code, category, weight and photo. Saved to the Inventory tab of the Google Sheet."
    >
      <InventoryClient />
    </PageShell>
  );
}
