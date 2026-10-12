"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ImageOff, Info, Loader2, Minus, Plus, ShoppingBag, TriangleAlert, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ItemPicker } from "@/components/sales/item-picker";
import { useRecordSales } from "@/hooks/use-stock-log";
import { activeSales, formatDay, localDate } from "@/lib/sales-stats";
import { normalizeSku } from "@/lib/sku";
import { cn, formatGrams } from "@/lib/utils";
import type { InventoryItem } from "@/types/inventory";
import type { StockLogEntry } from "@/types/stock-log";

interface Line {
  sku: string;
  quantity: number;
}

interface RecordSalesProps {
  items: InventoryItem[];
  entries: StockLogEntry[];
  recordedBy: string;
  onRecordedByChange: (name: string) => void;
}

export function RecordSales({ items, entries, recordedBy, onRecordedByChange }: RecordSalesProps) {
  const [date, setDate] = useState(localDate);
  const [lines, setLines] = useState<Line[]>([]);
  const recordSales = useRecordSales();

  const itemBySku = useMemo(() => new Map(items.map((item) => [normalizeSku(item.sku), item])), [items]);
  const picked = useMemo(() => new Map(lines.map((l) => [normalizeSku(l.sku), l.quantity])), [lines]);
  const pieces = lines.reduce((sum, l) => sum + l.quantity, 0);

  const alreadyRecorded = useMemo(() => {
    const sales = activeSales(entries).filter((e) => e.type === "sale" && e.date === date);
    return {
      pieces: sales.reduce((sum, e) => sum - e.change, 0),
      by: [...new Set(sales.map((e) => e.recordedBy).filter(Boolean))],
    };
  }, [entries, date]);

  function add(item: InventoryItem) {
    setLines((current) => {
      const key = normalizeSku(item.sku);
      if (current.some((l) => normalizeSku(l.sku) === key)) {
        return current.map((l) => (normalizeSku(l.sku) === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...current, { sku: item.sku, quantity: 1 }];
    });
  }

  function setQuantity(sku: string, quantity: number) {
    setLines((current) => current.map((l) => (l.sku === sku ? { ...l, quantity: Math.max(1, quantity) } : l)));
  }

  function remove(sku: string) {
    setLines((current) => current.filter((l) => l.sku !== sku));
  }

  async function submit() {
    if (!recordedBy.trim()) {
      toast.error("Enter your name in “Recorded by” first.");
      return;
    }
    try {
      const { entries: saved } = await recordSales.mutateAsync({ date, recordedBy: recordedBy.trim(), lines });
      const pending = saved.filter((e) => e.shopifyStatus === "pending").length;
      setLines([]);
      const summary = `Recorded ${pieces} piece${pieces === 1 ? "" : "s"} for ${formatDay(date)}.`;
      if (pending > 0) {
        toast.warning(`${summary} ${pending} item${pending === 1 ? "" : "s"} couldn't be updated on Shopify yet — see the banner above.`);
      } else {
        toast.success(summary);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't record these sales.");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader>
          <CardTitle>Find the items sold</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ItemPicker items={items} onPick={add} picked={picked} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              Sales to record
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="saleDate" className="mb-1.5 block text-sm font-normal">
                  Date
                </Label>
                <Input
                  id="saleDate"
                  type="date"
                  value={date}
                  max={localDate()}
                  onChange={(e) => setDate(e.target.value || localDate())}
                />
              </div>
              <div>
                <Label htmlFor="recordedBy" className="mb-1.5 block text-sm font-normal">
                  Recorded by
                </Label>
                <Input
                  id="recordedBy"
                  placeholder="Your name"
                  value={recordedBy}
                  onChange={(e) => onRecordedByChange(e.target.value)}
                />
              </div>
            </div>

            {alreadyRecorded.pieces > 0 ? (
              <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  {alreadyRecorded.pieces} piece{alreadyRecorded.pieces === 1 ? " was" : "s were"} already recorded for{" "}
                  {formatDay(date)}
                  {alreadyRecorded.by.length ? ` by ${alreadyRecorded.by.join(", ")}` : ""}. Anything added here is recorded
                  in addition — check History first so nothing is entered twice.
                </span>
              </div>
            ) : null}

            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                Tap an item on the left to add it.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {lines.map((line) => {
                  const item = itemBySku.get(normalizeSku(line.sku));
                  const stock = item?.quantity ?? 0;
                  const after = stock - line.quantity;
                  return (
                    <li key={line.sku} className="flex items-center gap-3 py-2">
                      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                        {item?.photoUrl ? (
                          <Image src={item.photoUrl} alt={line.sku} fill unoptimized className="object-cover" />
                        ) : (
                          <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">{line.sku}</span>
                        <span className={cn("text-xs text-muted-foreground", after < 0 && "text-destructive")}>
                          {item ? formatGrams(item.weightGrams) + " · " : ""}stock {stock} → {after}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setQuantity(line.sku, line.quantity - 1)}
                          disabled={line.quantity <= 1}
                          aria-label={`One fewer ${line.sku}`}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          value={line.quantity}
                          onChange={(e) => setQuantity(line.sku, Math.floor(Number(e.target.value)) || 1)}
                          className="h-7 w-12 px-1 text-center"
                          aria-label={`Quantity of ${line.sku}`}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setQuantity(line.sku, line.quantity + 1)}
                          aria-label={`One more ${line.sku}`}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => remove(line.sku)}
                          aria-label={`Remove ${line.sku}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {lines.some((l) => (itemBySku.get(normalizeSku(l.sku))?.quantity ?? 0) - l.quantity < 0) ? (
              <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-foreground">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span>
                  Some items would go below 0 in stock, so Inventory is probably out of date for them. You can still record
                  the sale — then correct the quantity on the Inventory page.
                </span>
              </div>
            ) : null}

            <Button type="button" onClick={submit} disabled={lines.length === 0 || recordSales.isPending}>
              {recordSales.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {lines.length === 0 ? "Record sales" : `Record ${pieces} piece${pieces === 1 ? "" : "s"}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              Takes the pieces out of Inventory and Shopify stock. A mistake can be undone from History.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
