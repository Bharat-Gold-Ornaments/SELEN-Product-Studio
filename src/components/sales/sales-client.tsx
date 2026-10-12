"use client";

import { toast } from "sonner";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OnlineOrdersPanel } from "@/components/sales/online-orders-panel";
import { RecordSales } from "@/components/sales/record-sales";
import { SalesHistory } from "@/components/sales/sales-history";
import { useRecordedBy } from "@/components/sales/use-recorded-by";
import { useInventory } from "@/hooks/use-inventory";
import { useRetryShopifyStock, useStockLog } from "@/hooks/use-stock-log";

export function SalesClient() {
  const inventory = useInventory();
  const stockLog = useStockLog();
  const retry = useRetryShopifyStock();
  const [recordedBy, setRecordedBy] = useRecordedBy();

  const entries = stockLog.data ?? [];
  const pending = entries.filter((e) => e.shopifyStatus === "pending");

  async function handleRetry() {
    try {
      const result = await retry.mutateAsync();
      if (result.stillPending === 0) {
        toast.success(`Shopify updated for ${result.sent} item${result.sent === 1 ? "" : "s"}.`);
      } else {
        toast.warning(
          `${result.sent} sent, ${result.stillPending} still waiting — usually the item has no SKU on Shopify yet.`
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't retry.");
    }
  }

  const error = inventory.error ?? stockLog.error;
  if (error) {
    return (
      <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
        <span className="flex items-center gap-2 text-destructive">
          <TriangleAlert className="h-4 w-4" />
          {error.message}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void inventory.refetch();
            void stockLog.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (inventory.isLoading || stockLog.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[480px] rounded-2xl" />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="flex items-start gap-2 text-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              {pending.length} stock change{pending.length === 1 ? " hasn't" : "s haven't"} reached Shopify yet, so Shopify
              shows more stock than you have. Usually the item has no SKU on Shopify — add it there, then retry.
            </span>
          </span>
          <Button variant="outline" size="sm" onClick={handleRetry} disabled={retry.isPending}>
            {retry.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Retry
          </Button>
        </div>
      ) : null}

      <OnlineOrdersPanel />

      <Tabs defaultValue="record" className="flex flex-col gap-6">
        <TabsList className="self-start">
          <TabsTrigger value="record">Record sales</TabsTrigger>
          <TabsTrigger value="history">History &amp; reports</TabsTrigger>
        </TabsList>
        <TabsContent value="record" className="mt-0">
          <RecordSales
            items={inventory.data ?? []}
            entries={entries}
            recordedBy={recordedBy}
            onRecordedByChange={setRecordedBy}
          />
        </TabsContent>
        <TabsContent value="history" className="mt-0">
          <SalesHistory items={inventory.data ?? []} entries={entries} recordedBy={recordedBy} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
