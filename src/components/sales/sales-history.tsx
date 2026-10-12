"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Gem, Globe, ImageOff, Layers, Loader2, Store, Undo2, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUndoSale } from "@/hooks/use-stock-log";
import { addDays, computeSalesStats, formatDay, isSale, localDate, slowMovers } from "@/lib/sales-stats";
import { normalizeSku } from "@/lib/sku";
import { formatGrams } from "@/lib/utils";
import type { InventoryItem } from "@/types/inventory";
import type { ShopifyStockStatus, StockLogEntry } from "@/types/stock-log";

type RangeKey = "today" | "7d" | "30d" | "month" | "all";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

const SLOW_MOVER_DAYS = 60;
const COLLAPSED_ROWS = 10;

function rangeBounds(key: RangeKey, entries: StockLogEntry[]): { from: string; to: string } {
  const today = localDate();
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "all": {
      const first = entries.map((e) => e.date).filter(Boolean).sort()[0];
      return { from: first && first < today ? first : today, to: today };
    }
  }
}

const SHOPIFY_BADGE: Record<Exclude<ShopifyStockStatus, "">, { label: string; variant: "success" | "warning" | "secondary" }> = {
  sent: { label: "On Shopify", variant: "success" },
  pending: { label: "Shopify pending", variant: "warning" },
  not_on_shopify: { label: "Not on Shopify", variant: "secondary" },
};

