"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ArrowDownWideNarrow, ImageOff, Loader2, Pencil, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AddStockCard } from "@/components/inventory/add-stock-card";
import { DuplicatesPanel } from "@/components/inventory/duplicates-panel";
import { EditInventoryDialog } from "@/components/inventory/edit-inventory-dialog";
import { InventoryOverview } from "@/components/inventory/inventory-overview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProductsList } from "@/hooks/use-products-list";
import { useStockLog } from "@/hooks/use-stock-log";
import { formatDay, salesTotalsBySku } from "@/lib/sales-stats";
import { normalizeSku } from "@/lib/sku";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { cn, formatDate, formatGrams } from "@/lib/utils";
import { useInventory } from "@/hooks/use-inventory";
import { parseWeightQuery, searchItems } from "@/lib/item-search";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

const CATEGORY_LABEL = Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c.value, c.label])) as Record<
  InventoryCategory,
  string
>;

export function InventoryClient() {
  const { data: items, isLoading, isError, error, refetch, isFetching } = useInventory();
  // Only for the Overview tab's "Not listed yet" (which SKUs a Studio product was created from).
  const products = useProductsList();
  // Sold / Last sold columns. If the Stock Log fails to load they just show "—".
  const stockLog = useStockLog();
  const [sortBy, setSortBy] = useState<"sku" | "sold">("sku");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  const salesBySku = useMemo(() => salesTotalsBySku(stockLog.data ?? []), [stockLog.data]);
  const soldOf = (item: InventoryItem) => salesBySku.get(normalizeSku(item.sku))?.sold ?? 0;
  const lastSoldOf = (item: InventoryItem) => salesBySku.get(normalizeSku(item.sku))?.lastSold ?? "";

  // Sorted by SKU (number-aware, so R-2 comes before R-10) or by pieces sold,
  // best sellers first. The sheet itself stays in append order.
  const bySku = (a: InventoryItem, b: InventoryItem) =>
    a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" });
  // A weight search keeps its closest-first order; otherwise the chosen sort applies.
  const searched = items ? (query.trim() ? searchItems(items, query) : items) : [];
  const rows =
    parseWeightQuery(query) !== null
      ? searched
      : [...searched].sort(sortBy === "sold" ? (a, b) => soldOf(b) - soldOf(a) || bySku(a, b) : bySku);

  return (
    <div className="flex flex-1 flex-col gap-6">
      {isError ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {error instanceof Error ? error.message : "Couldn't load inventory."}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Retry
          </Button>
        </div>
      ) : null}

      <Tabs defaultValue="stock" className="flex flex-col gap-6">
        <TabsList className="self-start">
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-0 flex flex-col gap-6">
          <AddStockCard items={items ?? []} />

          <div>
            <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <p className="text-sm font-medium text-foreground">
                {isLoading
                  ? "Loading inventory…"
                  : query.trim()
                    ? `${rows.length} of ${items?.length ?? 0} items match`
                    : `${rows.length} item${rows.length === 1 ? "" : "s"} in inventory`}
              </p>
              <div className="relative sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search SKU, or a weight like 3.2"
                  className="pl-9"
                  aria-label="Search inventory by SKU or weight"
                />
              </div>
            </div>

            <Card className="overflow-hidden p-0">
              {isLoading ? (
                <div className="flex flex-col gap-3 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                  {query.trim() ? "Nothing matches that search." : "No items yet — add one above."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">Photo</th>
                        <th className="px-4 py-2.5 font-medium">SKU</th>
                        <th className="px-4 py-2.5 font-medium">Category</th>
                        <th className="px-4 py-2.5 text-right font-medium">Weight</th>
                        <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          <button
                            type="button"
                            onClick={() => setSortBy((v) => (v === "sold" ? "sku" : "sold"))}
                            className={cn("inline-flex items-center gap-1 hover:text-foreground", sortBy === "sold" && "text-foreground")}
                            title={sortBy === "sold" ? "Sort by SKU" : "Sort by pieces sold"}
                          >
                            Sold
                            <ArrowDownWideNarrow className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-4 py-2.5 font-medium">Last sold</th>
                        <th className="px-4 py-2.5 font-medium">Shopify ID</th>
                        <th className="px-4 py-2.5 font-medium">Added</th>
                        <th className="px-4 py-2.5">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((item) => (
                        <tr key={item.sku}>
                          <td className="px-4 py-2">
                            <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-muted">
                              {item.photoUrl ? (
                                <a href={item.photoUrl} target="_blank" rel="noreferrer">
                                  <Image src={item.photoUrl} alt={item.sku} fill unoptimized className="object-cover" />
                                </a>
                              ) : (
                                <ImageOff className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 font-medium text-foreground">{item.sku}</td>
                          <td className="px-4 py-2">
                            <Badge variant="secondary">{CATEGORY_LABEL[item.category] ?? item.category}</Badge>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatGrams(item.weightGrams)}</td>
                          <td
                            className={cn("px-4 py-2 text-right tabular-nums", item.quantity === 0 && "text-destructive")}
                          >
                            {item.quantity}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {stockLog.data ? soldOf(item) : "—"}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {lastSoldOf(item) ? formatDay(lastSoldOf(item)) : "—"}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{item.shopifyProductId || "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {item.createdDate ? formatDate(item.createdDate) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setEditing(item)}
                              aria-label={`Edit ${item.sku}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="overview" className="mt-0">
          {isLoading || products.isLoading ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[92px] rounded-2xl" />
              ))}
            </div>
          ) : (
            <InventoryOverview
              items={items ?? []}
              listedSkus={(products.data ?? []).map((product) => product.sku)}
              onSelect={setEditing}
            />
          )}
        </TabsContent>
        <TabsContent value="duplicates" className="mt-0">
          {isLoading ? (
            <Skeleton className="h-[360px] rounded-2xl" />
          ) : (
            <DuplicatesPanel items={items ?? []} soldOf={soldOf} />
          )}
        </TabsContent>
      </Tabs>

      {editing ? <EditInventoryDialog item={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
