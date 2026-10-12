"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ImageOff, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { parseWeightQuery, searchItems } from "@/lib/item-search";
import { normalizeSku } from "@/lib/sku";
import { cn, formatGrams } from "@/lib/utils";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

const PAGE_SIZE = 48;

interface ItemPickerProps {
  items: InventoryItem[];
  onPick: (item: InventoryItem) => void;
  /** Quantity already picked per SKU, shown as a badge on the tile. */
  picked?: Map<string, number>;
}

/**
 * Find a piece by photo: filter by category, then search by SKU or by
 * weight ("3.2" lists the pieces closest to 3.2 g first). Staff often have
 * the piece in hand and can weigh it, which beats remembering its SKU.
 */
export function ItemPicker({ items, onPick, picked }: ItemPickerProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<InventoryCategory | "all">("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const results = useMemo(() => searchItems(items, query, category), [items, query, category]);
  const visible = results.slice(0, limit);
  const weight = parseWeightQuery(query);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="Search SKU, or type a weight like 3.2"
          className="pl-9"
          aria-label="Search by SKU or weight"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {[{ value: "all" as const, label: "All" }, ...INVENTORY_CATEGORIES].map((c) => (
          <Button
            key={c.value}
            type="button"
            size="sm"
            variant={category === c.value ? "default" : "outline"}
            onClick={() => {
              setCategory(c.value);
              setLimit(PAGE_SIZE);
            }}
          >
            {c.label}
          </Button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {weight !== null
          ? `${results.length} piece${results.length === 1 ? "" : "s"} near ${formatGrams(weight)}, closest first`
          : `${results.length} piece${results.length === 1 ? "" : "s"}`}
      </p>

      {results.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-10 text-sm text-muted-foreground">
          Nothing matches.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {visible.map((item) => {
            const count = picked?.get(normalizeSku(item.sku)) ?? 0;
            return (
              <button
                key={item.sku}
                type="button"
                onClick={() => onPick(item)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary",
                  count > 0 ? "border-primary ring-1 ring-primary" : "border-border"
                )}
              >
                <div className="relative flex aspect-square w-full items-center justify-center bg-muted">
                  {item.photoUrl ? (
                    <Image src={item.photoUrl} alt={item.sku} fill unoptimized className="object-cover" />
                  ) : (
                    <ImageOff className="h-5 w-5 text-muted-foreground" />
                  )}
                  {count > 0 ? (
                    <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                      ×{count}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col gap-0.5 p-2">
                  <span className="truncate text-sm font-medium text-foreground">{item.sku}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatGrams(item.weightGrams)} ·{" "}
                    <span className={cn(item.quantity <= 0 && "text-destructive")}>{item.quantity} in stock</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {results.length > visible.length ? (
        <Button type="button" variant="outline" className="self-center" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          Show more ({results.length - visible.length} left)
        </Button>
      ) : null}
    </div>
  );
}
