"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { CheckCircle2, ImageOff, Link2, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLinkingOverview, useLinkProduct } from "@/hooks/use-linking";
import { useAppSettings } from "@/hooks/use-settings";
import { INVENTORY_CATEGORIES, PRODUCT_TYPE_INVENTORY_CATEGORY } from "@/lib/constants";
import { hasPricing, inventoryPrice } from "@/lib/inventory-pricing";
import { normalizeSku, sameSku } from "@/lib/sku";
import { cn, formatGrams } from "@/lib/utils";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";
import type { LinkProduct, LinkSlot, SlotLinkInput } from "@/types/product-linking";

const NEW_SKU = "__new";
const SKIP = "__skip";

interface SlotChoice {
  /** An Inventory SKU, NEW_SKU or SKIP. */
  pick: string;
  newSku: string;
  category: InventoryCategory | "";
  weight: "inventory" | "studio" | "";
  stock: "inventory" | "shopify" | "";
}

function initialChoice(slot: LinkSlot, product: LinkProduct): SlotChoice {
  return {
    pick: slot.suggestedSku || (slot.newSkuSuggestion ? NEW_SKU : SKIP),
    newSku: slot.newSkuSuggestion,
    category: PRODUCT_TYPE_INVENTORY_CATEGORY[product.category] ?? "",
    weight: "",
    stock: "",
  };
}

