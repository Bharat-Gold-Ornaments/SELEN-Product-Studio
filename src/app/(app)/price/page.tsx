import { PageShell } from "@/components/layout/page-shell";
import { PriceClient } from "@/components/price/price-client";

export default function PricePage() {
  return (
    <PageShell
      title="Price List"
      description="Every inventory piece, listed on the website or not, with its current price at today's silver rate."
    >
      <PriceClient />
    </PageShell>
  );
}
