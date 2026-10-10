"use client";

import { useState } from "react";
import Image from "next/image";
import { Boxes, CircleSlash, ImageOff, Layers, PackageMinus, Scale, Store, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { formatGrams } from "@/lib/utils";
import { computeInventoryStats } from "@/lib/inventory-stats";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

const CATEGORY_LABEL = Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c.value, c.label])) as Record<
  InventoryCategory,
  string
>;

/** How many SKUs an attention list shows before "Show all". */
const COLLAPSED_ITEMS = 6;
/** How many missing SKUs a group row lists inline. */
const INLINE_GAPS = 6;

function Tile({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: LucideIcon }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
          {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function AttentionList({
  title,
  icon: Icon,
  description,
  items,
  emptyLabel,
  onSelect,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
  items: InventoryItem[];
  emptyLabel: string;
  onSelect: (item: InventoryItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, COLLAPSED_ITEMS);

  return (
    <Card className="flex flex-col p-0">
      <CardHeader className="gap-1 p-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
          <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      {items.length === 0 ? (
        <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {visible.map((item) => (
            <li key={item.sku}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {item.photoUrl ? (
                    <Image src={item.photoUrl} alt={item.sku} fill unoptimized className="object-cover" />
                  ) : (
                    <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{item.sku}</span>
                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_LABEL[item.category] ?? item.category} · {formatGrams(item.weightGrams)} · qty{" "}
                    {item.quantity}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > COLLAPSED_ITEMS ? (
        <div className="mt-auto border-t border-border px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show fewer" : `Show all ${items.length}`}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

interface InventoryOverviewProps {
  items: InventoryItem[];
  /** SKUs that Studio products were created from — used for "Not listed yet". */
  listedSkus: string[];
  onSelect: (item: InventoryItem) => void;
}

export function InventoryOverview({ items, listedSkus, onSelect }: InventoryOverviewProps) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-border py-16 text-sm text-muted-foreground">
        No items yet — add some on the Stock tab to see stats here.
      </div>
    );
  }

  const stats = computeInventoryStats(items, listedSkus);
  const maxPieces = Math.max(1, ...stats.categories.map((c) => c.pieces));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Tile label="SKUs" value={String(stats.totals.skus)} icon={Layers} />
        <Tile label="Pieces" value={String(stats.totals.pieces)} sub="total quantity" icon={Boxes} />
        <Tile label="Metal in stock" value={formatGrams(stats.totals.grams)} sub="weight × qty" icon={Scale} />
        <Tile label="Out of stock" value={String(stats.totals.outOfStock)} sub="qty 0" icon={CircleSlash} />
        <Tile label="Low stock" value={String(stats.totals.lowStock)} sub="qty 1" icon={PackageMinus} />
        <Tile label="Not listed yet" value={String(stats.totals.notListed)} sub="no product or Shopify ID" icon={Store} />
      </div>

      <Card className="overflow-hidden p-0">
        <CardHeader className="p-4">
          <CardTitle className="text-base">By category</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="w-[30%] px-4 py-2 font-medium">Pieces</th>
                <th className="px-4 py-2 text-right font-medium">SKUs</th>
                <th className="px-4 py-2 text-right font-medium">Metal</th>
                <th className="px-4 py-2 text-right font-medium">Weight range</th>
                <th className="px-4 py-2 text-right font-medium">Out</th>
                <th className="px-4 py-2 text-right font-medium">Low</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.categories.map((c) => (
                <tr key={c.category} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-2.5 font-medium text-foreground">{c.label}</td>
                  <td className="px-4 py-2.5">
                    <div
                      className="flex items-center gap-2"
                      title={`${c.label}: ${c.pieces} pieces across ${c.skus} SKUs`}
                    >
                      <div className="h-3 flex-1">
                        {c.pieces > 0 ? (
                          <div
                            className="h-3 rounded-r bg-primary"
                            style={{ width: `${(c.pieces / maxPieces) * 100}%` }}
                          />
                        ) : null}
                      </div>
                      <span className="w-10 text-right tabular-nums text-foreground">{c.pieces}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.skus}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatGrams(c.grams)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {c.minWeight === null
                      ? "—"
                      : c.minWeight === c.maxWeight
                        ? formatGrams(c.minWeight)
                        : `${formatGrams(c.minWeight)} – ${formatGrams(c.maxWeight)}`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.outOfStock}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.lowStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="gap-1 p-4">
          <CardTitle className="text-base">By SKU group</CardTitle>
          <p className="text-xs text-muted-foreground">
            Grouped by the letters before the number (RRA001 → RRA). Missing numbers are gaps between the group&apos;s
            first and last SKU.
          </p>
        </CardHeader>
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Group</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">SKUs</th>
                <th className="px-4 py-2 text-right font-medium">Pieces</th>
                <th className="px-4 py-2 text-right font-medium">Metal</th>
                <th className="px-4 py-2 text-right font-medium">Out</th>
                <th className="px-4 py-2 text-right font-medium">Low</th>
                <th className="px-4 py-2 font-medium">Range</th>
                <th className="px-4 py-2 font-medium">Missing numbers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.groups.map((g) => (
                <tr key={g.prefix} className="align-top transition-colors hover:bg-muted/40">
                  <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">{g.prefix}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {g.categories.map((category) => (
                        <Badge key={category} variant="secondary">
                          {CATEGORY_LABEL[category] ?? category}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.skus}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.pieces}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatGrams(g.grams)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.outOfStock}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.lowStock}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {g.firstSku && g.lastSku && g.firstSku !== g.lastSku ? `${g.firstSku} – ${g.lastSku}` : g.firstSku ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs" title={g.gaps.join(", ")}>
                    {g.gaps.length === 0 ? (
                      <span className="font-sans text-muted-foreground">None</span>
                    ) : (
                      <>
                        {g.gaps.slice(0, INLINE_GAPS).join(", ")}
                        {g.gaps.length > INLINE_GAPS ? (
                          <span className="font-sans text-muted-foreground"> +{g.gaps.length - INLINE_GAPS} more</span>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AttentionList
          title="Out of stock"
          icon={CircleSlash}
          description="Quantity 0. Click one to edit it."
          items={stats.outOfStock}
          emptyLabel="Nothing is out of stock."
          onSelect={onSelect}
        />
        <AttentionList
          title="Low stock"
          icon={PackageMinus}
          description="Quantity 1 — the last piece."
          items={stats.lowStock}
          emptyLabel="Nothing is low on stock."
          onSelect={onSelect}
        />
        <AttentionList
          title="Not listed yet"
          icon={Store}
          description="No Studio product uses this SKU and the row has no Shopify product ID."
          items={stats.notListed}
          emptyLabel="Every SKU is listed."
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}