/** Two-option choice shown only where Inventory and the product (or Shopify) disagree. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-warning">{label}</span>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? "default" : "outline"}
          className="h-7"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function ProductLinkCard({
  product,
  items,
  takenSkus,
  ratePerGram,
}: {
  product: LinkProduct;
  items: InventoryItem[];
  /** SKUs already sold by some product, or suggested for another one. */
  takenSkus: Set<string>;
  ratePerGram: number;
}) {
  const open = product.slots.filter((slot) => !slot.currentSku);
  const [choices, setChoices] = useState<Record<string, SlotChoice>>(() =>
    Object.fromEntries(open.map((slot) => [slot.key, initialChoice(slot, product)]))
  );
  const link = useLinkProduct();
  const setChoice = (key: string, patch: Partial<SlotChoice>) =>
    setChoices((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const itemBySku = new Map(items.map((item) => [normalizeSku(item.sku), item]));
  const picked = new Set(
    Object.values(choices)
      .filter((c) => c.pick !== SKIP && c.pick !== NEW_SKU)
      .map((c) => normalizeSku(c.pick))
  );

  /** SKUs a slot can pick: free ones, matching category first. */
  function optionsFor(slot: LinkSlot): InventoryItem[] {
    const own = choices[slot.key]?.pick;
    const category = PRODUCT_TYPE_INVENTORY_CATEGORY[product.category];
    return items
      .filter((item) => {
        const key = normalizeSku(item.sku);
        if (own && sameSku(own, item.sku)) return true;
        if (picked.has(key)) return false;
        return !takenSkus.has(key) || product.slots.some((s) => s.suggestedSku && sameSku(s.suggestedSku, item.sku));
      })
      .sort(
        (a, b) =>
          Number(b.category === category) - Number(a.category === category) ||
          a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" })
      );
  }

  // What linking each slot needs from a person before it can go.
  const plan = open.map((slot) => {
    const choice = choices[slot.key];
    const item = choice && choice.pick !== SKIP && choice.pick !== NEW_SKU ? itemBySku.get(normalizeSku(choice.pick)) : undefined;
    const weightDiffers = Boolean(item && slot.studioGrossWeight > 0 && item.weightGrams !== slot.studioGrossWeight);
    const stockDiffers = Boolean(item && slot.shopifyQuantity !== null && item.quantity !== slot.shopifyQuantity);
    const newSkuTaken =
      choice?.pick === NEW_SKU && items.some((i) => sameSku(i.sku, choice.newSku.trim()));
    const ready =
      !choice ||
      choice.pick === SKIP ||
      (choice.pick === NEW_SKU
        ? Boolean(choice.newSku.trim()) && Boolean(choice.category) && !newSkuTaken
        : Boolean(item) && (!weightDiffers || Boolean(choice.weight)) && (!stockDiffers || Boolean(choice.stock)));
    return { slot, choice, item, weightDiffers, stockDiffers, newSkuTaken, ready };
  });
  const toLink = plan.filter((p) => p.choice && p.choice.pick !== SKIP);
  const canLink = toLink.length > 0 && plan.every((p) => p.ready);

  async function handleLink() {
    const links: SlotLinkInput[] = toLink.map(({ slot, choice, item }) => ({
      slotKey: slot.key,
      sku: choice.pick === NEW_SKU ? choice.newSku.trim() : item!.sku,
      ...(choice.pick === NEW_SKU ? { create: { category: choice.category as InventoryCategory } } : {}),
      weight: choice.weight || "inventory",
      stock: choice.stock || "inventory",
    }));
    try {
      const result = await link.mutateAsync({ productId: product.productId, links });
      if (result.warnings.length) {
        toast.warning(`${product.title} linked, with ${result.warnings.length} thing(s) to check: ${result.warnings.join(" ")}`);
      } else {
        toast.success(`${product.title}: ${result.linked} piece${result.linked === 1 ? "" : "s"} linked.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't link this product.");
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {product.photoUrl ? (
            <Image src={product.photoUrl} alt={product.title} fill unoptimized className="object-cover" />
          ) : (
            <ImageOff className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">{product.title}</span>
          <span className="text-xs text-muted-foreground">
            {product.shopifyProductId ? `Shopify ${product.shopifyProductId}` : "Not on Shopify"} ·{" "}
            {product.hasVariants ? `${product.slots.length} variants` : "no variants"}
          </span>
        </div>
        {open.length === 0 ? (
          <Badge variant="success">Linked</Badge>
        ) : (
          <Badge variant="warning">{open.length} to link</Badge>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {product.slots.map((slot) => {
          const entry = plan.find((p) => p.slot.key === slot.key);
          const choice = entry?.choice;
          const item = entry?.item;
          const newPrice = item && hasPricing(item) ? inventoryPrice(item, ratePerGram) : null;
          return (
            <li key={slot.key} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{slot.label}</span>
                <span className="text-xs text-muted-foreground">
                  Product: {formatGrams(slot.studioGrossWeight)} · Shopify:{" "}
                  {slot.shopifyQuantity === null
                    ? "not listed"
                    : `${slot.shopifySku ? `SKU ${slot.shopifySku}, ` : "no SKU, "}${slot.shopifyQuantity} in stock`}
                </span>
              </div>

              {slot.currentSku ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Linked to {slot.currentSku}
                </p>
              ) : choice ? (
                <>
                  <Select value={choice.pick} onValueChange={(pick) => setChoice(slot.key, { pick, weight: "", stock: "" })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}>Don&apos;t link yet</SelectItem>
                      <SelectItem value={NEW_SKU}>New Inventory SKU…</SelectItem>
                      {optionsFor(slot).map((option) => (
                        <SelectItem key={option.sku} value={option.sku}>
                          {option.sku} · {formatGrams(option.weightGrams)} · qty {option.quantity}
                          {slot.suggestedSku && sameSku(slot.suggestedSku, option.sku) ? " · suggested" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {slot.suggestedSku && sameSku(choice.pick, slot.suggestedSku) ? (
                    <p className="text-xs text-muted-foreground">Suggested: {slot.suggestionReason}</p>
                  ) : null}

                  {choice.pick === NEW_SKU ? (
                    <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2 sm:flex-row sm:items-center">
                      <Input
                        value={choice.newSku}
                        onChange={(e) => setChoice(slot.key, { newSku: e.target.value })}
                        placeholder="New SKU, e.g. ESA011-RG"
                        className="sm:w-48"
                        aria-label="New SKU"
                      />
                      <Select
                        value={choice.category}
                        onValueChange={(category) => setChoice(slot.key, { category: category as InventoryCategory })}
                      >
                        <SelectTrigger className="sm:w-40">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          {INVENTORY_CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground">
                        {entry?.newSkuTaken
                          ? "That SKU is already in Inventory — pick it from the list instead."
                          : `Added to Inventory with this piece's weight, stock${slot.photoUrl ? ", photo" : ""} and pricing.`}
                      </span>
                    </div>
                  ) : null}

                  {entry?.weightDiffers && item ? (
                    <Choice
                      label="Weights differ — which is right?"
                      value={choice.weight}
                      onChange={(weight) => setChoice(slot.key, { weight })}
                      options={[
                        { value: "inventory", label: `Inventory ${formatGrams(item.weightGrams)}` },
                        { value: "studio", label: `Product ${formatGrams(slot.studioGrossWeight)}` },
                      ]}
                    />
                  ) : null}
                  {entry?.stockDiffers && item ? (
                    <Choice
                      label="Stock differs — which is right?"
                      value={choice.stock}
                      onChange={(stock) => setChoice(slot.key, { stock })}
                      options={[
                        { value: "inventory", label: `Inventory ${item.quantity}` },
                        { value: "shopify", label: `Shopify ${slot.shopifyQuantity}` },
                      ]}
                    />
                  ) : null}
                  {item ? (
                    <p className="text-xs text-muted-foreground">
                      {hasPricing(item)
                        ? `Priced from Inventory${newPrice !== null ? `: ₹${newPrice.toLocaleString("en-IN")}` : ""} — the product's price follows it.`
                        : "Inventory takes this product's current pricing, so its price doesn't change."}
                    </p>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>

      {open.length > 0 ? (
        <Button className="self-start" onClick={handleLink} disabled={!canLink || link.isPending}>
          {link.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {toLink.length > 0 ? `Link ${toLink.length} piece${toLink.length === 1 ? "" : "s"}` : "Pick a SKU to link"}
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * Links existing products — each variant separately — to the Inventory SKU
 * of the physical piece it sells. Suggestions come from SKUs already on
 * Shopify and from Inventory rows that name the product's Shopify ID;
 * nothing is linked until a person confirms it.
 */
export function LinkingPanel({ items }: { items: InventoryItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const overview = useLinkingOverview(true);
  const link = useLinkProduct();
  const ratePerGram = useAppSettings().data?.ratePerGram ?? 0;

  const products = useMemo(() => overview.data?.products ?? [], [overview.data]);
  const needing = products.filter((p) => p.slots.some((slot) => !slot.currentSku));
  const visible = showAll ? products : needing;
  const takenSkus = useMemo(
    () =>
      new Set(
        products.flatMap((p) => p.slots.flatMap((slot) => [slot.currentSku, slot.suggestedSku]).filter(Boolean)).map(normalizeSku)
      ),
    [products]
  );

  // Suggested links that need no decision: Inventory and the product agree on
  // weight, and Inventory and Shopify on stock. The rest wait for a person.
  const itemBySku = new Map(items.map((item) => [normalizeSku(item.sku), item]));
  const ready = needing
    .map((product) => ({
      product,
      links: product.slots.flatMap((slot): SlotLinkInput[] => {
        const item = slot.currentSku || !slot.suggestedSku ? undefined : itemBySku.get(normalizeSku(slot.suggestedSku));
        if (!item) return [];
        if (slot.studioGrossWeight > 0 && item.weightGrams !== slot.studioGrossWeight) return [];
        if (slot.shopifyQuantity !== null && item.quantity !== slot.shopifyQuantity) return [];
        return [{ slotKey: slot.key, sku: item.sku, weight: "inventory", stock: "inventory" }];
      }),
    }))
    .filter((entry) => entry.links.length > 0);
  const readyPieces = ready.reduce((sum, entry) => sum + entry.links.length, 0);

  async function linkAllReady() {
    if (
      !window.confirm(
        `Link ${readyPieces} piece${readyPieces === 1 ? "" : "s"} across ${ready.length} product${ready.length === 1 ? "" : "s"} to their suggested SKUs? ` +
          "Inventory takes each product's current pricing, and each SKU is written to Shopify. Prices don't change."
      )
    ) {
      return;
    }
    setBulkRunning(true);
    let linked = 0;
    const problems: string[] = [];
    // One at a time: each link reads and writes the same Sheet tabs.
    for (const entry of ready) {
      try {
        const result = await link.mutateAsync({ productId: entry.product.productId, links: entry.links });
        linked += result.linked;
        problems.push(...result.warnings);
      } catch (error) {
        problems.push(`${entry.product.title}: ${error instanceof Error ? error.message : "couldn't link"}`);
      }
    }
    setBulkRunning(false);
    if (problems.length) {
      toast.warning(`Linked ${linked} piece${linked === 1 ? "" : "s"}. To check: ${problems.join(" ")}`);
    } else {
      toast.success(`Linked ${linked} piece${linked === 1 ? "" : "s"}.`);
    }
  }

  if (overview.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Reading every product&apos;s variants from Shopify…</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[260px] rounded-2xl" />
          <Skeleton className="h-[260px] rounded-2xl" />
        </div>
      </div>
    );
  }
  if (overview.isError) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <span className="flex items-center gap-2 text-destructive">
          <TriangleAlert className="h-4 w-4" />
          {overview.error.message}
        </span>
        <Button variant="outline" size="sm" onClick={() => overview.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each variant — every colour and size — is its own piece with its own Inventory SKU, stock and price. Link each one
          so sales, stock and pricing stay in step across Inventory, Products and Shopify. The SKU is also written to Shopify.
        </p>
        <div className="flex flex-wrap gap-2">
          {readyPieces > 0 ? (
            <Button size="sm" onClick={linkAllReady} disabled={bulkRunning}>
              {bulkRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Link all suggested ({readyPieces})
            </Button>
          ) : null}
          <Button size="sm" variant={showAll ? "outline" : "default"} onClick={() => setShowAll(false)}>
            To link ({needing.length})
          </Button>
          <Button size="sm" variant={showAll ? "default" : "outline"} onClick={() => setShowAll(true)}>
            All products ({products.length})
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={() => overview.refetch()}
            disabled={overview.isFetching}
            aria-label="Reload"
          >
            <RefreshCw className={cn("h-4 w-4", overview.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border py-16 text-sm text-muted-foreground">
          Every product is linked to Inventory.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visible.map((product) => (
            <ProductLinkCard
              key={`${product.productId}|${product.slots.map((s) => s.currentSku).join(",")}`}
              product={product}
              items={items}
              takenSkus={takenSkus}
              ratePerGram={ratePerGram}
            />
          ))}
        </div>
      )}
    </div>
  );
}