function Tile({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function Thumb({ item, sku }: { item: InventoryItem | undefined; sku: string }) {
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {item?.photoUrl ? (
        <Image src={item.photoUrl} alt={sku} fill unoptimized className="object-cover" />
      ) : (
        <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </div>
  );
}

interface SalesHistoryProps {
  items: InventoryItem[];
  entries: StockLogEntry[];
  recordedBy: string;
}

export function SalesHistory({ items, entries, recordedBy }: SalesHistoryProps) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [showAllTop, setShowAllTop] = useState(false);
  const [showAllSlow, setShowAllSlow] = useState(false);
  const undoSale = useUndoSale();

  const { from, to } = rangeBounds(range, entries);
  const stats = useMemo(() => computeSalesStats(entries, items, from, to), [entries, items, from, to]);
  const slow = useMemo(() => slowMovers(entries, items, SLOW_MOVER_DAYS, localDate()), [entries, items]);
  const itemBySku = useMemo(() => new Map(items.map((item) => [normalizeSku(item.sku), item])), [items]);

  // Shop and online sales in range, newest day first, with what was undone or returned of each.
  const days = useMemo(() => {
    const reversals = new Map<string, StockLogEntry[]>();
    for (const e of entries) if (e.reversesId) reversals.set(e.reversesId, [...(reversals.get(e.reversesId) ?? []), e]);
    const sales = entries.filter((e) => isSale(e) && e.date >= from && e.date <= to);
    const byDate = new Map<string, StockLogEntry[]>();
    for (const sale of sales) byDate.set(sale.date, [...(byDate.get(sale.date) ?? []), sale]);
    return [...byDate.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, list]) => ({
        date,
        sales: list.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
        reversals,
      }));
  }, [entries, from, to]);

  async function undo(sale: StockLogEntry) {
    if (!recordedBy.trim()) {
      toast.error("Enter your name in “Recorded by” on the Record sales tab first.");
      return;
    }
    const pieces = -sale.change;
    if (!window.confirm(`Undo the sale of ${pieces} × ${sale.sku} on ${formatDay(sale.date)}? The stock goes back up.`)) {
      return;
    }
    try {
      await undoSale.mutateAsync({ id: sale.id, recordedBy: recordedBy.trim() });
      toast.success(`Sale of ${sale.sku} undone.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't undo this sale.");
    }
  }

  const topVisible = showAllTop ? stats.topItems : stats.topItems.slice(0, COLLAPSED_ROWS);
  const slowVisible = showAllSlow ? slow : slow.slice(0, COLLAPSED_ROWS);
  const maxCategory = Math.max(1, ...stats.byCategory.map((c) => c.quantity));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Button key={r.key} size="sm" variant={range === r.key ? "default" : "outline"} onClick={() => setRange(r.key)}>
            {r.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Pieces sold" value={String(stats.pieces)} icon={Gem} />
        <Tile label="In the shop" value={String(stats.pieces - stats.online)} icon={Store} />
        <Tile label="Online" value={String(stats.online)} icon={Globe} />
        <Tile label="Different items" value={String(stats.skus)} icon={Layers} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-0">
          <CardHeader className="p-4">
            <CardTitle className="text-base">Best sellers</CardTitle>
          </CardHeader>
          {stats.topItems.length === 0 ? (
            <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">No sales in this period.</p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {topVisible.map((sold) => (
                <li key={sold.sku} className="flex items-center gap-3 px-4 py-2">
                  <Thumb item={sold.item} sku={sold.sku} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{sold.sku}</span>
                    <span className="text-xs text-muted-foreground">
                      {sold.item ? `${formatGrams(sold.item.weightGrams)} · ${sold.item.quantity} left` : "No longer in Inventory"}
                    </span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{sold.quantity} sold</span>
                </li>
              ))}
            </ul>
          )}
          {stats.topItems.length > COLLAPSED_ROWS ? (
            <div className="border-t border-border px-4 py-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAllTop((v) => !v)}>
                {showAllTop ? "Show fewer" : `Show all ${stats.topItems.length}`}
              </Button>
            </div>
          ) : null}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By category</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              {stats.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-muted-foreground">{c.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(c.quantity / maxCategory) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right tabular-nums text-foreground">{c.quantity}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="p-0">
            <CardHeader className="gap-1 p-4">
              <CardTitle className="text-base">
                Slow movers <span className="text-sm font-normal text-muted-foreground">({slow.length})</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                In stock, but not sold in the last {SLOW_MOVER_DAYS} days. Counts only sales recorded here.
              </p>
            </CardHeader>
            {slow.length === 0 ? (
              <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">Nothing sitting idle.</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {slowVisible.map((item) => (
                  <li key={item.sku} className="flex items-center gap-3 px-4 py-2">
                    <Thumb item={item} sku={item.sku} />
                    <span className="flex-1 truncate text-sm font-medium text-foreground">{item.sku}</span>
                    <span className="text-xs text-muted-foreground">{item.quantity} in stock</span>
                  </li>
                ))}
              </ul>
            )}
            {slow.length > COLLAPSED_ROWS ? (
              <div className="border-t border-border px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => setShowAllSlow((v) => !v)}>
                  {showAllSlow ? "Show fewer" : `Show all ${slow.length}`}
                </Button>
              </div>
            ) : null}
          </Card>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Daily record</h2>
        {days.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            No sales recorded in this period.
          </p>
        ) : (
          days.map(({ date, sales, reversals }) => {
            const reversedOf = (sale: StockLogEntry) => (reversals.get(sale.id) ?? []).reduce((sum, e) => sum + e.change, 0);
            const total = sales.reduce((sum, sale) => sum - sale.change - reversedOf(sale), 0);
            return (
              <Card key={date} className="overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
                  <span className="text-sm font-medium text-foreground">{formatDay(date)}</span>
                  <span className="text-sm text-muted-foreground">
                    {total} piece{total === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {sales.map((sale) => {
                    const online = sale.type === "online_sale";
                    const sold = -sale.change;
                    const reversed = reversedOf(sale);
                    const fullyReversed = reversed >= sold;
                    const reversedBy = (reversals.get(sale.id) ?? [])[0]?.recordedBy;
                    const badge = !online && sale.shopifyStatus ? SHOPIFY_BADGE[sale.shopifyStatus] : null;
                    return (
                      <li key={sale.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                        <Thumb item={itemBySku.get(normalizeSku(sale.sku))} sku={sale.sku} />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span
                            className={
                              fullyReversed ? "text-sm text-muted-foreground line-through" : "text-sm font-medium text-foreground"
                            }
                          >
                            {sold} × {sale.sku}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {online ? sale.note || "Online order" : sale.recordedBy || "Unknown"}
                            {reversed > 0 && online
                              ? ` · ${fullyReversed ? "returned" : `${reversed} returned`}`
                              : ""}
                            {reversed > 0 && !online ? ` · undone by ${reversedBy || "unknown"}` : ""}
                            {!fullyReversed && sale.shopifyStatus === "pending" && sale.note ? ` · ${sale.note}` : ""}
                          </span>
                        </div>
                        <Badge variant={online ? "gold" : "outline"}>{online ? "Online" : "Shop"}</Badge>
                        {badge && !fullyReversed ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
                        {fullyReversed ? (
                          <Badge variant="secondary">{online ? "Returned" : "Undone"}</Badge>
                        ) : online ? null : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => undo(sale)}
                            disabled={undoSale.isPending}
                            aria-label={`Undo sale of ${sale.sku}`}
                          >
                            {undoSale.isPending && undoSale.variables?.id === sale.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Undo2 className="h-3.5 w-3.5" />
                            )}
                            Undo
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
