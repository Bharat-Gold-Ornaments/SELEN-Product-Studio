"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ImageOff, Loader2, RefreshCw, Search, TriangleAlert, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useInventory } from "@/hooks/use-inventory";
import { useAppSettings } from "@/hooks/use-settings";
import { hasPricing, inventoryPrice } from "@/lib/inventory-pricing";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { normalizeSku } from "@/lib/sku";
import { cn } from "@/lib/utils";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

const CATEGORY_LABEL = Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c.value, c.label])) as Record<
  InventoryCategory,
  string
>;

/** How many partial matches the lookup lists when there's no exact SKU hit. */
const MAX_SUGGESTIONS = 8;

const bySku = (a: InventoryItem, b: InventoryItem) =>
  a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" });

function Photo({ item, size }: { item: InventoryItem; size: "sm" | "lg" }) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted",
        size === "lg" ? "h-40 w-40 sm:h-48 sm:w-48" : "h-14 w-14"
      )}
    >
      {item.photoUrl ? (
        <Image src={item.photoUrl} alt={item.sku} fill unoptimized className="object-cover" />
      ) : (
        <ImageOff className={size === "lg" ? "h-8 w-8 text-muted-foreground" : "h-4 w-4 text-muted-foreground"} />
      )}
    </div>
  );
}

export function PriceClient() {
  const { data: items, isLoading, isError, error, refetch, isFetching } = useInventory();
  // Same live price the Inventory table shows — calculated at today's rate, not read from the sheet.
  const ratePerGram = useAppSettings().data?.ratePerGram ?? 0;

  const [lookup, setLookup] = useState("");
  const [category, setCategory] = useState<InventoryCategory | "all">("all");

  const sorted = useMemo(() => [...(items ?? [])].sort(bySku), [items]);

  const priceLabel = (item: InventoryItem) => {
    const price = inventoryPrice(item, ratePerGram);
    return price !== null ? `₹${price.toLocaleString("en-IN")}` : null;
  };
  const renderPrice = (item: InventoryItem) =>
    priceLabel(item) ?? <Badge variant="warning">{hasPricing(item) ? "No rate set" : "Not priced"}</Badge>;

  // SKU lookup: an exact match wins; otherwise list SKUs containing what was typed.
  const query = normalizeSku(lookup);
  const exact = query ? sorted.find((item) => normalizeSku(item.sku) === query) : undefined;
  const suggestions =
    query && !exact ? sorted.filter((item) => normalizeSku(item.sku).includes(query)).slice(0, MAX_SUGGESTIONS) : [];

  const counts = useMemo(() => {
    const map = new Map<InventoryCategory, number>();
    for (const item of sorted) map.set(item.category, (map.get(item.category) ?? 0) + 1);
    return map;
  }, [sorted]);
  const rows = category === "all" ? sorted : sorted.filter((item) => item.category === category);

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

      {/* SKU lookup */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="Enter a product code, e.g. RRA001"
              className="h-11 pl-9 pr-9 font-mono text-base"
              aria-label="Look up price by product code"
              autoFocus
            />
            {lookup ? (
              <button
                type="button"
                onClick={() => setLookup("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {!query ? null : isLoading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : exact ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Photo item={exact} size="lg" />
              <div className="flex flex-col gap-2">
                <span className="font-mono text-lg font-semibold text-foreground">{exact.sku}</span>
                <Badge variant="secondary" className="self-start">
                  {CATEGORY_LABEL[exact.category] ?? exact.category}
                </Badge>
                <span className="text-3xl font-semibold tracking-tight text-foreground">
                  {priceLabel(exact) ?? (
                    <Badge variant="warning">{hasPricing(exact) ? "No rate set" : "Not priced"}</Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">Incl. GST, at today&apos;s rate</span>
              </div>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">No exact match. Did you mean:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <Button
                    key={item.sku}
                    variant="outline"
                    size="sm"
                    className="font-mono"
                    onClick={() => setLookup(item.sku)}
                  >
                    {item.sku}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No product with code &ldquo;{lookup.trim()}&rdquo;.</p>
          )}
        </CardContent>
      </Card>

      {/* Category filter + table */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
            {[{ value: "all" as const, label: "All" }, ...INVENTORY_CATEGORIES].map((c) => {
              const count = c.value === "all" ? sorted.length : (counts.get(c.value) ?? 0);
              return (
                <Button
                  key={c.value}
                  size="sm"
                  variant={category === c.value ? "default" : "outline"}
                  onClick={() => setCategory(c.value)}
                >
                  {c.label}
                  <span className="ml-1 tabular-nums opacity-70">{count}</span>
                </Button>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${rows.length} item${rows.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <Card className="overflow-hidden p-0">
          {isLoading ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              No items in this category.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Image</th>
                    <th className="px-4 py-2.5 font-medium">Product code</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 text-right font-medium">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((item) => (
                    <tr key={item.sku} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-2">
                        <Photo item={item} size="sm" />
                      </td>
                      <td className="px-4 py-2 font-mono font-medium text-foreground">{item.sku}</td>
                      <td className="px-4 py-2 text-muted-foreground">{CATEGORY_LABEL[item.category] ?? item.category}</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums text-foreground">
                        {renderPrice(item)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
