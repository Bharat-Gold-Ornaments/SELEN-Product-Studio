"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecordSalesInput, RecordSalesResult, StockLogEntry } from "@/types/stock-log";

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error(data?.error ?? fallback);
}

async function fetchStockLog(): Promise<StockLogEntry[]> {
  const res = await fetch("/api/stock-log");
  if (!res.ok) throw await readError(res, "Couldn't load the stock log.");
  const { entries } = (await res.json()) as { entries: StockLogEntry[] };
  return entries;
}

/** Every Stock Log row (services/google-sheets.ts) — the Sales page filters it client-side. */
export function useStockLog() {
  return useQuery({ queryKey: ["stock-log"], queryFn: fetchStockLog });
}

/** Sales change Inventory quantities and the Products tab too, so all of them refetch. */
function useInvalidateStock() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["stock-log"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["products-list"] });
    queryClient.invalidateQueries({ queryKey: ["product"] });
  };
}

export function useRecordSales() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async (input: RecordSalesInput): Promise<RecordSalesResult> => {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res, "Couldn't record these sales.");
      return (await res.json()) as RecordSalesResult;
    },
    onSettled: invalidate,
  });
}

export function useUndoSale() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async ({ id, recordedBy }: { id: string; recordedBy: string }): Promise<StockLogEntry> => {
      const res = await fetch(`/api/stock-log/${encodeURIComponent(id)}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordedBy }),
      });
      if (!res.ok) throw await readError(res, "Couldn't undo this sale.");
      const { entry } = (await res.json()) as { entry: StockLogEntry };
      return entry;
    },
    onSettled: invalidate,
  });
}

export function useRetryShopifyStock() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async (): Promise<{ sent: number; stillPending: number }> => {
      const res = await fetch("/api/stock-log/retry-shopify", { method: "POST" });
      if (!res.ok) throw await readError(res, "Couldn't retry.");
      return (await res.json()) as { sent: number; stillPending: number };
    },
    onSettled: invalidate,
  });
}
